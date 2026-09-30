/** Reason codes for blank or failed in-app file previews. */
export type FilePreviewIssueReason =
  | "missing_file"
  | "empty_file"
  | "binary_file"
  | "read_failed"
  | "stale_request"
  | "no_workspace"
  | "preview_unsupported"
  | "empty_artifact";

export type FilePreviewIssue = {
  ok: false;
  reason: FilePreviewIssueReason;
  retryable: boolean;
  message: string;
};

export type FilePreviewOk = { ok: true };

export const FILE_PREVIEW_MAX_ATTEMPTS = 4;
export const FILE_PREVIEW_TIMEOUT_MS = 45_000;

const ARTIFACT_PREVIEW_EXTENSION_PATTERN =
  /\.(pdf|docx|pptx|xlsx|csv|tsv|html?|png|jpe?g|gif|webp|bmp|svg|ico|mp4|webm|mov|m4v|mkv|avi|mp3|wav|m4a|aac|flac|ogg|opus|mid|midi)$/i;

/** True when a workspace path or display name should use artifact preview IPC. */
export function isWorkspaceArtifactPreviewPath(filePath: string, displayName?: string) {
  return [filePath, displayName]
    .filter(Boolean)
    .some((candidate) => ARTIFACT_PREVIEW_EXTENSION_PATTERN.test(String(candidate).trim()));
}

/** True when a BRAIN file record or path hint refers to audio media. */
export function isAudioPreviewFileName(...names: Array<string | undefined>) {
  return names.some((name) => /\.(mp3|wav|m4a|aac|flac|ogg|opus|mid|midi)$/i.test(String(name || "")));
}

/** Bound workspace file reads so a hung IPC call cannot leave preview tabs loading forever. */
export function withFilePreviewTimeout<T>(promise: Promise<T>, timeoutMs = FILE_PREVIEW_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("文件读取超时，请重试。"));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Drop responses that no longer match the latest open request. */
export function isStaleFilePreviewRequest(requestSequence: number, currentSequence: number) {
  return requestSequence !== currentSequence;
}

export function filePreviewRetryDelayMs(attempt: number) {
  return Math.min(600, 120 * Math.max(1, attempt));
}

export function classifyTextPreviewPayload(file: {
  content?: string;
  binary?: boolean;
  size?: number;
}): FilePreviewOk | FilePreviewIssue {
  if (file.binary) {
    return {
      ok: false,
      reason: "binary_file",
      retryable: false,
      message: "这是二进制文件，无法以文本方式预览。"
    };
  }
  const content = String(file.content ?? "");
  if (content.length > 0) return { ok: true };
  const size = Number(file.size ?? 0);
  if (size <= 0) {
    return {
      ok: false,
      reason: "empty_file",
      retryable: true,
      message: "文件当前为空（可能仍在写入）。请稍后重试。"
    };
  }
  return {
    ok: false,
    reason: "empty_file",
    retryable: false,
    message: `文件大小为 ${size} 字节，但未能解码出可预览文本。`
  };
}

export function classifyArtifactPreviewPayload(file: {
  kind?: string;
  html?: string;
  dataUrl?: string;
  content?: string;
  previewUrl?: string;
}): FilePreviewOk | FilePreviewIssue {
  const kind = String(file.kind || "");
  if (kind === "docx" && !String(file.html ?? "").trim()) {
    return {
      ok: false,
      reason: "empty_artifact",
      retryable: true,
      message: "Word 文档预览内容为空（可能仍在生成）。"
    };
  }
  if (kind === "pdf" && !String(file.dataUrl ?? "").trim()) {
    return {
      ok: false,
      reason: "empty_artifact",
      retryable: true,
      message: "PDF 预览数据为空。"
    };
  }
  if (kind === "html" && !String(file.content ?? "").trim() && !String(file.previewUrl ?? "").trim()) {
    return {
      ok: false,
      reason: "empty_artifact",
      retryable: true,
      message: "HTML 预览内容为空。"
    };
  }
  if ((kind === "image" || kind === "video" || kind === "audio") && !String(file.previewUrl ?? "").trim()) {
    return {
      ok: false,
      reason: "empty_artifact",
      retryable: false,
      message: "媒体预览地址缺失。"
    };
  }
  if (kind === "pptx" && !String(file.dataUrl ?? "").trim()) {
    return {
      ok: false,
      reason: "empty_artifact",
      retryable: true,
      message: "演示文稿预览数据为空。"
    };
  }
  if (kind === "spreadsheet") {
    const sheets = Array.isArray((file as { sheets?: unknown[] }).sheets) ? (file as { sheets: unknown[] }).sheets : [];
    if (!sheets.length) {
      return {
        ok: false,
        reason: "empty_artifact",
        retryable: true,
        message: "表格预览内容为空。"
      };
    }
  }
  return { ok: true };
}

export function classifyFilePreviewError(error: unknown): FilePreviewIssue {
  const raw = error instanceof Error ? error.message : String(error || "未知错误");
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "")
    .replace(/^Error invoking remote method "[^"]+":\s*(?:Error:\s*)?/i, "")
    .trim() || "未知错误";
  if (/文件不存在|ENOENT|not found|无法预览/i.test(message)) {
    return {
      ok: false,
      reason: "missing_file",
      // Brief auto-retry covers write→preview races; manual 重试预览 also re-reads from disk.
      retryable: true,
      message: message || "文件不存在，无法预览。"
    };
  }
  if (/不支持文档侧栏预览|unsupported/i.test(message)) {
    return {
      ok: false,
      reason: "preview_unsupported",
      retryable: false,
      message
    };
  }
  if (/超时|timed out|timeout/i.test(message)) {
    return {
      ok: false,
      reason: "read_failed",
      retryable: true,
      message: message || "文件读取超时，请重试。"
    };
  }
  return {
    ok: false,
    reason: "read_failed",
    retryable: false,
    message
  };
}

