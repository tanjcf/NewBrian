import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from "@aiden0z/pptx-renderer";
import type { AnnotationMarkingTool, BrainAnnotationDto, WorkspaceArtifactPreview } from "@codex-forge/protocol";
import type { DocumentRect, DocumentViewport } from "@codex-forge/protocol/document-anchor";
import { DocumentMarkingLayer } from "./DocumentMarkingLayer";

type SlidesResource = {
  resourceUri: string;
  artifactType: "slides";
  preview: Extract<WorkspaceArtifactPreview, { kind: "pptx" }>;
};

export type SlidesMarkingProps = {
  annotationActive: boolean;
  markingTool: AnnotationMarkingTool;
  markingColor: string;
  savedAnnotations: BrainAnnotationDto[];
  pendingMark: { rect: DocumentRect; tool: AnnotationMarkingTool; color: string } | null;
  onMarkComplete: (input: { rect: DocumentRect; viewport: DocumentViewport; slide: number; captureTarget: HTMLElement }) => void;
};

type ArtifactFileViewer = ComponentType<{ resource: SlidesResource; marking?: SlidesMarkingProps }>;
const viewerRegistry = new Map<SlidesResource["artifactType"], ArtifactFileViewer>();

function dataUrlToBytes(dataUrl: string) {
  const binary = window.atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function BuiltinSlidesFileViewer({ resource, marking }: { resource: SlidesResource; marking?: SlidesMarkingProps }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PptxViewer | null>(null);
  const [state, setState] = useState({ loading: true, error: "", slideCount: 0, currentSlide: 0, navigating: false });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let canceled = false;
    const abortController = new AbortController();
    const bytes = dataUrlToBytes(resource.preview.dataUrl);
    void PptxViewer.open(bytes.buffer, host, {
      renderMode: "slide",
      fitMode: "contain",
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      pdfjs: false,
      signal: abortController.signal,
      onSlideChange: (index) => setState((current) => ({ ...current, currentSlide: index, navigating: false }))
    }).then((viewer) => {
      if (canceled) {
        viewer.destroy();
        return;
      }
      viewerRef.current = viewer;
      setState({ loading: false, error: "", slideCount: viewer.slideCount, currentSlide: viewer.currentSlideIndex, navigating: false });
    }).catch((error: unknown) => {
      if (!canceled) setState({ loading: false, error: error instanceof Error ? error.message : String(error), slideCount: 0, currentSlide: 0, navigating: false });
    });
    return () => {
      canceled = true;
      abortController.abort();
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [resource]);

  const navigate = async (delta: number) => {
    const viewer = viewerRef.current;
    if (!viewer || state.navigating) return;
    const target = Math.min(viewer.slideCount - 1, Math.max(0, viewer.currentSlideIndex + delta));
    if (target === viewer.currentSlideIndex) return;
    setState((current) => ({ ...current, navigating: true }));
    try {
      await viewer.renderSlide(target);
      setState((current) => ({ ...current, currentSlide: viewer.currentSlideIndex, navigating: false }));
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error), navigating: false }));
    }
  };

  const currentSlideNumber = state.currentSlide + 1;

  return <div className="workspace-artifact-pptx" data-resource-uri={resource.resourceUri} data-slide-count={state.slideCount} data-current-slide={state.currentSlide}>
    {state.loading ? <div className="search-file-preview-state">正在加载演示文稿...</div> : null}
    {state.error ? <div className="search-file-preview-state error">PPTX 加载失败：{state.error}</div> : null}
    {!state.loading && !state.error ? <div className="workspace-pptx-toolbar">
      <button type="button" aria-label="上一页" title="上一页" disabled={state.currentSlide <= 0 || state.navigating} onClick={() => void navigate(-1)}>‹</button>
      <span>{currentSlideNumber}/{state.slideCount}</span>
      <button type="button" aria-label="下一页" title="下一页" disabled={state.currentSlide >= state.slideCount - 1 || state.navigating} onClick={() => void navigate(1)}>›</button>
    </div> : null}
    <div className="workspace-artifact-pptx-stage">
      <div className="workspace-artifact-pptx-host" ref={hostRef} />
      {marking ? (
        <DocumentMarkingLayer
          active={marking.annotationActive}
          tool={marking.markingTool}
          color={marking.markingColor}
          savedAnnotations={marking.savedAnnotations}
          pendingMark={marking.annotationActive ? marking.pendingMark : null}
          pageFilter={currentSlideNumber}
          onComplete={({ rect, viewport, host }) => {
            if (!marking.annotationActive) return;
            marking.onMarkComplete({ rect, viewport, slide: currentSlideNumber, captureTarget: hostRef.current || host });
          }}
        />
      ) : null}
    </div>
  </div>;
}

viewerRegistry.set("slides", BuiltinSlidesFileViewer);

export function WorkspaceArtifactViewerHost(props: { preview: WorkspaceArtifactPreview; marking?: SlidesMarkingProps }) {
  const resource = useMemo<SlidesResource | null>(() => props.preview.kind === "pptx" ? {
    resourceUri: `codecn-resource://${crypto.randomUUID()}`,
    artifactType: "slides",
    preview: props.preview
  } : null, [props.preview]);
  if (!resource) return null;
  const FileViewer = viewerRegistry.get(resource.artifactType);
  return FileViewer
    ? <FileViewer resource={resource} marking={props.marking} />
    : <div className="search-file-preview-state error">没有可用于此文件的内置查看器。</div>;
}
