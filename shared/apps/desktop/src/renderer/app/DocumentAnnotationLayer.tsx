import type { AnnotationMarkingTool, BrainAnnotationDto, BrainChangeSetDto, BrainChangeSetPreviewResult, BrainFileDto } from "@codex-forge/protocol";
import type { DocumentAnchor } from "@codex-forge/protocol/document-anchor";
import { currentDocumentAnnotations } from "./document-annotation-policy";
import { resolveAnnotationSnapshotPreview } from "./document-annotation-snapshot";
import { DocumentMarkingToolbar } from "./DocumentMarkingToolbar";

export function DocumentAnnotationLayer(props: {
  file: BrainFileDto | null;
  annotations: BrainAnnotationDto[];
  changeSets: BrainChangeSetDto[];
  preview: BrainChangeSetPreviewResult | null;
  active: boolean;
  candidate: DocumentAnchor | null;
  candidateSnapshotUrl?: string;
  instruction: string;
  busy: boolean;
  markingTool: AnnotationMarkingTool;
  markingColor: string;
  onToggle: () => void;
  onMarkingToolChange: (tool: AnnotationMarkingTool) => void;
  onMarkingColorChange: (color: string) => void;
  onInstructionChange: (value: string) => void;
  onSave: () => void;
  onSendToChat: (annotation: BrainAnnotationDto) => void;
  onPreviewChangeSet: (changeSet: BrainChangeSetDto) => void;
  onReviewChangeSet: (changeSet: BrainChangeSetDto, status: "ACCEPTED" | "REJECTED") => void;
  onExportChangeSet: (changeSet: BrainChangeSetDto) => void;
}) {
  if (!props.file) return null;
  const current = currentDocumentAnnotations(props.annotations.filter((item) => item.fileId === props.file?.id));
  const statusHint = props.candidate
    ? "已标记区域，请描述修改要求"
    : props.active
      ? "在文档上拖动标记笔，框选需要修改的内容"
      : `${current.length} 条标注 · 改表格/排版请用系统应用打开`;
  return (
    <section className={`document-annotation-layer${props.active ? " active" : ""}`} aria-label="文档标注">
      <div className="document-annotation-toolbar">
        <button type="button" className={props.active ? "active" : ""} aria-pressed={props.active} onClick={props.onToggle}>
          <span aria-hidden="true">✎</span>{props.active ? "结束标注" : "画笔标注"}
        </button>
        <DocumentMarkingToolbar
          active={props.active}
          tool={props.markingTool}
          color={props.markingColor}
          onToolChange={props.onMarkingToolChange}
          onColorChange={props.onMarkingColorChange}
        />
        <span>{statusHint}</span>
      </div>
      {props.active && props.candidate ? (
        <form className="document-annotation-editor" onSubmit={(event) => { event.preventDefault(); props.onSave(); }}>
          {props.candidateSnapshotUrl ? (
            <div className="document-annotation-snapshot-preview" aria-label="标记区域截图">
              <img src={props.candidateSnapshotUrl} alt="标记区域预览" />
              <span>已捕获标记区域截图</span>
            </div>
          ) : null}
          <label>描述修改要求<input value={props.instruction} autoFocus onChange={(event) => props.onInstructionChange(event.target.value)} placeholder="例如：改得更简洁，并保留关键数字" /></label>
          <button type="submit" disabled={props.busy || !props.instruction.trim()}>{props.busy ? "保存中…" : "保存标注"}</button>
        </form>
      ) : null}
      {current.length ? (
        <div className="document-annotation-list">
          {current.map((annotation, index) => {
            const snapshotUrl = resolveAnnotationSnapshotPreview(annotation.geometry);
            return (
            <article key={annotation.id} data-status={annotation.status.toLowerCase()}>
              {snapshotUrl ? (
                <div className="document-annotation-snapshot-thumb" aria-hidden="true">
                  <img src={snapshotUrl} alt="" />
                </div>
              ) : null}
              <i>{annotation.geometry?.displayIndex || index + 1}</i>
              <span><strong>{annotation.instruction}</strong><small>{annotation.selectedText?.trim() || "标记区域"}</small></span>
              <button
                type="button"
                disabled={!annotation.instruction.trim()}
                title={annotation.instruction.trim() ? "将标记位置、截图与修改要求加入左侧对话" : "请先填写修改要求"}
                onClick={() => props.onSendToChat(annotation)}
              >加入对话</button>
            </article>
            );
          })}
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