/** Normalize soft IPC failures (`{ ok:false, reason, error }`) into FilePreviewIssue. */
export function classifySoftFilePreviewFailure(soft: {
  ok?: boolean;
  error?: string;
  message?: string;
  reason?: string;
}): FilePreviewIssue {
  const message = String(soft.error || soft.message || "文件预览失败。").trim() || "文件预览失败。";
  const reason = String(soft.reason || "").trim();
  if (reason === "missing_file" || /文件不存在|ENOENT|not found|无法预览/i.test(message)) {
    return {
      ok: false,
      reason: "missing_file",
      retryable: true,
      message
    };
  }
  if (reason === "empty_file" || reason === "empty_artifact") {
    return {
      ok: false,
      reason: reason as FilePreviewIssueReason,
      retryable: true,
      message
    };
  }
  if (reason === "preview_unsupported" || reason === "binary_file") {
    return {
      ok: false,
      reason: reason as FilePreviewIssueReason,
      retryable: false,
      message
    };
  }
  if (reason === "read_failed") {
    return {
      ok: false,
      reason: "read_failed",
      retryable: false,
      message
    };
  }
  return classifyFilePreviewError(new Error(message));
}

export function formatFilePreviewStatus(issue: FilePreviewIssue, reportId?: string) {
  if (issue.reason === "missing_file") {
    return /文件不存在|无法预览/.test(issue.message) ? issue.message : `文件不存在，无法预览。${issue.message}`;
  }
  const suffix = reportId ? `（诊断 ${reportId}）` : "";
  return `文件预览异常：${issue.message}${suffix}`;
}

export function buildFilePreviewDiagnosticContext(input: {
  workspaceId?: string;
  filePath: string;
  reason: FilePreviewIssueReason;
  attempt: number;
  artifact: boolean;
  size?: number;
  binary?: boolean;
  errorMessage?: string;
}) {
  return {
    feature: "file_preview",
    severity: "diagnostic",
    workspaceId: input.workspaceId || "",
    filePath: input.filePath,
    reason: input.reason,
    attempt: input.attempt,
    artifact: input.artifact,
    size: input.size,
    binary: input.binary,
    errorMessage: input.errorMessage
  };
}

/** Normalize path keys so outputs\\a.md and outputs/a.md share one preview tab. */
export function normalizeArtifactPathKey(path: string) {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
}

/** Absolute, relative, and basename-only references of the same generated file. */
export function artifactPathsReferToSameFile(left: string, right: string) {
  const a = normalizeArtifactPathKey(left);
  const b = normalizeArtifactPathKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.endsWith(`/${b}`) || b.endsWith(`/${a}`)) return true;
  const aBase = a.split("/").pop() || a;
  const bBase = b.split("/").pop() || b;
  if (aBase !== bBase) return false;
  const aBare = !a.includes("/");
  const bBare = !b.includes("/");
  if (!aBare && !bBare) return false;
  const full = aBare ? b : a;
  return full === aBase || full.endsWith(`/outputs/${aBase}`) || full.endsWith(`/${aBase}`);
}

export function findMatchingArtifactTab<T extends { tabPath?: string; path?: string; name?: string }>(
  tabs: readonly T[],
  filePath: string
) {
  return tabs.find((tab) =>
    artifactPathsReferToSameFile(String(tab.tabPath || ""), filePath)
    || artifactPathsReferToSameFile(String(tab.path || ""), filePath)
    || (
      !normalizeArtifactPathKey(filePath).includes("/")
      && normalizeArtifactPathKey(String(tab.name || "")) === normalizeArtifactPathKey(filePath)
    )
  );
}

export function artifactTabMatchesRequest<T extends { tabPath?: string; path?: string; name?: string }>(
  tab: T,
  ...requestKeys: string[]
) {
  return requestKeys.some((key) =>
    artifactPathsReferToSameFile(String(tab.tabPath || ""), key)
    || artifactPathsReferToSameFile(String(tab.path || ""), key)
    || (
      !normalizeArtifactPathKey(key).includes("/")
      && normalizeArtifactPathKey(String(tab.name || "")) === normalizeArtifactPathKey(key)
    )
  );
}

export function patchArtifactTabsForRequest<T extends { tabPath?: string; path?: string; name?: string }>(
  tabs: readonly T[],
  requestKeys: string[],
  patch: Partial<T>
) {
  let changed = false;
  const next = tabs.map((tab) => {
    if (!artifactTabMatchesRequest(tab, ...requestKeys)) return tab;
    changed = true;
    return { ...tab, ...patch };
  });
  return changed ? next : tabs;
}

export function isReusableArtifactPreview(tab: {
  loading?: boolean;
  error?: string;
  blankReason?: string;
  content?: string;
  kind?: string;
  binary?: boolean;
  dataUrl?: string;
  html?: string;
  previewUrl?: string;
} | null | undefined) {
  if (!tab || tab.loading || tab.error || tab.blankReason) return false;
  if (tab.binary) return true;
  if (String(tab.content || "").length > 0) return true;
  if (String(tab.kind || "") && (tab.dataUrl || tab.html || tab.previewUrl || tab.content)) return true;
  if (String(tab.kind || "") === "spreadsheet" && Array.isArray((tab as { sheets?: unknown[] }).sheets) && (tab as { sheets: unknown[] }).sheets.length > 0) return true;
  return false;
}
