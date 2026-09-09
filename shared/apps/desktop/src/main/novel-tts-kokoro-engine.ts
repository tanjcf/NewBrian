import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { resolveNovelTtsVoice } from "../shared/novel-tts-policy.js";
import { probeNovelTtsGpu, type NovelTtsGpuProbeResult } from "./novel-tts-gpu-probe.js";
import {
  findReadyNovelTtsKokoroLayout,
  NOVEL_TTS_KOKORO_IDLE_RELEASE_MS
} from "./novel-tts-kokoro-paths.js";

export type NovelTtsKokoroSynthesizeResult = {
  ok: boolean;
  audioPath?: string;
  durationMs?: number;
  detail?: string;
  provider?: string;
  runtime?: "gpu" | "cpu";
  gpuProbe?: NovelTtsGpuProbeResult;
};

type NovelTtsKokoroEngineDependencies = {
  appendDebugLog?: (message: string) => Promise<void> | void;
  probeGpu?: typeof probeNovelTtsGpu;
  findLayout?: typeof findReadyNovelTtsKokoroLayout;
  idleReleaseMs?: number;
  workerPath?: string;
};

type PendingJob = {
  jobId: number;
  requestId: string;
  payload: Record<string, unknown>;
  resolve: (result: NovelTtsKokoroSynthesizeResult) => void;
};

/**
 * Offline Kokoro in an isolated Node child (ELECTRON_RUN_AS_NODE).
 * Child stays warm across voice switches — killing onnx mid-load crashes GPU drivers.
 */
export class NovelTtsKokoroEngine {
  private readonly dependencies: NovelTtsKokoroEngineDependencies;
  private releaseTimer: NodeJS.Timeout | null = null;
  private warmChild: ChildProcess | null = null;
  private childReady = false;
  private spawning: Promise<ChildProcess> | null = null;
  private jobSerial = 0;
  private queue: PendingJob[] = [];
  private activeJob: PendingJob | null = null;
  private draining = false;
  private waiters = new Map<
    string,
    { resolve: (result: NovelTtsKokoroSynthesizeResult) => void }
  >();
  private cachedGpuProbe: NovelTtsGpuProbeResult | null = null;

  constructor(dependencies: NovelTtsKokoroEngineDependencies = {}) {
    this.dependencies = dependencies;
  }

  isRunning() {
    return this.draining || this.queue.length > 0 || this.waiters.size > 0;
  }

  /**
   * Soft-cancel: drop queued jobs and invalidate in-flight results.
   * Do NOT kill the warm onnx child — hard-kill mid-load causes GPU driver resets
   * (Windows STATUS_STACK_BUFFER_OVERRUN / 3221226505).
   * In-flight inference is allowed to finish; its audio is discarded.
   */
  cancel() {
    this.jobSerial += 1;
    this.activeJob?.resolve({ ok: false, detail: "朗读已取消。" });
    const cancelled = this.queue.splice(0);
    for (const job of cancelled) {
      job.resolve({ ok: false, detail: "朗读已取消。" });
    }
  }

  /** Force-dispose warm child (tests / shutdown). */
  dispose() {
    this.cancel();
    this.clearIdleTimer();
    this.killWarmChild(true);
  }

  async synthesize(input: {
    text: string;
    voiceId: string;
  }): Promise<NovelTtsKokoroSynthesizeResult> {
    const text = String(input.text || "").trim();
    if (!text) return { ok: false, detail: "没有可朗读的内容。" };

    const voice = resolveNovelTtsVoice(input.voiceId);
    const findLayout = this.dependencies.findLayout ?? findReadyNovelTtsKokoroLayout;
    const layout = await findLayout({ voiceId: voice.id });
    if (!layout) {
      return {
        ok: false,
        detail: "未安装 Kokoro 离线语音包。请先运行 novel-tts 资源下载脚本，或改用系统朗读。"
      };
    }

    const gpuProbe = await this.getGpuProbe();
    await this.dependencies.appendDebugLog?.(
      `novel tts kokoro layout=${layout.rootDir} voice=${voice.id}->${voice.kokoroVoice} probe=${gpuProbe.preferred}`
    );

    this.bumpIdleTimer();

    // Latest voice wins: drop older queued jobs so rapid menu clicks don't pile onnx work.
    const superseded = this.queue.splice(0);
    for (const job of superseded) {
      job.resolve({ ok: false, detail: "朗读已取消。" });
    }

    const jobId = ++this.jobSerial;
    const requestId = randomUUID();
    const outDir = path.join(os.tmpdir(), "newbrain-novel-tts");
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `${requestId}.wav`);

