import { useEffect, useState } from "react";
import type { AnnotationMarkingTool, BrainAnnotationDto } from "@codex-forge/protocol";
import type { DocumentRect, DocumentViewport } from "@codex-forge/protocol/document-anchor";
import { DocumentMarkingLayer } from "./DocumentMarkingLayer";

type HtmlPreviewMode = "preview" | "source";

export type HtmlMarkingProps = {
  active: boolean;
  tool: AnnotationMarkingTool;
  color: string;
  savedAnnotations?: BrainAnnotationDto[];
  pendingMark?: { rect: DocumentRect; tool: AnnotationMarkingTool; color: string } | null;
  onComplete: (input: { rect: DocumentRect; viewport: DocumentViewport; host: HTMLElement }) => void;
};

export function WorkspaceHtmlViewer(props: {
  name: string;
  content: string;
  previewUrl: string;
  refreshToken: number;
  marking?: HtmlMarkingProps;
}) {
  const [mode, setMode] = useState<HtmlPreviewMode>("preview");

  useEffect(() => {
    setMode("preview");
  }, [props.previewUrl]);

  return (
    <div className="workspace-artifact-html" data-testid="workspace-html-viewer">
      <div className="workspace-html-toolbar" role="tablist" aria-label="HTML 预览模式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "preview"}
          className={mode === "preview" ? "active" : undefined}
          onClick={() => setMode("preview")}
        >
          预览
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "source"}
          className={mode === "source" ? "active" : undefined}
          onClick={() => setMode("source")}
        >
          源码
        </button>
      </div>
      <div className="workspace-artifact-html-stage">
        {mode === "preview" ? (
          <iframe
            key={`${props.previewUrl}:${props.refreshToken}`}
            className="workspace-artifact-html-frame"
            title={props.name}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            src={props.previewUrl}
          />
        ) : (
          <pre className="workspace-artifact-html-source"><code>{props.content}</code></pre>
        )}
        {props.marking ? (
          <DocumentMarkingLayer
            active={props.marking.active}
            tool={props.marking.tool}
            color={props.marking.color}
            savedAnnotations={props.marking.savedAnnotations}
            pendingMark={props.marking.pendingMark}
            onComplete={props.marking.onComplete}
          />
        ) : null}
      </div>
    </div>
  );
}
