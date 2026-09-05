export interface ScriptSegment { title: string; prompt: string; line: string; duration: number }

export function formatScriptSegments(segments: readonly ScriptSegment[]): string {
  return segments.map((s, index) => `【${index + 1} · ${s.title} · ${s.duration} 秒】\n画面：${s.prompt}\n旁白：${s.line}`).join("\n\n");
}

export function validateScriptSegments(segments: readonly ScriptSegment[]): string | null {
  if (!segments.length) return "请先添加至少一段叙事";
  if (segments.some(s => !s.title.trim() || !s.prompt.trim())) return "每段都需要标题和画面描述";
  if (segments.some(s => !Number.isFinite(s.duration) || s.duration < 1 || s.duration > 120)) return "每段时长应在 1–120 秒之间";
  return null;
}
