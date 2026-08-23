import type { BrainWorkspaceKey } from "@codex-forge/protocol";

export type EngineEnsureFn = (engineId: string) => Promise<{ engineId: string; executable: string; source: string; version: string }>;

const sceneEngines: Partial<Record<BrainWorkspaceKey, string[]>> = {
  video: ["ffmpeg", "ffprobe"],
  music: ["ffmpeg", "ffprobe"],
  game: ["node"]
};

/** Ensures ffmpeg/node/etc. when user enters a creative workspace scene. */
export async function ensureEnginesForWorkspaceKey(workspaceKey: BrainWorkspaceKey, ensure: EngineEnsureFn) {
  const engines = sceneEngines[workspaceKey] || [];
  const results = [];
  for (const engineId of engines) {
    try {
      results.push(await ensure(engineId));
    } catch {
      /* policy-off or network blocked — scene still loads with manual retry */
    }
  }
  return results;
}

/** Parallel bootstrap on app start (conda runs separately). */
export async function ensureDesktopEnginesInitialized(ensure: EngineEnsureFn) {
  const bootstrap = ["ffmpeg", "ffprobe", "node"];
  await Promise.all(bootstrap.map(async (engineId) => {
    try { await ensure(engineId); } catch { /* optional at cold start */ }
  }));
}
