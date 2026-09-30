import { join } from "node:path";
import { INTERNAL_CHAT_WORKSPACE_ID } from "@codex-forge/protocol";


const PORTABLE_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const WINDOWS_RESERVED_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function encodeWorkspaceStateSegment(workspaceId: string) {
  const value = workspaceId.trim();
  if (
    value
    && PORTABLE_SEGMENT_PATTERN.test(value)
    && !WINDOWS_RESERVED_NAME_PATTERN.test(value)
  ) {
    return value;
  }
  return `encoded-${Buffer.from(value || "workspace", "utf8").toString("base64url")}`;
}

export function resolveWorkspaceStatePath(workspaceStateRoot: string, workspaceId: string) {
  return join(workspaceStateRoot, "workspaces", encodeWorkspaceStateSegment(workspaceId));
}

export function getWorkspaceStateDirectory(stateRoot: string, workspaceId: string) {
  if (workspaceId === INTERNAL_CHAT_WORKSPACE_ID) {
    return join(stateRoot, "workspaces", "workspace-internal-chat");
  }
  return resolveWorkspaceStatePath(stateRoot, workspaceId);
}
