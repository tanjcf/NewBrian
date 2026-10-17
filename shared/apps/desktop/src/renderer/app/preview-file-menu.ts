/** Preview more-menu actions: system app, full path, and VS Code. */

export function planPreviewSystemOpen(input: { workspaceId?: string; filePath?: string }) {
  const workspaceId = String(input.workspaceId || "").trim();
  const filePath = String(input.filePath || "").trim();
  if (!workspaceId) return { ok: false as const, detail: "当前工作区不可用。" };
  if (!filePath) return { ok: false as const, detail: "没有可打开的文件。" };
  return { ok: true as const, workspaceId, filePath, action: "open-with" as const };
}

export function planPreviewVsCodeOpen(input: { workspaceId?: string; filePath?: string }) {
  const workspaceId = String(input.workspaceId || "").trim();
  const filePath = String(input.filePath || "").trim();
  if (!workspaceId) return { ok: false as const, detail: "当前工作区不可用。" };
  if (!filePath) return { ok: false as const, detail: "没有可打开的文件。" };
  return { ok: true as const, workspaceId, filePath, action: "open-vscode" as const };
}

/** Workspace-relative paths such as outputs/file.pptx become a full disk path. */
export function absoluteWorkspaceFilePath(workspacePath: string, filePath: string) {
  const file = String(filePath || "").trim();
  const root = String(workspacePath || "").trim();
  if (!file) return { ok: false as const, detail: "没有可复制的路径。" };
  const filePosix = file.replace(/\\/g, "/");
  const absolute = /^[a-zA-Z]:\//.test(filePosix) || filePosix.startsWith("/");
  if (absolute) return { ok: true as const, path: file };
  if (!root) return { ok: false as const, detail: "当前工作区不可用，无法复制完整路径。" };
  const separator = root.includes("\\") ? "\\" : "/";
  const rootTrimmed = root.replace(/[\\/]+$/u, "");
  const relative = filePosix.replace(/^\/+/u, "");
  return { ok: true as const, path: `${rootTrimmed}${separator}${relative.split("/").join(separator)}` };
}
