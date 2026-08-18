import { spawn, type ChildProcess } from "node:child_process";
import { unlink } from "node:fs/promises";

export type NovelTtsNativePlayResult = {
  ok: boolean;
  audioPath?: string;
  durationMs?: number;
  detail?: string;
};

/**
 * Play an on-disk WAV through Windows System.Media.SoundPlayer in a child PowerShell.
 */
export class NovelTtsNativePlayer {
  private child: ChildProcess | null = null;
  private audioPath: string | null = null;
  private readonly appendDebugLog?: (message: string) => Promise<void> | void;
  private readonly deleteOnStop: boolean;

  constructor(options?: {
    appendDebugLog?: (message: string) => Promise<void> | void;
    deleteOnStop?: boolean;
  }) {
    this.appendDebugLog = options?.appendDebugLog;
    this.deleteOnStop = options?.deleteOnStop !== false;
  }

  isPlaying() {
    return Boolean(this.child && !this.child.killed);
  }

  async playWavFile(audioPath: string, durationMs?: number): Promise<NovelTtsNativePlayResult> {
    this.stop();
    this.audioPath = audioPath;
    const psPath = audioPath.replace(/'/g, "''");
    const script = [
      `$ErrorActionPreference = 'Stop'`,
      `$p = New-Object System.Media.SoundPlayer -ArgumentList @('${psPath}')`,
      `$p.Load()`,
      `$p.PlaySync()`,
      `exit 0`
    ].join("; ");

    try {
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
      );
      this.child = child;
      void this.appendDebugLog?.(
        `novel tts native play start path=${audioPath} durationMs=${durationMs ?? "-"} pid=${child.pid || "-"}`
      );

      child.once("exit", (code, signal) => {
        void this.appendDebugLog?.(
          `novel tts native play exit code=${code ?? "-"} signal=${signal || "-"}`
        );
        if (this.child === child) this.child = null;
        if (this.deleteOnStop) void this.cleanupFile(audioPath);
      });
      child.once("error", (error) => {
        void this.appendDebugLog?.(
          `novel tts native play error ${error instanceof Error ? error.message : String(error)}`
        );
        if (this.child === child) this.child = null;
        if (this.deleteOnStop) void this.cleanupFile(audioPath);
      });

      await delay(150);
      if (child.exitCode != null && child.exitCode !== 0) {
        return { ok: false, detail: "系统无法播放离线 WAV。" };
      }
      return { ok: true, audioPath, durationMs };
    } catch (error) {
      if (this.deleteOnStop) void this.cleanupFile(audioPath);
      return {
        ok: false,
        detail: `原生播放启动失败：${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) {
      try {
        child.kill();
      } catch {
        // ignore
      }
      try {
        if (child.pid) {
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore"
          });
        }
      } catch {
        // ignore
      }
    }
    const audioPath = this.audioPath;
    this.audioPath = null;
    if (audioPath && this.deleteOnStop) void this.cleanupFile(audioPath);
  }

  private async cleanupFile(audioPath: string) {
    try {
      await unlink(audioPath);
    } catch {
      // ignore
    }
  }
}

export function estimateWavDurationMs(buffer: Buffer): number | undefined {
  if (buffer.length < 44) return undefined;
  const byteRate = buffer.readUInt32LE(28);
  const dataSize = Math.max(0, buffer.length - 44);
  if (!byteRate) return undefined;
  return Math.max(200, Math.round((dataSize / byteRate) * 1000));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
