import { useEffect, useState } from "react";

type CaptionCue = { id: string; startMs: number; endMs: number; text: string };

const emptyCue = (): CaptionCue => ({ id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, startMs: 0, endMs: 3000, text: "" });

function parseCaptionContent(content: string): CaptionCue[] {
  try {
    const parsed = JSON.parse(content) as { cues?: CaptionCue[] };
    return Array.isArray(parsed.cues) ? parsed.cues : [];
  } catch {
    return content.trim() ? [{ ...emptyCue(), text: content }] : [];
  }
}

function toSrt(cues: CaptionCue[]) {
  return cues.filter((cue) => cue.text.trim()).map((cue, index) => {
    const start = formatTs(cue.startMs);
    const end = formatTs(cue.endMs);
    return `${index + 1}\n${start} --> ${end}\n${cue.text}\n`;
  }).join("\n").trim();
}

function formatTs(ms: number) {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1_000);
  const msPart = total % 1_000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(msPart).padStart(3, "0")}`;
}

export function VideoCaptionPanel(props: { projectId?: string }) {
  const [cues, setCues] = useState<CaptionCue[]>([emptyCue()]);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!props.projectId || !window.newbrain?.getBrainWorkspaceSection) return;
    void window.newbrain.getBrainWorkspaceSection({ projectId: props.projectId, workspaceKey: "video", sectionKey: "caption" })
      .then((section) => {
        const loaded = parseCaptionContent(section.content);
        setCues(loaded.length ? loaded : [emptyCue()]);
        setRevision(section.revision);
      })
      .catch(() => undefined);
  }, [props.projectId]);

  const save = async () => {
    if (!props.projectId || !window.newbrain?.saveBrainWorkspaceSection) return;
    const section = await window.newbrain.saveBrainWorkspaceSection({
      projectId: props.projectId, workspaceKey: "video", sectionKey: "caption",
      content: JSON.stringify({ cues }, null, 2), expectedRevision: revision
    });
    setRevision(section.revision);
    setStatus("字幕草稿已保存");
  };

  const importToTimeline = async () => {
    const srt = toSrt(cues);
    if (!props.projectId || !window.newbrain?.importVideoSubtitles) {
      setStatus("字幕轨接口不可用");
      return;
    }
    await window.newbrain.importVideoSubtitles({ projectId: props.projectId, srt });
    setStatus("SRT 已写入视频字幕轨");
  };

  return (
    <section className="brain-caption-panel" data-testid="brain-video-caption-panel">
      <header>
        <strong>字幕与配音</strong>
        <div>
          <button type="button" onClick={() => setCues((current) => [...current, emptyCue()])}>添加字幕</button>
          <button type="button" onClick={() => void save()}>保存草稿</button>
          <button type="button" data-testid="brain-video-caption-import" onClick={() => void importToTimeline()}>写入字幕轨</button>
        </div>
      </header>
      <table><thead><tr><th>入点(ms)</th><th>出点(ms)</th><th>台词</th></tr></thead><tbody>
        {cues.map((cue, index) => (
          <tr key={cue.id}>
            <td><input type="number" value={cue.startMs} onChange={(e) => setCues((current) => current.map((item, i) => i === index ? { ...item, startMs: Number(e.target.value) || 0 } : item))} /></td>
            <td><input type="number" value={cue.endMs} onChange={(e) => setCues((current) => current.map((item, i) => i === index ? { ...item, endMs: Number(e.target.value) || 0 } : item))} /></td>
            <td><input value={cue.text} onChange={(e) => setCues((current) => current.map((item, i) => i === index ? { ...item, text: e.target.value } : item))} /></td>
          </tr>
        ))}
      </tbody></table>
      {status ? <p data-testid="brain-video-caption-status">{status}</p> : null}
    </section>
  );
}
