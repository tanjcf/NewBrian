import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { AnnotationGeometry, AnnotationMarkingTool, BrainAnnotationDto } from "@codex-forge/protocol";
import type { DocumentCoordinateTransform, DocumentRect, DocumentViewport } from "@codex-forge/protocol/document-anchor";
import { projectDocumentRect } from "@codex-forge/protocol/document-anchor";

export type DocumentMarkPrompt = {
  instruction: string;
  busy: boolean;
  page?: number;
  onInstructionChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
};

const DocumentMarkPromptContext = createContext<DocumentMarkPrompt | null>(null);

export function DocumentMarkPromptProvider(props: { value: DocumentMarkPrompt | null; children: ReactNode }) {
  return <DocumentMarkPromptContext.Provider value={props.value}>{props.children}</DocumentMarkPromptContext.Provider>;
}

function markPromptIcon(paths: string) {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths.split("|").map((d) => <path key={d} d={d} />)}</svg>;
}

export type DocumentMarkingLayerProps = {
  active: boolean;
  tool: AnnotationMarkingTool;
  color: string;
  savedAnnotations?: BrainAnnotationDto[];
  pendingMark?: { rect: DocumentRect; tool: AnnotationMarkingTool; color: string } | null;
  pageFilter?: number;
  transform?: DocumentCoordinateTransform;
  onComplete: (input: { rect: DocumentRect; viewport: DocumentViewport; host: HTMLElement }) => void;
};

type DragState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

function normalizeDragRect(drag: DragState): DocumentRect {
  const x = Math.min(drag.startX, drag.currentX);
  const y = Math.min(drag.startY, drag.currentY);
  const width = Math.abs(drag.currentX - drag.startX);
  const height = Math.abs(drag.currentY - drag.startY);
  return { x, y, width, height };
}

function projectable(annotation: BrainAnnotationDto) {
  return Boolean(annotation.anchor.rect && annotation.anchor.transform);
}

