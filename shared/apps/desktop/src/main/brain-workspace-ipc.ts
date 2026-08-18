import { ipcMain } from "electron";
import {
  brainWorkspaceIpcChannels,
  brainWorkspaceKeys,
  type BrainConversationCreateInput,
  type BrainConversationGetInput,
  type BrainDraftSaveInput,
  type BrainMessageAppendInput,
  type BrainProjectCreateInput,
  type BrainProjectGetInput,
  type BrainProjectListInput,
  type BrainProjectUpdateInput,
  type BrainProjectWorkspaceInput,
  type BrainWorkspaceKey
} from "@codex-forge/protocol";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";

interface BrainWorkspaceIpcDependencies {
  storage: BrainWorkspaceStorage;
  resolveOwnerId: () => Promise<string> | string;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} payload is invalid.`);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, label: string) {
  return value === undefined || value === null ? {} : requireRecord(value, label);
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value: unknown, field: string) {
  if (value === undefined) return undefined;
  return requireString(value, field);
}

function requireWorkspaceKey(value: unknown): BrainWorkspaceKey {
  if (typeof value === "string" && (brainWorkspaceKeys as readonly string[]).includes(value)) return value as BrainWorkspaceKey;
  throw new TypeError("workspaceKey is unsupported.");
}

function optionalWorkspaceKey(value: unknown) {
  return value === undefined ? undefined : requireWorkspaceKey(value);
}

function parseProjectList(value: unknown): BrainProjectListInput {
  const input = optionalRecord(value, "Project list");
  if (input.includeArchived !== undefined && typeof input.includeArchived !== "boolean") {
    throw new TypeError("includeArchived must be boolean.");
  }
  return {
    workspaceKey: optionalWorkspaceKey(input.workspaceKey),
    includeArchived: input.includeArchived === true
  };
}

function parseProjectCreate(value: unknown): BrainProjectCreateInput {
  const input = requireRecord(value, "Project create");
  return { name: requireString(input.name, "name"), primaryWorkspaceKey: requireWorkspaceKey(input.primaryWorkspaceKey) };
}

function parseProjectGet(value: unknown): BrainProjectGetInput {
  const input = requireRecord(value, "Project");
  return { projectId: requireString(input.projectId, "projectId") };
}

function parseProjectUpdate(value: unknown): BrainProjectUpdateInput {
  const input = requireRecord(value, "Project update");
  const status = input.status;
  if (status !== undefined && status !== "ACTIVE" && status !== "ARCHIVED") throw new TypeError("status is unsupported.");
  return { projectId: requireString(input.projectId, "projectId"), name: optionalString(input.name, "name"), status };
}

function parseProjectWorkspace(value: unknown): BrainProjectWorkspaceInput {
  const input = requireRecord(value, "Project workspace");
  if (typeof input.enabled !== "boolean") throw new TypeError("enabled must be boolean.");
  return {
    projectId: requireString(input.projectId, "projectId"),
    workspaceKey: requireWorkspaceKey(input.workspaceKey),
    enabled: input.enabled
  };
}

function parseConversationCreate(value: unknown): BrainConversationCreateInput {
  const input = requireRecord(value, "Conversation create");
  return {
    projectId: requireString(input.projectId, "projectId"),
    title: requireString(input.title, "title"),
    workspaceKey: optionalWorkspaceKey(input.workspaceKey)
  };
}

function parseConversationGet(value: unknown): BrainConversationGetInput {
  const input = requireRecord(value, "Conversation");
  return { conversationId: requireString(input.conversationId, "conversationId") };
}

function parseMessageAppend(value: unknown): BrainMessageAppendInput {
  const input = requireRecord(value, "Message append");
  if (input.role !== "system" && input.role !== "user" && input.role !== "assistant" && input.role !== "tool") {
    throw new TypeError("role is unsupported.");
  }
  return {
    conversationId: requireString(input.conversationId, "conversationId"),
    role: input.role,
    content: typeof input.content === "string" ? input.content : (() => { throw new TypeError("content must be a string."); })(),
    toolCallsJson: input.toolCallsJson === undefined ? undefined : requireString(input.toolCallsJson, "toolCallsJson"),
    sourceRefsJson: input.sourceRefsJson === undefined ? undefined : requireString(input.sourceRefsJson, "sourceRefsJson"),
    requestId: input.requestId === undefined ? undefined : requireString(input.requestId, "requestId")
  };
}

function parseDraftSave(value: unknown): BrainDraftSaveInput {
  const input = requireRecord(value, "Draft save");
  if (typeof input.content !== "string") throw new TypeError("content must be a string.");
  return {
    projectId: requireString(input.projectId, "projectId"),
    conversationId: requireString(input.conversationId, "conversationId"),
    content: input.content
  };
}

function withoutOwner<T extends { ownerId: string }>(value: T): Omit<T, "ownerId"> {
  const { ownerId: _ownerId, ...safe } = value;
  return safe;
}

export function registerBrainWorkspaceIpcHandlers(dependencies: BrainWorkspaceIpcDependencies) {
  const ownerId = () => Promise.resolve(dependencies.resolveOwnerId()).then((value) => requireString(value, "ownerId"));
  ipcMain.handle(brainWorkspaceIpcChannels.workspaceList, () => dependencies.storage.listWorkspaces());
  ipcMain.handle(brainWorkspaceIpcChannels.projectList, async (_event, value: unknown) =>
    dependencies.storage.listProjects({ ownerId: await ownerId(), ...parseProjectList(value) }).map(withoutOwner));
  ipcMain.handle(brainWorkspaceIpcChannels.projectCreate, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.createProject({ ownerId: await ownerId(), ...parseProjectCreate(value) })));
  ipcMain.handle(brainWorkspaceIpcChannels.projectGet, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.getProject(await ownerId(), parseProjectGet(value).projectId)));
  ipcMain.handle(brainWorkspaceIpcChannels.projectUpdate, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.updateProject({ ownerId: await ownerId(), ...parseProjectUpdate(value) })));
  ipcMain.handle(brainWorkspaceIpcChannels.projectWorkspaceEnable, async (_event, value: unknown) => {
    dependencies.storage.setProjectWorkspace({ ownerId: await ownerId(), ...parseProjectWorkspace(value) });
    return { ok: true };
  });
  ipcMain.handle(brainWorkspaceIpcChannels.conversationCreate, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.createConversation({ ownerId: await ownerId(), ...parseConversationCreate(value) })));
  ipcMain.handle(brainWorkspaceIpcChannels.conversationGet, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.getConversation(await ownerId(), parseConversationGet(value).conversationId)));
  ipcMain.handle(brainWorkspaceIpcChannels.messageList, async (_event, value: unknown) => {
    const input = parseConversationGet(value);
    return dependencies.storage.listMessages(await ownerId(), input.conversationId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.messageAppend, async (_event, value: unknown) => {
    const input = parseMessageAppend(value);
    return dependencies.storage.appendMessage({
      ownerId: await ownerId(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      toolCallsJson: input.toolCallsJson ?? "[]",
      sourceRefsJson: input.sourceRefsJson ?? "[]",
      requestId: input.requestId ?? ""
    });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.draftGet, async (_event, value: unknown) => {
    const input = parseConversationGet(value);
    return dependencies.storage.readDraft(await ownerId(), input.conversationId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.draftSave, async (_event, value: unknown) => {
    dependencies.storage.saveDraft({ ownerId: await ownerId(), ...parseDraftSave(value) });
    return { ok: true };
  });
}
