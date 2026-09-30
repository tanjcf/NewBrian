/**
 * Map UI transition id → FFmpeg xfade.
 * Default / unknown / cut / none → hard cut (caller uses concat, no xfade).
 */
export function mapXfadeTransition(raw: string | undefined): { name: string; durationSec: number } | null {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key || key === "cut" || key === "none" || /硬切/.test(key)) return null;
  if (key === "fade-0.6" || key === "0.6") return { name: "fade", durationSec: 0.6 };
  if (key === "fade" || key === "淡入淡出") return { name: "fade", durationSec: 0.3 };
  if (key === "dissolve" || key === "叠化") return { name: "dissolve", durationSec: 0.25 };
  if (key === "wipe-left" || key === "划像" || /wipe/.test(key)) return { name: "wipeleft", durationSec: 0.25 };
  // FFmpeg xfade `hblur` = horizontal blur dissolve (maps UI 模糊过渡).
  if (key === "blur" || /模糊/.test(key)) return { name: "hblur", durationSec: 0.25 };
  // Do not invent dissolves/fades for unrecognized values — hard cut only.
  return null;
}
