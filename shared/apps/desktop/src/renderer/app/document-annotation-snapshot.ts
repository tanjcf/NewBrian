import type { DocumentRect, DocumentViewport } from "@codex-forge/protocol/document-anchor";

export type AnnotationSnapshotCapture = {
  dataUrl: string;
  width: number;
  height: number;
};

export type AnnotationMarkOverlay = {
  /** Mark rect in the same CSS viewport coordinates as `rect` / `viewport`. */
  rect: DocumentRect;
  tool: "highlight" | "select-rect";
  color: string;
};

const MAX_SNAPSHOT_EDGE = 960;
const CAPTURE_PADDING_PX = 36;

export function clampAnnotationRect(rect: DocumentRect, viewport: DocumentViewport): DocumentRect {
  const x = Math.max(0, Math.min(rect.x, Math.max(0, viewport.width - 1)));
  const y = Math.max(0, Math.min(rect.y, Math.max(0, viewport.height - 1)));
  const width = Math.max(1, Math.min(rect.width, viewport.width - x));
  const height = Math.max(1, Math.min(rect.height, viewport.height - y));
  return { x, y, width, height };
}

/** Expand the mark so the submitted image keeps a little surrounding context. */
export function expandAnnotationCaptureRect(
  rect: DocumentRect,
  viewport: DocumentViewport,
  padding = CAPTURE_PADDING_PX
): DocumentRect {
  const mark = clampAnnotationRect(rect, viewport);
  const x = Math.max(0, mark.x - padding);
  const y = Math.max(0, mark.y - padding);
  const right = Math.min(viewport.width, mark.x + mark.width + padding);
  const bottom = Math.min(viewport.height, mark.y + mark.height + padding);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function scaleSnapshotSize(width: number, height: number) {
  const maxEdge = Math.max(width, height);
  if (maxEdge <= MAX_SNAPSHOT_EDGE) return { width, height, scale: 1 };
  const scale = MAX_SNAPSHOT_EDGE / maxEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale
  };
}

function canvasToDataUrl(canvas: HTMLCanvasElement): string | null {
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function parseCssColor(color: string): { r: number; g: number; b: number } {
  const raw = String(color || "").trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const value = hex[1];
    if (value.length === 3) {
      return {
        r: Number.parseInt(value[0] + value[0], 16),
        g: Number.parseInt(value[1] + value[1], 16),
        b: Number.parseInt(value[2] + value[2], 16)
      };
    }
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16)
    };
  }
  return { r: 255, g: 235, b: 59 };
}

/** Draw the mark box onto a canvas. `mark` is in canvas pixel coordinates. */
export function drawAnnotationMarkOnCanvas(
  context: CanvasRenderingContext2D,
  mark: DocumentRect,
  style: Pick<AnnotationMarkOverlay, "tool" | "color">
) {
  const x = Math.max(0, mark.x);
  const y = Math.max(0, mark.y);
  const width = Math.max(1, mark.width);
  const height = Math.max(1, mark.height);
  const { r, g, b } = parseCssColor(style.color || "#FFEB3B");
  const stroke = `rgb(${r}, ${g}, ${b})`;
  if (style.tool === "highlight") {
    context.fillStyle = `rgba(${r}, ${g}, ${b}, 0.42)`;
    context.fillRect(x, y, width, height);
    context.strokeStyle = stroke;
    context.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.01));
    context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    return;
  }
  context.save();
  context.strokeStyle = stroke;
  context.lineWidth = Math.max(3, Math.round(Math.min(width, height) * 0.02));
  context.setLineDash([
    Math.max(6, Math.round(context.lineWidth * 2.5)),
    Math.max(4, Math.round(context.lineWidth * 1.8))
  ]);
  context.strokeRect(
    x + context.lineWidth / 2,
    y + context.lineWidth / 2,
    Math.max(1, width - context.lineWidth),
    Math.max(1, height - context.lineWidth)
  );
  context.restore();
}

function mapMarkToCanvas(
  markInCaptureCss: DocumentRect,
  captureCss: { width: number; height: number },
  canvas: { width: number; height: number }
): DocumentRect {
  const scaleX = canvas.width / Math.max(1, captureCss.width);
  const scaleY = canvas.height / Math.max(1, captureCss.height);
  return {
    x: markInCaptureCss.x * scaleX,
    y: markInCaptureCss.y * scaleY,
    width: Math.max(1, markInCaptureCss.width * scaleX),
    height: Math.max(1, markInCaptureCss.height * scaleY)
  };
}

function finishAnnotatedCanvas(
  target: HTMLCanvasElement,
  captureCss: DocumentRect,
  markCss: DocumentRect | null,
  style: Pick<AnnotationMarkOverlay, "tool" | "color"> | null
): AnnotationSnapshotCapture | null {
  if (style && markCss) {
    const context = target.getContext("2d");
    if (!context) return null;
    const markOnCanvas = mapMarkToCanvas(
      {
        x: markCss.x - captureCss.x,
        y: markCss.y - captureCss.y,
        width: markCss.width,
        height: markCss.height
      },
      { width: captureCss.width, height: captureCss.height },
      target
    );
    drawAnnotationMarkOnCanvas(context, markOnCanvas, style);
  }
  const dataUrl = canvasToDataUrl(target);
  return dataUrl ? { dataUrl, width: target.width, height: target.height } : null;
}

