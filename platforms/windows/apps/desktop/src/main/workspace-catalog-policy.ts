import { basename, resolve } from "node:path";
import {
  isBrainWorkspaceKey,
  type BrainWorkspaceKey,
  type WorkspaceCatalogItem,
  type WorkspaceThreadRecord
} from "@codex-forge/protocol";

export function resolveCatalogBrainWorkspaceKey(value: unknown): BrainWorkspaceKey {
  return isBrainWorkspaceKey(value) ? value : "document";
}

export interface WorkspaceCondaConfig {
  source: "system" | "managed";
  condaPath: string;
  envPath: string;
  envName: string;
  pythonVersion: string;
  lastCheckedAt?: string;
  lastProvisionedAt?: string;
}

interface WorkspaceCatalogPolicyContext {
  workspacePath: string;
  makeId: (prefix: string) => string;
  nowIso: () => string;
  getWorkspaceEnvRoot: (workspaceId: string) => string;
  makeWorkspaceEnvName: (workspaceId: string) => string;
}

function repairKnownMojibakeText(value?: string) {
  if (!value) return "";
  return value
    .replaceAll("榛樿绾跨▼", "默认线程")
    .replaceAll("鏈懡鍚嶇嚎绋?", "未命名线程")
    .replaceAll("鏆傛棤绾跨▼鎽樿銆?", "暂无线程摘要。")
    .replaceAll("绾跨▼宸插垱寤?", "线程已创建")
    .replaceAll("姒涙顓荤痪璺ㄢ柤", "默认线程")
    .replaceAll("鏂扮嚎绋?", "新线程")
    .replaceAll("鏂板璇?", "新对话");
}

export function normalizeWorkspaceThread(input: Partial<WorkspaceThreadRecord>, context: Pick<WorkspaceCatalogPolicyContext, "makeId" | "nowIso">): WorkspaceThreadRecord {
  const normalizedStatus = input.status === "running" || input.status === "awaiting-approval" || input.status === "failed" || input.status === "idle" ? input.status : "idle";
  const kind = input.kind === "subagent" ? "subagent" : "user";
  const parentThreadId = String(input.parentThreadId ?? "").trim();
  return {
    id: input.id?.trim() || context.makeId("thread"),
    title: repairKnownMojibakeText(input.title?.trim()) || "未命名线程",
    summary: repairKnownMojibakeText(input.summary?.trim()) || "暂无线程摘要。",
    scope: input.scope === "chat" ? "chat" : "project",
    kind,
    ...(kind === "subagent" && parentThreadId ? { parentThreadId } : {}),
    ...(isBrainWorkspaceKey(input.brainWorkspaceKey) ? { brainWorkspaceKey: input.brainWorkspaceKey } : {}),
    updatedAt: input.updatedAt?.trim() || context.nowIso(),
    lastEventSummary: repairKnownMojibakeText(input.lastEventSummary?.trim()),
    status: normalizedStatus,
    statusLabel: input.statusLabel?.trim() || "",
    branch: input.branch?.trim() || "",
    archived: Boolean(input.archived)
  };
}

export function sortWorkspaceThreads(threads: WorkspaceThreadRecord[]) {
  return [...threads].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

export function removeGeneratedDefaultWorkspace(workspaces: WorkspaceCatalogItem[]) {
  return workspaces.filter((workspace) => workspace.id !== "workspace-newbrain");
}

export function normalizeWorkspaceCondaConfig(workspaceId: string, input: Partial<WorkspaceCondaConfig> | undefined, context: Pick<WorkspaceCatalogPolicyContext, "getWorkspaceEnvRoot" | "makeWorkspaceEnvName">): WorkspaceCondaConfig | undefined {
  if (!input?.condaPath?.trim()) return undefined;
  return {
    source: input.source === "managed" ? "managed" : "system",
    condaPath: input.condaPath.trim(),
    envPath: input.envPath?.trim() || context.getWorkspaceEnvRoot(workspaceId),
    envName: input.envName?.trim() || context.makeWorkspaceEnvName(workspaceId),
    pythonVersion: input.pythonVersion?.trim() || "3.11",
    lastCheckedAt: input.lastCheckedAt?.trim() || undefined,
    lastProvisionedAt: input.lastProvisionedAt?.trim() || undefined
  };
}

export function normalizeWorkspaceCatalogItem(item: Partial<WorkspaceCatalogItem>, context: WorkspaceCatalogPolicyContext): WorkspaceCatalogItem {
  const resolvedPath = item.path?.trim() ? resolve(item.path.trim()) : context.workspacePath;
  const workspaceId = item.id?.trim() || context.makeId("workspace");
  return {
    id: workspaceId,
    name: item.name?.trim() || basename(resolvedPath) || "workspace",
    path: resolvedPath,
    brainWorkspaceKey: resolveCatalogBrainWorkspaceKey(item.brainWorkspaceKey),
    threads: Array.isArray(item.threads) ? sortWorkspaceThreads(item.threads.map((thread) => normalizeWorkspaceThread(thread, context))) : [],
    conda: normalizeWorkspaceCondaConfig(workspaceId, item.conda as Partial<WorkspaceCondaConfig> | undefined, context)
  };
}
