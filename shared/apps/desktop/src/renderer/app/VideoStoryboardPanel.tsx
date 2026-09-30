import { useEffect, useState } from "react";

type StoryboardRow = { id: string; shot: string; visual: string; durationMs: number; assetFileId: string };

const emptyRow = (): StoryboardRow => ({ id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, shot: "", visual: "", durationMs: 3000, assetFileId: "" });

function parseRows(content: string): StoryboardRow[] {
  try {
    const parsed = JSON.parse(content) as { rows?: StoryboardRow[] };
    return Array.isArray(parsed.rows) ? parsed.rows : [];
  } catch {
    return content.trim() ? [{ ...emptyRow(), visual: content }] : [];
  }
}

export function VideoStoryboardPanel(props: { projectId?: string; files?: Array<{ id: string; logicalName?: string }> }) {
  const [rows, setRows] = useState<StoryboardRow[]>([emptyRow()]);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!props.projectId || !window.newbrain?.getBrainWorkspaceSection) return;
    void window.newbrain.getBrainWorkspaceSection({ projectId: props.projectId, workspaceKey: "video", sectionKey: "storyboard" })
      .then((section) => { setRows(parseRows(section.content).length ? parseRows(section.content) : [emptyRow()]); setRevision(section.revision); })
      .catch(() => undefined);
  }, [props.projectId]);

  const save = async () => {
    if (!props.projectId || !window.newbrain?.saveBrainWorkspaceSection) return;
    const section = await window.newbrain.saveBrainWorkspaceSection({
      projectId: props.projectId, workspaceKey: "video", sectionKey: "storyboard",
      content: JSON.stringify({ rows }, null, 2), expectedRevision: revision
    });
    setRevision(section.revision);
    setStatus("分镜表已保存");
  };

  const pushToTimeline = async () => {
    if (!props.projectId || !window.newbrain?.addVideoClip) return;
    let startMs = 0;
    for (const row of rows) {
      if (!row.assetFileId) continue;
      await window.newbrain.addVideoClip({
        projectId: props.projectId, trackType: "video", sourceFileId: row.assetFileId,
        startMs, durationMs: row.durationMs, sourceInMs: 0
      });
      startMs += row.durationMs;
    }
    setStatus(`已写入 ${rows.filter((row) => row.assetFileId).length} 个镜头到时间线`);
  };

  return (
    <section className="brain-storyboard-panel" data-testid="brain-video-storyboard">
      <header><strong>分镜表</strong><div><button type="button" onClick={() => setRows((current) => [...current, emptyRow()])}>添加镜头</button><button type="button" onClick={() => void save()}>保存</button><button type="button" data-testid="brain-video-storyboard-push" onClick={() => void pushToTimeline()}>写入时间线</button></div></header>
      <table><thead><tr><th>镜号</th><th>画面</th><th>时长(ms)</th><th>素材</th></tr></thead><tbody>
        {rows.map((row, index) => (
          <tr key={row.id}>
            <td><input value={row.shot} onChange={(e) => setRows((current) => current.map((item, i) => i === index ? { ...item, shot: e.target.value } : item))} /></td>
            <td><input value={row.visual} onChange={(e) => setRows((current) => current.map((item, i) => i === index ? { ...item, visual: e.target.value } : item))} /></td>
            <td><input type="number" value={row.durationMs} onChange={(e) => setRows((current) => current.map((item, i) => i === index ? { ...item, durationMs: Number(e.target.value) || 0 } : item))} /></td>
            <td><select value={row.assetFileId} onChange={(e) => setRows((current) => current.map((item, i) => i === index ? { ...item, assetFileId: e.target.value } : item))}><option value="">选择素材</option>{(props.files || []).map((file) => <option key={file.id} value={file.id}>{file.logicalName || file.id}</option>)}</select></td>
          </tr>
        ))}
      </tbody></table>
      {status ? <p>{status}</p> : null}
    </section>
  );
}
