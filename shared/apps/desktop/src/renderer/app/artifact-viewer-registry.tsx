import { useEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from "@aiden0z/pptx-renderer";
import type { AnnotationMarkingTool, BrainAnnotationDto, WorkspaceArtifactPreview } from "@codex-forge/protocol";
import type { DocumentRect, DocumentViewport } from "@codex-forge/protocol/document-anchor";
import { DocumentMarkingLayer } from "./DocumentMarkingLayer";
import { WorkspaceMusicPlayer } from "./WorkspaceMusicPlayer";

type SlidesResource = {
  resourceUri: string;
  artifactType: "slides";
  preview: Extract<WorkspaceArtifactPreview, { kind: "pptx" }>;
};

type MusicResource = {
  resourceUri: string;
  artifactType: "music";
  preview: Extract<WorkspaceArtifactPreview, { kind: "audio" }>;
};

type ArtifactResource = SlidesResource | MusicResource;

export type SlidesMarkingProps = {
  annotationActive: boolean;
  markingTool: AnnotationMarkingTool;
  markingColor: string;
  savedAnnotations: BrainAnnotationDto[];
  pendingMark: { rect: DocumentRect; tool: AnnotationMarkingTool; color: string } | null;
  onMarkComplete: (input: { rect: DocumentRect; viewport: DocumentViewport; slide: number; captureTarget: HTMLElement }) => void;
  onToggleAnnotation?: () => void;
  onToggleChat?: () => void;
  chatCollapsed?: boolean;
};

type ArtifactFileViewer = ComponentType<{ resource: ArtifactResource; marking?: SlidesMarkingProps }>;
const viewerRegistry = new Map<ArtifactResource["artifactType"], ArtifactFileViewer>();

function dataUrlToBytes(dataUrl: string) {
  const binary = window.atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

type CanvasTool = "select" | "hand" | "mark";

function slideIcon(paths: string, filled = false) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths.split("|").map((d) => <path key={d} d={d} />)}</svg>;
}

type ThumbnailHandle = {
  ready: Promise<void>;
  dispose: () => void;
};

type PptxViewerWithThumbs = PptxViewer & {
  renderThumbnailToContainer?: (
    index: number,
    container: HTMLElement,
    options?: { width?: number; height?: number; scale?: number }
  ) => ThumbnailHandle | null;
  goToSlide?: (target: number) => Promise<void>;
};

function PptxSlideThumb(props: {
  viewer: PptxViewerWithThumbs | null;
  slideIndex: number;
  listIndex: number;
  active: boolean;
  hidden: boolean;
  onSelect: () => void;
  onReorder: (from: number, to: number) => void;
  onMenu: (x: number, y: number) => void;
}) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (typeof IntersectionObserver !== "function") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    }, {
      root: root.closest(".pptx-thumbs"),
      rootMargin: "120px 0px",
      threshold: 0.01
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = previewRef.current;
    const viewer = props.viewer;
    if (!visible || !host || !viewer?.renderThumbnailToContainer) return;
    host.replaceChildren();
    let handle: ThumbnailHandle | null = null;
    try {
      handle = viewer.renderThumbnailToContainer(props.slideIndex, host, { width: 132 });
    } catch {
      handle = null;
    }
    return () => {
      handle?.dispose();
      host.replaceChildren();
    };
  }, [visible, props.viewer, props.slideIndex]);

  return (
    <button
      ref={rootRef}
      type="button"
      className={`pptx-thumb${props.active ? " active" : ""}${props.hidden ? " hidden" : ""}`}
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/plain", String(props.listIndex))}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        props.onReorder(Number(event.dataTransfer.getData("text/plain")), props.listIndex);
      }}
      onClick={props.onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        props.onMenu(event.clientX, event.clientY);
      }}
      aria-label={`第 ${props.slideIndex + 1} 页${props.hidden ? "（已隐藏）" : ""}`}
    >
      <div className="pptx-thumb-preview" ref={previewRef} aria-hidden="true" />
      <i>{props.slideIndex + 1}{props.hidden ? " · 隐藏" : ""}</i>
    </button>
  );
}