    return new Promise((resolve) => {
      this.queue.push({
        jobId,
        requestId,
        payload: {
          type: "synthesize",
          requestId,
          text,
          voice: voice.kokoroVoice,
          modelDir: layout.modelDir,
          voicesDir: layout.voicesDir,
          outPath,
          preferredDevice: "cpu",
          // Prefer warmer q4f16; worker falls back to fp32 on NaN/silence.
          dtype: "q4f16"
        },
        resolve: (result) => resolve({ ...result, gpuProbe })
      });
      void this.drainQueue();
    });
  }

  private async getGpuProbe() {
    if (this.cachedGpuProbe) return this.cachedGpuProbe;
    const probeGpu = this.dependencies.probeGpu ?? probeNovelTtsGpu;
    this.cachedGpuProbe = await probeGpu();
    return this.cachedGpuProbe;
  }

  private async drainQueue() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        if (job.jobId !== this.jobSerial) {
          job.resolve({ ok: false, detail: "朗读已取消。" });
          continue;
        }
        try {
          this.activeJob = job;
          const result = await this.runJobOnWarmChild(job);
          if (job.jobId !== this.jobSerial) {
            job.resolve({ ok: false, detail: "朗读已取消。" });
            continue;
          }
          job.resolve(result);
        } catch (error) {
          job.resolve({
            ok: false,
            detail: `Kokoro 子进程异常：${error instanceof Error ? error.message : String(error)}`
          });
        } finally {
          if (this.activeJob === job) this.activeJob = null;
          this.bumpIdleTimer();
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length) void this.drainQueue();
    }
  }

  private async runJobOnWarmChild(job: PendingJob): Promise<NovelTtsKokoroSynthesizeResult> {
    const child = await this.ensureWarmChild();
    return new Promise((resolve) => {
      this.waiters.set(job.requestId, {
        resolve: (result) => {
          this.waiters.delete(job.requestId);
          resolve(result);
        }
      });

      try {
        child.send(job.payload);
      } catch (error) {
        this.waiters.delete(job.requestId);
        this.killWarmChild(true);
        resolve({
          ok: false,
          detail: `Kokoro 子进程异常：${error instanceof Error ? error.message : String(error)}`
        });
      }
    });
  }

  private ensureWarmChild(): Promise<ChildProcess> {
    if (this.warmChild && this.childReady && !this.warmChild.killed) {
      return Promise.resolve(this.warmChild);
    }
    if (this.spawning) return this.spawning;

    this.spawning = new Promise((resolve, reject) => {
      const workerPath = this.dependencies.workerPath ?? resolveDefaultWorkerPath();
      const cwd = resolveWorkerCwd(workerPath);
      const moduleRoot = resolveKokoroModuleRoot(cwd);
      const nodePathParts = [
        path.join(moduleRoot, "node_modules"),
        typeof process.resourcesPath === "string"
          ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules")
          : "",
        process.env.NODE_PATH || ""
      ].filter(Boolean);
      const child = fork(workerPath, [], {
        // Packaged worker lives under app.asar/out/main; `../..` is the asar FILE.
        // CreateProcess rejects a file cwd and surfaces spawn <execPath> ENOENT.
        cwd,
        execPath: process.execPath,
        execArgv: [],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          NEWBRAIN_KOKORO_MODULE_ROOT: moduleRoot,
          NODE_PATH: nodePathParts.join(path.delimiter),
          // Force CPU — never touch the display GPU from the TTS child.
          CUDA_VISIBLE_DEVICES: "-1",
          HIP_VISIBLE_DEVICES: "-1",
          ORT_DISABLE_GPU: "1",
          onnxruntime_FORCE_CPU: "1"
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        // Electron/Node ForkOptions typings omit windowsHide on some versions.
        windowsHide: true
      } as Parameters<typeof fork>[2]);

      let ready = false;
      const fail = (detail: string) => {
        this.spawning = null;
        this.warmChild = null;
        this.childReady = false;
        try {
          child.kill();
        } catch {
          // ignore
        }
        reject(new Error(detail));
      };

      child.stdout?.on("data", (chunk) => {
        void this.dependencies.appendDebugLog?.(
          `novel tts kokoro child stdout ${String(chunk).slice(0, 200)}`
        );
      });
      child.stderr?.on("data", (chunk) => {
        void this.dependencies.appendDebugLog?.(
          `novel tts kokoro child stderr ${String(chunk).slice(0, 400)}`
        );
      });

      child.on("message", (message: any) => {
        if (message?.type === "ready") {
          if (ready) return;
          ready = true;
          this.warmChild = child;
          this.childReady = true;
          this.spawning = null;
          resolve(child);
          return;
        }
        if (message?.type === "result") {
          const requestId = String(message.requestId || "");
          const waiter = requestId ? this.waiters.get(requestId) : undefined;
          if (!waiter) return;
          waiter.resolve({
            ok: Boolean(message.ok),
            audioPath: message.audioPath,
            durationMs: typeof message.durationMs === "number" ? message.durationMs : undefined,
            detail: message.detail,
            provider: message.provider || "kokoro-zh-offline",
            runtime: message.runtime || "cpu"
          });
        }
      });

      child.on("error", (error) => {
        if (!ready) {
          fail(error instanceof Error ? error.message : String(error));
          return;
        }
        this.invalidateWarmChild(child);
      });

      child.on("exit", (code, signal) => {
        this.invalidateWarmChild(child);
        if (!ready) {
          fail(`Kokoro 子进程已退出（code=${code}, signal=${signal || "-"}）。`);
          return;
        }
        for (const [requestId, waiter] of this.waiters) {
          waiter.resolve({
            ok: false,
            detail: `Kokoro 子进程已退出（code=${code}, signal=${signal || "-"}）。`
          });
          this.waiters.delete(requestId);
        }
      });
    });

    return this.spawning;
  }

  private invalidateWarmChild(child: ChildProcess) {
    if (this.warmChild === child) {
      this.warmChild = null;
      this.childReady = false;
    }
  }

  private killWarmChild(force: boolean) {
    const child = this.warmChild;
    this.warmChild = null;
    this.childReady = false;
    this.spawning = null;
    if (!child || child.killed) return;
    try {
      if (!force) {
        child.send({ type: "dispose" });
      }
    } catch {
      // ignore
    }
    try {
      child.removeAllListeners();
      child.kill();
    } catch {
      // ignore
    }
    if (force && child.pid) {
      try {
        const { spawn } = require("node:child_process") as typeof import("node:child_process");
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore"
        });
      } catch {
        // ignore
      }
    }
  }

  private clearIdleTimer() {
    if (this.releaseTimer) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = null;
    }
  }

  private bumpIdleTimer() {
    this.clearIdleTimer();
    const idleMs = this.dependencies.idleReleaseMs ?? NOVEL_TTS_KOKORO_IDLE_RELEASE_MS;
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      if (this.isRunning()) {
        this.bumpIdleTimer();
        return;
      }
      void this.dependencies.appendDebugLog?.(
        "novel tts kokoro idle dispose warm child"
      );
      this.killWarmChild(false);
    }, idleMs);
  }
}

