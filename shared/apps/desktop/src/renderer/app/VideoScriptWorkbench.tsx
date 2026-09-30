import { useState, type ReactNode } from "react";
import { formatScriptSegments, validateScriptSegments, type ScriptSegment } from "./video-script-format";

interface Props {
  script: string;
  segments: ScriptSegment[];
  disabled: boolean;
  canvasControls: ReactNode;
  onScriptChange: (script: string) => void;
  onSegmentChange: (index: number, patch: Partial<ScriptSegment>) => void;
  onAdd: () => void;
  onSave: () => Promise<boolean>;
  onConfirm: () => void;
}

export function VideoScriptWorkbench(props: Props) {
  const [view, setView] = useState<"segments" | "full">("segments");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fingerprint = JSON.stringify(props.segments);
  const [reviewed, setReviewed] = useState("");
  const save = async (confirm = false) => {
    if (busy) return;
    const error = validateScriptSegments(props.segments);
    if (error) { setMessage(error); return; }
    setBusy(true);
    try {
      if (await props.onSave()) {
        setMessage("已保存到项目");
        if (confirm) props.onConfirm();
      } else setMessage("保存未完成，请检查工程状态");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  };
  return <section className="video-script-workbench" data-testid="brain-video-script-pane">
    <fieldset className="video-script-workbench__scroll" disabled={props.disabled || busy} style={{ border: 0, margin: 0, minWidth: 0 }}>
      <header><h3>叙事脚本</h3><div className="video-script-workbench__summary"><span>{props.segments.length} 段</span><span>{props.segments.reduce((sum, s) => sum + s.duration, 0).toFixed(1)} 秒</span></div></header>
      <details><summary>画幅与帧率</summary>{props.canvasControls}</details>
      <nav aria-label="脚本编辑方式"><button type="button" aria-pressed={view === "segments"} onClick={() => setView("segments")}>分段编辑</button><button type="button" aria-pressed={view === "full"} onClick={() => setView("full")}>整体创作说明</button></nav>
      {view === "full" ? <label>主题、受众、叙事风格<textarea className="video-script-workbench__full" value={props.script} onChange={e => props.onScriptChange(e.target.value)} placeholder="写下创作目标、受众与故事背景…" disabled={props.disabled} /></label> : props.segments.map((segment, index) => <article key={index}>
        <div className="video-script-workbench__segment-head"><span>{String(index + 1).padStart(2, "0")}</span><input aria-label={`第${index + 1}段标题`} value={segment.title} disabled={props.disabled} onChange={e => props.onSegmentChange(index, { title: e.target.value })} /><label><input aria-label={`第${index + 1}段时长`} type="number" min={1} max={120} step={0.5} value={segment.duration} disabled={props.disabled} onChange={e => props.onSegmentChange(index, { duration: Number(e.target.value) })} />秒</label></div>
        <label>画面与动作<textarea value={segment.prompt} disabled={props.disabled} onChange={e => props.onSegmentChange(index, { prompt: e.target.value })} /></label>
        <label>旁白 / 对白<textarea value={segment.line} disabled={props.disabled} onChange={e => props.onSegmentChange(index, { line: e.target.value })} placeholder="留空表示本段无旁白" /></label>
      </article>)}
      <button type="button" className="video-script-workbench__add" onClick={props.onAdd} disabled={props.disabled || busy}>＋ 添加一段</button>
      {review && reviewed === fingerprint ? <section className="video-script-workbench__review"><strong>分镜确认 · {props.segments.length} 镜</strong><pre>{formatScriptSegments(props.segments)}</pre><p>已有镜头素材会保留；修改脚本后，可在单镜生成中重新生成对应画面。</p></section> : null}
    </fieldset>
    <footer><p role="status">{message}</p><div><button type="button" onClick={() => void save()} disabled={props.disabled || busy}>{busy ? "保存中…" : "保存草稿"}</button><button type="button" disabled={props.disabled || busy} onClick={() => {
      const error = validateScriptSegments(props.segments);
      if (error) { setMessage(error); return; }
      if (review && reviewed === fingerprint) { void save(true); return; }
      setReviewed(fingerprint); setReview(true); setMessage("请检查分镜方案，确认后进入分镜。");
    }}>{review && reviewed === fingerprint ? "确认并进入分镜 →" : "预览分镜方案 →"}</button></div></footer>
  </section>;
}
