/** Preview-header control: open the file's folder instead of saving a copy. */

export function previewFolderOpenRequest(input: { workspaceId?: string; filePath?: string }) {
  const workspaceId = String(input.workspaceId || "").trim();
  const filePath = String(input.filePath || "").trim();
  if (!workspaceId) return { ok: false as const, detail: "当前工作区不可用。" };
  if (!filePath) return { ok: false as const, detail: "没有可打开的文件。" };
  return {
    ok: true as const,
    workspaceId,
    filePath,
    action: "reveal" as const
  };
}
