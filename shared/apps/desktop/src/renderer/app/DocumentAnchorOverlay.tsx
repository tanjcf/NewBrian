import { useLayoutEffect, useRef, useState } from "react";
import type { DocumentAnchor, DocumentRect } from "@codex-forge/protocol/document-anchor";
import { projectDocumentRect } from "@codex-forge/protocol/document-anchor";

export type DocumentAnchorOverlayProps = {
  anchors: DocumentAnchor[];
  active: boolean;
  selectedAnchorId?: string | null;
  pageFilter?: number;
  sheetFilter?: string;
  onSelectAnchor?: (anchor: DocumentAnchor) => void;
};

function projectable(anchor: DocumentAnchor): anchor is DocumentAnchor & { rect: DocumentRect; transform: NonNullable<DocumentAnchor["transform"]> } {
  return Boolean(anchor.rect && anchor.transform);
}

/** Projects stable document object rects into the current viewer viewport. */
export function DocumentAnchorOverlay(props: DocumentAnchorOverlayProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

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

  const overlays = props.anchors.filter((anchor) => {
    if (!projectable(anchor)) return false;
    if (props.pageFilter != null && "page" in anchor && typeof anchor.page === "number" && anchor.page !== props.pageFilter) return false;
    if (props.sheetFilter && "sheet" in anchor && typeof anchor.sheet === "string" && anchor.sheet !== props.sheetFilter) return false;
    return true;
  });

  return (
    <div
      ref={hostRef}
      className={`document-anchor-overlay${props.active ? " active" : ""}`}
      data-testid="document-anchor-overlay"
      aria-hidden={!props.active}
    >
      {props.active && viewport.width > 0 && viewport.height > 0
        ? overlays.map((anchor) => {
          if (!projectable(anchor)) return null;
          let projected: DocumentRect;
          try {
            projected = projectDocumentRect(anchor.rect, anchor.transform, viewport);
          } catch {
            return null;
          }
          const selected = props.selectedAnchorId === anchor.anchorId;
          return (
            <button
              type="button"
              key={anchor.anchorId}
              className={`document-anchor-hit${selected ? " selected" : ""}`}
              data-testid="document-anchor-hit"
              data-object-id={anchor.objectId}
              data-anchor-id={anchor.anchorId}
              title={anchor.selectedText?.trim() || anchor.objectId}
              style={{
                left: `${projected.x}px`,
                top: `${projected.y}px`,
                width: `${Math.max(8, projected.width)}px`,
                height: `${Math.max(8, projected.height)}px`
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onSelectAnchor?.(anchor);
              }}
            >
              <span>{anchor.objectId}</span>
            </button>
          );
        })
        : null}
    </div>
  );
}
