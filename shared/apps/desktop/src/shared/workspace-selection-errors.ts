/** True when activate/list IPC failed because the remembered project or thread is gone. */
export function isMissingWorkspaceSelectionError(message: string) {
  return /Project was not found|Workspace was not found|Workspace thread was not found|Thread was not found/i.test(
    String(message || "")
  );
}
