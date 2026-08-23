/**
 * UI-initiated BRAIN scene actions already imply user consent (button click).
 * Skip redundant Electron MessageBox prompts; Rust Core still enforces
 * ProjectBoundary + one-shot approval tokens for mutating / process ops.
 *
 * Keep native prompts only for explicit Flow `approval` nodes and other
 * non-scene surfaces that are not initiated from a dedicated scene control.
 */
export async function confirmBrainSceneUiAction(_detail?: {
  kind?: "video_render" | "music_render" | "game_preview" | "software_task";
  projectId?: string;
  summary?: string;
}): Promise<true> {
  return true;
}
