import type { DocumentRect, DocumentViewport } from "@codex-forge/protocol/document-anchor";

export type AnnotationSnapshotCapture = {
  dataUrl: string;
  width: number;
  height: number;
};

const MAX_SNAPSHOT_EDGE = 960;

export function clampAnnotationRect(rect: DocumentRect, viewport: DocumentViewport): DocumentRect {
  const x = Math.max(0, Math.min(rect.x, Math.max(0, viewport.width - 1)));
  const y = Math.max(0, Math.min(rect.y, Math.max(0, viewport.height - 1)));
  const width = Math.max(1, Math.min(rect.width, viewport.width - x));
  const height = Math.max(1, Math.min(rect.height, viewport.height - y));
  return { x, y, width, height };
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

function captureCanvasRegion(
  canvas: HTMLCanvasElement,
  rect: DocumentRect,
  viewport: DocumentViewport
): AnnotationSnapshotCapture | null {
  const clip = clampAnnotationRect(rect, viewport);
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
  const dataUrl = canvasToDataUrl(target);
  return dataUrl ? { dataUrl, width: output.width, height: output.height } : null;
}

function captureImageRegion(
  image: HTMLImageElement,
  rect: DocumentRect,
  viewport: DocumentViewport
): AnnotationSnapshotCapture | null {
  if (!image.complete || image.naturalWidth < 1 || image.naturalHeight < 1) return null;
  const clip = clampAnnotationRect(rect, viewport);
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
  const dataUrl = canvasToDataUrl(target);
  return dataUrl ? { dataUrl, width: output.width, height: output.height } : null;
}

async function captureDomRegion(
  host: HTMLElement,
  rect: DocumentRect,
  viewport: DocumentViewport
): Promise<AnnotationSnapshotCapture | null> {
  const clip = clampAnnotationRect(rect, viewport);
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
    const dataUrl = canvasToDataUrl(canvas);
    return dataUrl ? { dataUrl, width: output.width, height: output.height } : null;
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

export async function captureAnnotationSnapshot(input: {
  rect: DocumentRect;
  viewport: DocumentViewport;
  target?: HTMLElement | null;
}): Promise<AnnotationSnapshotCapture | null> {
  if (!input.target) return null;
  const root = resolveCaptureRoot(input.target);
  const canvas = root.querySelector("canvas.workspace-artifact-pdf-page, canvas")
    ?? root.closest(".workspace-artifact-pdf-page-shell")?.querySelector("canvas");
  if (canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0) {
    return captureCanvasRegion(canvas, input.rect, input.viewport);
  }
  const image = root.matches("img")
    ? root as HTMLImageElement
    : root.querySelector(":scope > img, img");
  if (image instanceof HTMLImageElement) {
    const fromImage = captureImageRegion(image, input.rect, input.viewport);
    if (fromImage) return fromImage;
  }
  return captureDomRegion(root, input.rect, input.viewport);
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