function BuiltinSlidesFileViewer({ resource, marking }: { resource: SlidesResource; marking?: SlidesMarkingProps }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PptxViewerWithThumbs | null>(null);
  const [viewer, setViewer] = useState<PptxViewerWithThumbs | null>(null);
  const [state, setState] = useState({ loading: true, error: "", slideCount: 0, currentSlide: 0, navigating: false });
  const [order, setOrder] = useState<number[]>([]);
  const [hiddenSlides, setHiddenSlides] = useState<number[]>([]);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [pagePos, setPagePos] = useState({ x: 0, y: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [presenting, setPresenting] = useState(false);

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
    }).then((opened) => {
      if (canceled) {
        opened.destroy();
        return;
      }
      const nextViewer = opened as PptxViewerWithThumbs;
      viewerRef.current = nextViewer;
      setViewer(nextViewer);
      setOrder(Array.from({ length: nextViewer.slideCount }, (_, index) => index));
      setHiddenSlides([]);
      setState({ loading: false, error: "", slideCount: nextViewer.slideCount, currentSlide: nextViewer.currentSlideIndex, navigating: false });
      // Progressive generation reloads the file as pages grow — jump to the newest slide.
      if (nextViewer.slideCount > 1) {
        const last = nextViewer.slideCount - 1;
        void (nextViewer.goToSlide ? nextViewer.goToSlide(last) : nextViewer.renderSlide(last)).then(() => {
          if (!canceled) setState((current) => ({ ...current, currentSlide: nextViewer.currentSlideIndex }));
        }).catch(() => undefined);
      }
    }).catch((error: unknown) => {
      if (!canceled) {
        setViewer(null);
        setState({ loading: false, error: error instanceof Error ? error.message : String(error), slideCount: 0, currentSlide: 0, navigating: false });
      }
    });
    return () => {
      canceled = true;
      abortController.abort();
      viewerRef.current?.destroy();
      viewerRef.current = null;
      setViewer(null);
    };
  }, [resource.preview.dataUrl, resource.resourceUri]);

  const showSlide = async (index: number) => {
    const currentViewer = viewerRef.current;
    if (!currentViewer || state.navigating || index < 0 || index >= currentViewer.slideCount) return;
    if (index === currentViewer.currentSlideIndex) return;
    setState((current) => ({ ...current, navigating: true }));
    try {
      if (currentViewer.goToSlide) await currentViewer.goToSlide(index);
      else await currentViewer.renderSlide(index);
      setState((current) => ({ ...current, currentSlide: currentViewer.currentSlideIndex, navigating: false }));
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error), navigating: false }));
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (!typing && event.shiftKey && event.ctrlKey && (event.key === "h" || event.key === "H")) {
        event.preventDefault();
        setHiddenSlides((current) => current.includes(state.currentSlide) ? current.filter((index) => index !== state.currentSlide) : [...current, state.currentSlide]);
      }
      if (!presenting) return;
      if (event.key === "Escape") {
        setPresenting(false);
        if (document.fullscreenElement) void document.exitFullscreen();
      }
      const visible = order.filter((index) => !hiddenSlides.includes(index));
      const at = visible.indexOf(state.currentSlide);
      if (event.key === "ArrowRight" && at >= 0 && at < visible.length - 1) void showSlide(visible[at + 1]);
      if (event.key === "ArrowLeft" && at > 0) void showSlide(visible[at - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const currentSlideNumber = state.currentSlide + 1;
  const annotationOn = Boolean(marking?.annotationActive);
  const activeTool: CanvasTool = annotationOn ? "mark" : tool;

  const chooseTool = (next: CanvasTool) => {
    if (next === "mark") {
      setTool("mark");
      if (!annotationOn) marking?.onToggleAnnotation?.();
      return;
    }
    setTool(next);
    if (annotationOn) marking?.onToggleAnnotation?.();
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeTool === "mark" || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, form, .pptx-floatbar, .pptx-board-tools")) return;
    if (activeTool === "hand") {
      const origin = pagePos;
      const startX = event.clientX - origin.x;
      const startY = event.clientY - origin.y;
      const move = (ev: PointerEvent) => setPagePos({ x: ev.clientX - startX, y: ev.clientY - startY });
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    const host = hostRef.current;
    const target = event.target;
    if (!host || !(target instanceof HTMLElement) || !host.contains(target) || target === host) return;
    if (target instanceof HTMLCanvasElement && host.querySelectorAll("canvas").length <= 1) return;
    const start = target.getBoundingClientRect();
    const dx = event.clientX;
    const dy = event.clientY;
    const baseLeft = Number.parseFloat(target.style.left || "0") || 0;
    const baseTop = Number.parseFloat(target.style.top || "0") || 0;
    target.style.position = "relative";
    const move = (ev: PointerEvent) => {
      target.style.left = `${baseLeft + ev.clientX - dx}px`;
      target.style.top = `${baseTop + ev.clientY - dy}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    void start;
  };

  const reorderTo = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setOrder((current) => {
      const next = current.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  return <div className="workspace-artifact-pptx pptx-board" data-resource-uri={resource.resourceUri} data-slide-count={state.slideCount} data-current-slide={state.currentSlide}>
    <div className="pptx-thumbs" aria-label="幻灯片列表">
      {order.map((slideIndex, listIndex) => (
        <PptxSlideThumb
          key={`${resource.preview.dataUrl}:${slideIndex}`}
          viewer={viewer}
          slideIndex={slideIndex}
          listIndex={listIndex}
          active={slideIndex === state.currentSlide}
          hidden={hiddenSlides.includes(slideIndex)}
          onSelect={() => void showSlide(slideIndex)}
          onReorder={reorderTo}
          onMenu={(x, y) => setMenu({ x, y, index: slideIndex })}
        />
      ))}
    </div>
    <div className="pptx-board-canvas" ref={canvasRef} onPointerDown={onCanvasPointerDown}>
      {state.loading ? <div className="search-file-preview-state">正在加载演示文稿...</div> : null}
      {state.error ? <div className="search-file-preview-state error">PPTX 加载失败：{state.error}</div> : null}
      <div className="pptx-board-tools">
        <button className="pptx-iconbtn" type="button" title="刷新" aria-label="刷新" onClick={() => setPagePos({ x: 0, y: 0 })}>{slideIcon("M21 12a9 9 0 1 1-2.6-6.3|M21 3v6h-6")}</button>
        <button className={`pptx-iconbtn${marking?.chatCollapsed ? " active" : ""}`} type="button" title={marking?.chatCollapsed ? "展开对话" : "收起对话"} aria-label={marking?.chatCollapsed ? "展开对话" : "收起对话"} onClick={() => marking?.onToggleChat?.()}>{slideIcon("M15 3h6v6|m21 3-7 7|M9 21H3v-6|m3 21 7-7")}</button>
      </div>
      <div className="pptx-floatbar" aria-label="画布工具">
        <button className={`pptx-iconbtn${activeTool === "select" ? " active" : ""}`} type="button" title="拖动页面里的内容" aria-label="选择" onClick={() => chooseTool("select")}>{slideIcon("M4 4l7.1 16 2.2-6.7L20 11.1 4 4z")}</button>
        <button className={`pptx-iconbtn${activeTool === "hand" ? " active" : ""}`} type="button" title="拖动页面在画布中的位置" aria-label="抓手" onClick={() => chooseTool("hand")}>{slideIcon("M8 13V6.5a1.5 1.5 0 0 1 3 0V12|M11 11.5V5.5a1.5 1.5 0 0 1 3 0V12|M14 12.2V8a1.5 1.5 0 0 1 3 0v6.2c0 3.2-1.6 5.8-4.8 5.8h-.7C8.8 20 7 18.2 7 15.6V10a1.5 1.5 0 0 1 3 0")}</button>
        <button className={`pptx-iconbtn pen${activeTool === "mark" ? " active" : ""}`} type="button" title="画笔标注" aria-label="画笔标注" onClick={() => chooseTool("mark")}>{slideIcon("M12 20h9|M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z")}</button>
        <button className="pptx-iconbtn" type="button" title="从当前页放映" aria-label="放映" onClick={() => { setPresenting(true); void canvasRef.current?.requestFullscreen?.(); }}>{slideIcon("M8 5.5v13l11-6.5L8 5.5z", true)}</button>
      </div>
      <div className={`pptx-slide${activeTool === "hand" ? " hand" : ""}`} style={{ ["--px" as string]: `${pagePos.x}px`, ["--py" as string]: `${pagePos.y}px` }}>
        <div className="workspace-artifact-pptx-stage">
          <div className="workspace-artifact-pptx-host" ref={hostRef} />
          {marking ? (
            <DocumentMarkingLayer
              active={annotationOn}
              tool={marking.markingTool}
              color={marking.markingColor}
              savedAnnotations={marking.savedAnnotations}
              pendingMark={annotationOn ? marking.pendingMark : null}
              pageFilter={currentSlideNumber}
              onComplete={({ rect, viewport, host }) => {
                if (!annotationOn) return;
                marking.onMarkComplete({ rect, viewport, slide: currentSlideNumber, captureTarget: hostRef.current || host });
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
    {menu ? (
      <div className="pptx-menu" style={{ left: menu.x, top: menu.y }} role="menu">
        <button type="button" onClick={() => {
          setHiddenSlides((current) => current.includes(menu.index) ? current.filter((index) => index !== menu.index) : [...current, menu.index]);
          setMenu(null);
        }}><span>显示/隐藏</span><kbd>Shift+Ctrl+H</kbd></button>
        <button type="button" onClick={() => {
          setOrder((current) => current.filter((index) => index !== menu.index));
          setMenu(null);
        }}><span>删除</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 6h11v12H8l-5-6 5-6z" /><path d="m11 10 4 4M15 10l-4 4" /></svg></button>
      </div>
    ) : null}
  </div>;
}

viewerRegistry.set("slides", BuiltinSlidesFileViewer);

function BuiltinMusicFileViewer({ resource }: { resource: MusicResource }) {
  return <WorkspaceMusicPlayer preview={resource.preview} />;
}

viewerRegistry.set("music", BuiltinMusicFileViewer);

export function WorkspaceArtifactViewerHost(props: { preview: WorkspaceArtifactPreview; marking?: SlidesMarkingProps }) {
  const resource = useMemo<ArtifactResource | null>(() => {
    if (props.preview.kind === "pptx") {
      return {
        resourceUri: `newbrain-resource://${crypto.randomUUID()}`,
        artifactType: "slides",
        preview: props.preview
      };
    }
    if (props.preview.kind === "audio") {
      return {
        resourceUri: `newbrain-resource://${crypto.randomUUID()}`,
        artifactType: "music",
        preview: props.preview
      };
    }
    return null;
  }, [props.preview]);
  if (!resource) return null;
  const FileViewer = viewerRegistry.get(resource.artifactType);
  return FileViewer
    ? <FileViewer resource={resource} marking={props.marking} />
    : <div className="search-file-preview-state error">没有可用于此文件的内置查看器。</div>;
}
