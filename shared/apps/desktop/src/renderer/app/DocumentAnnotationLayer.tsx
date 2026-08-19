import type { BrainAnnotationDto, BrainChangeSetDto, BrainChangeSetPreviewResult, BrainFileDto } from "@codex-forge/protocol";
import type { DocumentAnchor } from "@codex-forge/protocol/document-anchor";
import { currentDocumentAnnotations } from "./document-annotation-policy";

export function DocumentAnnotationLayer(props: {
  file: BrainFileDto | null;
  annotations: BrainAnnotationDto[];
  changeSets: BrainChangeSetDto[];
  preview: BrainChangeSetPreviewResult | null;
  active: boolean;
  candidate: DocumentAnchor | null;
  availableAnchors: DocumentAnchor[];
  instruction: string;
  busy: boolean;
  onToggle: () => void;
  onSelectAnchor: (anchor: DocumentAnchor) => void;
  onInstructionChange: (value: string) => void;
  onSave: () => void;
  onSendToChat: (annotation: BrainAnnotationDto) => void;
  onPreviewChangeSet: (changeSet: BrainChangeSetDto) => void;
  onReviewChangeSet: (changeSet: BrainChangeSetDto, status: "ACCEPTED" | "REJECTED") => void;
  onExportChangeSet: (changeSet: BrainChangeSetDto) => void;
}) {
  if (!props.file) return null;
  const current = currentDocumentAnnotations(props.annotations.filter((item) => item.fileId === props.file?.id));
  return (
    <section className={`document-annotation-layer${props.active ? " active" : ""}`} aria-label="文档标注">
      <div className="document-annotation-toolbar">
        <button type="button" className={props.active ? "active" : ""} aria-pressed={props.active} onClick={props.onToggle}>
          <span aria-hidden="true">✎</span>{props.active ? "结束标注" : "画笔标注"}
        </button>
        <span>{props.candidate ? `已选择 ${props.candidate.anchorId}` : props.active ? "请点击需要修改的内容" : `${current.length} 条标注`}</span>
      </div>
      {props.active && props.candidate ? (
        <form className="document-annotation-editor" onSubmit={(event) => { event.preventDefault(); props.onSave(); }}>
          <label>修改要求<input value={props.instruction} autoFocus onChange={(event) => props.onInstructionChange(event.target.value)} placeholder="例如：改得更简洁，并保留关键数字" /></label>
          <button type="submit" disabled={props.busy || !props.instruction.trim()}>{props.busy ? "保存中…" : "保存标注"}</button>
        </form>
      ) : null}
      {props.active && !props.candidate && props.availableAnchors.length ? (
        <div className="document-anchor-picker" aria-label="可标注文档对象">
          {props.availableAnchors.slice(0, 100).map((anchor) => (
            <button type="button" key={anchor.anchorId} onClick={() => props.onSelectAnchor(anchor)}>
              <strong>{anchor.selectedText?.trim() || anchor.objectId}</strong><small>{anchor.anchorId}</small>
            </button>
          ))}
          {props.availableAnchors.length > 100 ? <small>当前显示前 100 个对象，请缩小页码、工作表或内容范围。</small> : null}
        </div>
      ) : null}
      {current.length ? (
        <div className="document-annotation-list">
          {current.map((annotation, index) => (
            <article key={annotation.id} data-status={annotation.status.toLowerCase()}>
              <i>{index + 1}</i>
              <span><strong>{annotation.instruction}</strong><small>{annotation.selectedText || annotation.anchor.anchorId}</small></span>
              <button type="button" onClick={() => props.onSendToChat(annotation)}>加入对话</button>
            </article>
          ))}
        </div>
      ) : null}
      {props.changeSets.length ? (
        <div className="document-change-set-list" aria-label="修改方案">
          <strong>修改方案</strong>
          {props.changeSets.map((changeSet) => (
            <article key={changeSet.id} data-status={changeSet.status.toLowerCase()}>
              <span><b>{changeSet.changeSummary}</b><small>{changeSet.status === "PROPOSED" ? "等待确认" : changeSet.status === "ACCEPTED" ? (changeSet.resultFileVersion ? `已导出 v${changeSet.resultFileVersion}` : "已接受") : "已拒绝"}</small></span>
              <div>
                <button type="button" disabled={props.busy} onClick={() => props.onPreviewChangeSet(changeSet)}>预览</button>
                {changeSet.status === "PROPOSED" ? <>
                  <button type="button" disabled={props.busy} onClick={() => props.onReviewChangeSet(changeSet, "REJECTED")}>拒绝</button>
                  <button type="button" disabled={props.busy} onClick={() => props.onReviewChangeSet(changeSet, "ACCEPTED")}>接受</button>
                </> : null}
                {changeSet.status === "ACCEPTED" && !changeSet.resultFileVersion ? (
                  <button type="button" disabled={props.busy} onClick={() => props.onExportChangeSet(changeSet)}>导出新版本</button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {props.preview ? (
        <section className="document-change-preview" aria-label="修改预览">
          <header><strong>修改前后对比</strong><small>{props.preview.relativePath} · v{props.preview.fileVersion}</small></header>
          <div><pre>{props.preview.before}</pre><pre>{props.preview.after}</pre></div>
        </section>
      ) : null}
    </section>
  );
}
