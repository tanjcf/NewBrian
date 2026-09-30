import type { WorkspaceFileActionInput } from "@codex-forge/protocol";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWorkspaceFileAction(input: unknown): WorkspaceFileActionInput {
  if (!isRecord(input)) throw new TypeError("Workspace file action input is invalid.");
  const { workspaceId, filePath, action, toolId } = input;
  if (
    typeof workspaceId !== "string"
    || typeof filePath !== "string"
    || (action !== "open-vscode" && action !== "open-with" && action !== "open-tool" && action !== "copy-contents" && action !== "reveal" && action !== "save-as")
    || (action === "open-tool" && (typeof toolId !== "string" || !toolId.trim()))
  ) {
    throw new TypeError("Workspace file action input is invalid.");
  }
  return { workspaceId, filePath, action, ...(action === "open-tool" ? { toolId: String(toolId) } : {}) };
}