function isDirectory(target: string) {
  try {
    return Boolean(target) && statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Prefer a real directory that can host NODE_PATH / package.json resolution. */
export function resolveWorkerCwd(workerPath: string): string {
  const packageRootGuess = path.resolve(path.dirname(workerPath), "..", "..");
  const resourcesPath = typeof process.resourcesPath === "string" ? process.resourcesPath : "";
  const unpackedRoot = resourcesPath ? path.join(resourcesPath, "app.asar.unpacked") : "";
  const installRoot = path.dirname(process.execPath);
  const candidates = [packageRootGuess, unpackedRoot, resourcesPath, installRoot, process.cwd()];

  for (const candidate of candidates) {
    if (!isDirectory(candidate)) continue;
    if (
      existsSync(path.join(candidate, "package.json"))
      || existsSync(path.join(candidate, "node_modules"))
    ) {
      return candidate;
    }
  }
  for (const candidate of candidates) {
    if (isDirectory(candidate)) return candidate;
  }
  return process.cwd();
}

export function resolveKokoroModuleRoot(cwd: string): string {
  const resourcesPath = typeof process.resourcesPath === "string" ? process.resourcesPath : "";
  const candidates = [
    cwd,
    resourcesPath ? path.join(resourcesPath, "app.asar.unpacked") : "",
    resourcesPath,
    path.dirname(process.execPath)
  ];
  for (const candidate of candidates) {
    if (!isDirectory(candidate)) continue;
    if (existsSync(path.join(candidate, "node_modules", "@uzen", "kokoro-js"))) {
      return candidate;
    }
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }
  return cwd || process.cwd();
}

function resolveDefaultWorkerPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const direct = path.join(here, "novel-tts-kokoro-worker.js");
  // Packaged builds may unpack the worker beside app.asar for ELECTRON_RUN_AS_NODE.
  const asarMarker = `${path.sep}app.asar${path.sep}`;
  if (direct.includes(asarMarker)) {
    const unpacked = direct.replace(asarMarker, `${path.sep}app.asar.unpacked${path.sep}`);
    if (existsSync(unpacked)) return unpacked;
  }
  return direct;
}
