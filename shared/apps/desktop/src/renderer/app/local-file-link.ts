export function isLocalFileLink(href: string) {
  const value = String(href ?? "").trim();
  if (!value || value.startsWith("#")) return false;
  if (/^www\.(?:[a-z\d-]+\.)+[a-z]{2,}(?:[/?#\s）)\]】：:]|$)/i.test(value)) return false;
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\")) return true;
  return !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value);
}

/** Resolves a local target without allowing visible text to override a real web href. */
export function resolveLocalFileLinkTarget(href: string, visibleTarget: string) {
  const explicitTarget = String(href ?? "").trim();
  if (isLocalFileLink(explicitTarget)) return explicitTarget;
  if (explicitTarget) return null;
  const recoveredTarget = String(visibleTarget ?? "").trim();
  return isLocalFileLink(recoveredTarget) ? recoveredTarget : null;
}

export function isArtifactFilePath(value: string) {
  const path = String(value ?? "").trim();
  return Boolean(path) && !/[\r\n]/.test(path) && /\.(?:pdf|docx|xlsx|pptx|html?|png|jpe?g|webp|gif|svg|bmp|ico|mp4|webm|mov|m4v|mkv|avi|txt|md|json|csv)$/i.test(path);
}

/** Converts browser-resolved artifact URLs back into workspace-local paths. */
export function resolveLocalArtifactHref(href: string, rendererOrigin: string) {
  const value = String(href ?? "").trim();
  if (!value) return null;
  try {
    const rendererUrl = new URL(rendererOrigin);
    const url = new URL(value, rendererUrl);
    if (url.protocol === "file:") {
      const rendererDirectory = rendererUrl.pathname.slice(0, rendererUrl.pathname.lastIndexOf("/") + 1);
      const browserPath = url.pathname.startsWith(rendererDirectory)
        ? url.pathname.slice(rendererDirectory.length)
        : url.pathname;
      const path = decodeLocalFilePath(browserPath).replace(/^\/([a-zA-Z]:\/)/, "$1");
      return isArtifactFilePath(path) ? path : null;
    }
    if (url.origin !== rendererUrl.origin) return null;
    const path = decodeLocalFilePath(url.pathname).replace(/^\/+/, "");
    return isArtifactFilePath(path) ? path : null;
  } catch {
    const path = parseLocalFileReference(value).filePath;
    return isArtifactFilePath(path) ? path : null;
  }
}

export type LocalFileReference = {
  filePath: string;
  line?: number;
  endLine?: number;
  column?: number;
};

function decodeLocalFilePath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Splits Codex-style file citations without treating the Windows drive colon as a line separator. */
export function parseLocalFileReference(value: string): LocalFileReference {
  const reference = String(value ?? "").trim();
  const hashRange = /#L(\d+)(?:-L?(\d+))?$/.exec(reference);
  if (hashRange) {
    return {
      filePath: decodeLocalFilePath(reference.slice(0, hashRange.index)),
      line: Number(hashRange[1]),
      endLine: hashRange[2] ? Number(hashRange[2]) : undefined
    };
  }

  const colonRange = /:(\d+)-(\d+)$/.exec(reference);
  if (colonRange) {
    return {
      filePath: decodeLocalFilePath(reference.slice(0, colonRange.index)),
      line: Number(colonRange[1]),
      endLine: Number(colonRange[2])
    };
  }

  const lineAndColumn = /:(\d+)(?::(\d+))?$/.exec(reference);
  if (lineAndColumn) {
    return {
      filePath: decodeLocalFilePath(reference.slice(0, lineAndColumn.index)),
      line: Number(lineAndColumn[1]),
      column: lineAndColumn[2] ? Number(lineAndColumn[2]) : undefined
    };
  }

  return { filePath: decodeLocalFilePath(reference) };
}