/** Captures free-form drag marks and renders saved annotation overlays. */
export function DocumentMarkingLayer(props: DocumentMarkingLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<DocumentViewport>({ width: 0, height: 0 });
  const [drag, setDrag] = useState<DragState | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const bounds = host.getBoundingClientRect();
      setViewport({ width: Math.max(0, bounds.width), height: Math.max(0, bounds.height) });
    };
    update();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(host);
    return () => observer?.disconnect();
  }, []);

  const draftRect = drag ? normalizeDragRect(drag) : null;
  const markPrompt = useContext(DocumentMarkPromptContext);
  const savedMarks = (props.savedAnnotations || []).filter((annotation) => {
    if (!projectable(annotation)) return false;
    if (props.pageFilter != null && "page" in annotation.anchor && typeof annotation.anchor.page === "number") {
      return annotation.anchor.page === props.pageFilter;
    }
    return true;
  });

  return (
    <div
      ref={hostRef}
      className={`document-marking-canvas document-marking-layer${props.active ? " active" : ""}`}
      data-testid="document-marking-layer"
      aria-hidden={!props.active}
      onPointerDown={(event) => {
        if (!props.active || event.button !== 0) return;
        const host = hostRef.current;
        if (!host) return;
        const bounds = host.getBoundingClientRect();
        const startX = event.clientX - bounds.left;
        const startY = event.clientY - bounds.top;
        setDrag({ startX, startY, currentX: startX, currentY: startY });
        host.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        const host = hostRef.current;
        if (!host) return;
        const bounds = host.getBoundingClientRect();
        setDrag({
          ...drag,
          currentX: event.clientX - bounds.left,
          currentY: event.clientY - bounds.top
        });
      }}
      onPointerUp={(event) => {
        if (!drag) return;
        const host = hostRef.current;
        if (!host) return;
        const bounds = host.getBoundingClientRect();
        const rect = normalizeDragRect({
          ...drag,
          currentX: event.clientX - bounds.left,
          currentY: event.clientY - bounds.top
        });
        setDrag(null);
        host.releasePointerCapture(event.pointerId);
        if (rect.width >= 6 && rect.height >= 6 && viewport.width > 0 && viewport.height > 0) {
          props.onComplete({ rect, viewport, host });
        }
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {savedMarks.map((annotation) => {
        const anchor = annotation.anchor;
        if (!anchor.rect || !anchor.transform) return null;
        let projected: DocumentRect;
        try {
          projected = projectDocumentRect(anchor.rect, anchor.transform, viewport);
        } catch {
          return null;
        }
        return (
          <div
            key={annotation.id}
            className={`document-marking-saved${annotation.geometry.style.tool === "highlight" ? " highlight" : " select-rect"}`}
            data-testid="document-marking-saved"
            style={{
              left: `${projected.x}px`,
              top: `${projected.y}px`,
              width: `${Math.max(4, projected.width)}px`,
              height: `${Math.max(4, projected.height)}px`,
              ["--mark-color" as string]: annotation.geometry.style.color
            }}
            title={annotation.instruction}
          />
        );
      })}
      {draftRect && props.active ? (
        <div
          className={`document-marking-draft${props.tool === "highlight" ? " highlight" : " select-rect"}`}
          data-testid="document-marking-draft"
          style={{
            left: `${draftRect.x}px`,
            top: `${draftRect.y}px`,
            width: `${draftRect.width}px`,
            height: `${draftRect.height}px`,
            ["--mark-color" as string]: props.color
          }}
        />
      ) : null}
      {!draftRect && props.pendingMark ? (
        <div
          className={`document-marking-pending${props.pendingMark.tool === "highlight" ? " highlight" : " select-rect"}`}
          data-testid="document-marking-pending"
          style={{
            left: `${props.pendingMark.rect.x}px`,
            top: `${props.pendingMark.rect.y}px`,
            width: `${Math.max(4, props.pendingMark.rect.width)}px`,
            height: `${Math.max(4, props.pendingMark.rect.height)}px`,
            ["--mark-color" as string]: props.pendingMark.color
          }}
        />
      ) : null}
      {!draftRect && props.pendingMark && markPrompt && (markPrompt.page == null || props.pageFilter == null || markPrompt.page === props.pageFilter) ? (
        <form
          className="pptx-mark-prompt"
          data-testid="document-mark-prompt"
          style={{ left: props.pendingMark.rect.x, top: props.pendingMark.rect.y + props.pendingMark.rect.height + 10, width: Math.max(props.pendingMark.rect.width, 240) }}
          onSubmit={(event) => { event.preventDefault(); markPrompt.onSubmit(); }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <input
            placeholder="描述你想要的修改"
            autoFocus
            value={markPrompt.instruction}
            onChange={(event) => markPrompt.onInstructionChange(event.target.value)}
          />
          <button className="send" type="submit" aria-label="发送修改" title="发送到对话" disabled={markPrompt.busy || !markPrompt.instruction.trim()}>{markPromptIcon("M12 19V6|m6 11 6-6 6 6")}</button>
          <button type="button" aria-label="删除标记" title="删除标记" onClick={() => markPrompt.onClear()}>{markPromptIcon("M3 6h18|M8 6V4h8v2|M19 6l-1 14H6L5 6")}</button>
        </form>
      ) : null}
    </div>
  );
}

export function renderTextLineMarks(props: {
  annotations: BrainAnnotationDto[];
  fileId: string;
  format: "txt" | "markdown";
}) {
  const marks = props.annotations.filter((annotation) => annotation.fileId === props.fileId && annotation.anchor.format === props.format);
  return marks.flatMap((annotation) => {
    if (annotation.anchor.locator.kind !== "text-range") return [];
    const color = annotation.geometry?.style.color || "#FFEB3B";
    const tool = annotation.geometry?.style.tool || "highlight";
    const lines: number[] = [];
    for (let line = annotation.anchor.locator.startLine; line <= annotation.anchor.locator.endLine; line += 1) lines.push(line);
    return lines.map((line) => ({ line, color, tool, annotationId: annotation.id }));
  });
}

export function annotationGeometryStyle(geometry?: AnnotationGeometry) {
  return {
    tool: geometry?.style.tool || "select-rect",
    color: geometry?.style.color || "#FFEB3B"
  } as const;
}
