import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Minimum free/total VRAM (MB) before preferring GPU for Kokoro-class models. */
export const NOVEL_TTS_GPU_MIN_VRAM_MB = 2_048;

export type NovelTtsGpuProbeResult = {
  preferred: "gpu" | "cpu";
  reason: string;
  gpuName?: string;
  vramTotalMb?: number;
};

function parseNvidiaSmiCsv(stdout: string): { name: string; totalMb: number } | null {
  const line = String(stdout || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) return null;
  const parts = line.split(",").map((part) => part.trim());
  if (parts.length < 2) return null;
  const totalMb = Number(parts[1]);
  if (!Number.isFinite(totalMb) || totalMb <= 0) return null;
  return { name: parts[0] || "NVIDIA GPU", totalMb: Math.floor(totalMb) };
}

/**
 * Probe whether a discrete NVIDIA GPU is usable for offline Kokoro.
 * Non-NVIDIA / missing driver → CPU. Does not load the TTS engine.
 */
export async function probeNovelTtsGpu(options?: {
  execFileImpl?: typeof execFileAsync;
  minVramMb?: number;
}): Promise<NovelTtsGpuProbeResult> {
  const minVramMb = options?.minVramMb ?? NOVEL_TTS_GPU_MIN_VRAM_MB;
  const run = options?.execFileImpl ?? execFileAsync;
  try {
    const { stdout } = await run(
      "nvidia-smi",
      ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 2_500, windowsHide: true }
    );
    const parsed = parseNvidiaSmiCsv(stdout);
    if (!parsed) {
      return { preferred: "cpu", reason: "nvidia_smi_unparsed" };
    }
    if (parsed.totalMb < minVramMb) {
      return {
        preferred: "cpu",
        reason: "vram_below_threshold",
        gpuName: parsed.name,
        vramTotalMb: parsed.totalMb
      };
    }
    return {
      preferred: "gpu",
      reason: "nvidia_ok",
      gpuName: parsed.name,
      vramTotalMb: parsed.totalMb
    };
  } catch {
    return { preferred: "cpu", reason: "nvidia_smi_unavailable" };
  }
}

export const __testOnly = { parseNvidiaSmiCsv };