function captureCanvasRegion(
  canvas: HTMLCanvasElement,
  captureCss: DocumentRect,
  viewport: DocumentViewport,
  markCss: DocumentRect | null,
  style: Pick<AnnotationMarkOverlay, "tool" | "color"> | null
): AnnotationSnapshotCapture | null {
  const clip = clampAnnotationRect(captureCss, viewport);
  const scaleX = canvas.width / viewport.width;
  const scaleY = canvas.height / viewport.height;
  const sx = Math.round(clip.x * scaleX);
  const sy = Math.round(clip.y * scaleY);
  const sw = Math.max(1, Math.round(clip.width * scaleX));
  const sh = Math.max(1, Math.round(clip.height * scaleY));
  const output = scaleSnapshotSize(sw, sh);
  const target = document.createElement("canvas");
  target.width = output.width;
  target.height = output.height;
  const context = target.getContext("2d");
  if (!context) return null;
  context.drawImage(canvas, sx, sy, sw, sh, 0, 0, output.width, output.height);
  return finishAnnotatedCanvas(target, clip, markCss, style);
}

function captureImageRegion(
  image: HTMLImageElement,
  captureCss: DocumentRect,
  viewport: DocumentViewport,
  markCss: DocumentRect | null,
  style: Pick<AnnotationMarkOverlay, "tool" | "color"> | null
): AnnotationSnapshotCapture | null {
  if (!image.complete || image.naturalWidth < 1 || image.naturalHeight < 1) return null;
  const clip = clampAnnotationRect(captureCss, viewport);
  const scaleX = image.naturalWidth / Math.max(1, viewport.width);
  const scaleY = image.naturalHeight / Math.max(1, viewport.height);
  const sx = Math.round(clip.x * scaleX);
  const sy = Math.round(clip.y * scaleY);
  const sw = Math.max(1, Math.round(clip.width * scaleX));
  const sh = Math.max(1, Math.round(clip.height * scaleY));
  const output = scaleSnapshotSize(sw, sh);
  const target = document.createElement("canvas");
  target.width = output.width;
  target.height = output.height;
  const context = target.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(image, sx, sy, sw, sh, 0, 0, output.width, output.height);
  } catch {
    return null;
  }
  return finishAnnotatedCanvas(target, clip, markCss, style);
}

async function captureDomRegion(
  host: HTMLElement,
  captureCss: DocumentRect,
  viewport: DocumentViewport,
  markCss: DocumentRect | null,
  style: Pick<AnnotationMarkOverlay, "tool" | "color"> | null
): Promise<AnnotationSnapshotCapture | null> {
  const clip = clampAnnotationRect(captureCss, viewport);
  const width = Math.round(clip.width);
  const height = Math.round(clip.height);
  if (width < 1 || height < 1) return null;
  const deviceScale = window.devicePixelRatio || 1;
  const output = scaleSnapshotSize(Math.round(width * deviceScale), Math.round(height * deviceScale));
  const wrapper = document.createElement("div");
  wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.overflow = "hidden";
  wrapper.style.position = "relative";
  const clone = host.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".document-marking-layer, .document-marking-canvas").forEach((node) => node.remove());
  clone.style.position = "relative";
  clone.style.marginLeft = `-${clip.x}px`;
  clone.style.marginTop = `-${clip.y}px`;
  wrapper.appendChild(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${output.width}" height="${output.height}">
    <foreignObject width="${width}" height="${height}" transform="scale(${output.scale})">
      ${new XMLSerializer().serializeToString(wrapper)}
    </foreignObject>
  </svg>`;
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("annotation snapshot render failed"));
      element.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = output.width;
    canvas.height = output.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, output.width, output.height);
    return finishAnnotatedCanvas(canvas, clip, markCss, style);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function resolveCaptureRoot(target: HTMLElement): HTMLElement {
  return target.closest(".workspace-artifact-pdf-page-shell")
    ?? target.closest(".workspace-artifact-docx-host")
    ?? target.closest(".workspace-artifact-pptx-stage")
    ?? target.closest(".workspace-artifact-spreadsheet-marking-host")
    ?? target.closest(".workspace-artifact-image")
    ?? target.closest(".workspace-artifact-text-shell")
    ?? target;
}

/**
 * Capture the marked region (with padding for context) and burn the mark box into the PNG
 * so chat receives one annotated screenshot, like screenshot-then-box tools.
 */
export async function captureAnnotationSnapshot(input: {
  rect: DocumentRect;
  viewport: DocumentViewport;
  target?: HTMLElement | null;
  mark?: AnnotationMarkOverlay | null;
}): Promise<AnnotationSnapshotCapture | null> {
  if (!input.target) return null;
  const markCss = clampAnnotationRect(input.mark?.rect || input.rect, input.viewport);
  const captureCss = expandAnnotationCaptureRect(markCss, input.viewport);
  const style = input.mark
    ? { tool: input.mark.tool, color: input.mark.color }
    : { tool: "select-rect" as const, color: "#FFEB3B" };
  const root = resolveCaptureRoot(input.target);
  const canvas = root.querySelector("canvas.workspace-artifact-pdf-page, canvas")
    ?? root.closest(".workspace-artifact-pdf-page-shell")?.querySelector("canvas");
  if (canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0) {
    return captureCanvasRegion(canvas, captureCss, input.viewport, markCss, style);
  }
  const image = root.matches("img")
    ? root as HTMLImageElement
    : root.querySelector(":scope > img, img");
  if (image instanceof HTMLImageElement) {
    const fromImage = captureImageRegion(image, captureCss, input.viewport, markCss, style);
    if (fromImage) return fromImage;
  }
  return captureDomRegion(root, captureCss, input.viewport, markCss, style);
}

export function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export function resolveAnnotationSnapshotPreview(geometry?: { snapshotUrl?: string; snapshotPath?: string } | null) {
  const previewUrl = geometry?.snapshotUrl?.trim();
  if (previewUrl) return previewUrl;
  const snapshotPath = geometry?.snapshotPath?.trim();
  if (!snapshotPath) return "";
  return snapshotPath.startsWith("data:") || snapshotPath.startsWith("newbrain-attachment://")
    ? snapshotPath
    : "";
}
