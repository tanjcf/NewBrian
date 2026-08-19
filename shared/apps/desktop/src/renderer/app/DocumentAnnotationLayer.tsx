import type { BrainAnnotationDto, BrainFileDto } from "@codex-forge/protocol";
import type { DocumentAnchor } from "@codex-forge/protocol/document-anchor";
import { currentDocumentAnnotations } from "./document-annotation-policy";

export function DocumentAnnotationLayer(props: {
  file: BrainFileDto | null;
  annotations: BrainAnnotationDto[];
  active: boolean;
  candidate: DocumentAnchor | null;
  instruction: string;
  busy: boolean;
  onToggle: () => void;
  onInstructionChange: (value: string) => void;
  onSave: () => void;
  onSendToChat: (annotation: BrainAnnotationDto) => void;
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
    </section>
  );
}
