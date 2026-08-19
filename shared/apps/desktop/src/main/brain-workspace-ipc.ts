import { ipcMain } from "electron";
import {
  brainWorkspaceIpcChannels,
  brainWorkspaceKeys,
  type BrainConversationCreateInput,
  type BrainConversationListInput,
  type BrainConversationGetInput,
  type BrainDraftSaveInput,
  type BrainArtifactRegisterInput,
  type BrainFileRegisterInput,
  type BrainMessageAppendInput,
  type BrainProjectCreateInput,
  type BrainProjectGetInput,
  type BrainProjectListInput,
  type BrainProjectUpdateInput,
  type BrainProjectWorkspaceInput,
  type BrainTaskCreateInput,
  type BrainTaskUpdateInput,
  type BrainWorkspaceKey
} from "@codex-forge/protocol";
import type { BrainWorkspaceStorage } from "./brain-workspace-storage.js";
import type { QuantSimulationService } from "./quant-simulation-service.ts";

interface BrainWorkspaceIpcDependencies {
  storage: BrainWorkspaceStorage;
  resolveOwnerId: () => Promise<string> | string;
  quant?: QuantSimulationService;
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

function parseConversationList(value: unknown): BrainConversationListInput {
  const input = optionalRecord(value, "Conversation list");
  if (input.includeArchived !== undefined && typeof input.includeArchived !== "boolean") {
    throw new TypeError("includeArchived must be boolean.");
  }
  return {
    projectId: optionalString(input.projectId, "projectId"),
    workspaceKey: optionalWorkspaceKey(input.workspaceKey),
    includeArchived: input.includeArchived === true
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

function requireFiniteNumber(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${field} must be a finite number.`);
  return value;
}

function parseFileRegister(value: unknown): BrainFileRegisterInput {
  const input = requireRecord(value, "File register");
  return {
    projectId: requireString(input.projectId, "projectId"), logicalName: requireString(input.logicalName, "logicalName"),
    mimeType: requireString(input.mimeType, "mimeType"), sizeBytes: requireFiniteNumber(input.sizeBytes, "sizeBytes"),
    contentHash: requireString(input.contentHash, "contentHash"), storageKey: requireString(input.storageKey, "storageKey"),
    versionNo: input.versionNo === undefined ? undefined : requireFiniteNumber(input.versionNo, "versionNo")
  };
}

function parseTaskCreate(value: unknown): BrainTaskCreateInput {
  const input = requireRecord(value, "Task create");
  return {
    projectId: requireString(input.projectId, "projectId"),
    conversationId: optionalString(input.conversationId, "conversationId"),
    workspaceKey: requireWorkspaceKey(input.workspaceKey), taskType: requireString(input.taskType, "taskType"),
    requestId: optionalString(input.requestId, "requestId"), idempotencyKey: requireString(input.idempotencyKey, "idempotencyKey"),
    maxAttempts: input.maxAttempts === undefined ? undefined : requireFiniteNumber(input.maxAttempts, "maxAttempts"),
    resourceLimitsJson: optionalString(input.resourceLimitsJson, "resourceLimitsJson")
  };
}

function parseTaskUpdate(value: unknown): BrainTaskUpdateInput {
  const input = requireRecord(value, "Task update");
  const statuses = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"];
  if (typeof input.status !== "string" || !statuses.includes(input.status)) throw new TypeError("status is unsupported.");
  return {
    taskId: requireString(input.taskId, "taskId"), status: input.status as BrainTaskUpdateInput["status"],
    progress: input.progress === undefined ? undefined : requireFiniteNumber(input.progress, "progress"),
    errorCode: optionalString(input.errorCode, "errorCode"), errorDetail: optionalString(input.errorDetail, "errorDetail")
  };
}

function parseArtifactRegister(value: unknown): BrainArtifactRegisterInput {
  const input = requireRecord(value, "Artifact register");
  return {
    projectId: requireString(input.projectId, "projectId"), taskId: optionalString(input.taskId, "taskId"),
    sourceFileId: optionalString(input.sourceFileId, "sourceFileId"), artifactType: requireString(input.artifactType, "artifactType"),
    storageKey: requireString(input.storageKey, "storageKey"), contentHash: requireString(input.contentHash, "contentHash"),
    validationStatus: optionalString(input.validationStatus, "validationStatus")
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
  ipcMain.handle(brainWorkspaceIpcChannels.conversationList, async (_event, value: unknown) =>
    dependencies.storage.listConversations({ ownerId: await ownerId(), ...parseConversationList(value) }).map(withoutOwner));
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
  ipcMain.handle(brainWorkspaceIpcChannels.fileList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listFiles(await ownerId(), input.projectId).map(withoutOwner);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.fileRegister, async (_event, value: unknown) =>
    withoutOwner(dependencies.storage.registerFile({ ownerId: await ownerId(), ...parseFileRegister(value) })));
  ipcMain.handle(brainWorkspaceIpcChannels.taskList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listTasks(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.taskCreate, async (_event, value: unknown) =>
    dependencies.storage.createTask({ ownerId: await ownerId(), ...parseTaskCreate(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.taskUpdate, async (_event, value: unknown) =>
    dependencies.storage.updateTask({ ownerId: await ownerId(), ...parseTaskUpdate(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.artifactList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listArtifacts(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.artifactRegister, async (_event, value: unknown) =>
    dependencies.storage.registerArtifact({ ownerId: await ownerId(), ...parseArtifactRegister(value) }));
  ipcMain.handle(brainWorkspaceIpcChannels.annotationList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listAnnotations(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.annotationCreate, async (_event, value: unknown) => {
    const input = requireRecord(value, "Annotation create");
    return dependencies.storage.createAnnotation({
      ownerId: await ownerId(), projectId: requireString(input.projectId, "projectId"), fileId: requireString(input.fileId, "fileId"),
      fileVersion: Number(input.fileVersion), pageOrSheet: typeof input.pageOrSheet === "string" ? input.pageOrSheet : "",
      annotationType: requireString(input.annotationType, "annotationType"), geometryJson: typeof input.geometryJson === "string" ? input.geometryJson : "{}",
      structuralAnchorJson: typeof input.structuralAnchorJson === "string" ? input.structuralAnchorJson : "{}", selectedText: typeof input.selectedText === "string" ? input.selectedText : ""
    });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetList, async (_event, value: unknown) => {
    const input = parseProjectGet(value);
    return dependencies.storage.listChangeSets(await ownerId(), input.projectId);
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetCreate, async (_event, value: unknown) => {
    const input = requireRecord(value, "Change set create");
    return dependencies.storage.createChangeSet({
      ownerId: await ownerId(), projectId: requireString(input.projectId, "projectId"), annotationId: requireString(input.annotationId, "annotationId"),
      taskId: typeof input.taskId === "string" ? input.taskId : undefined, baseFileVersion: Number(input.baseFileVersion),
      changeSummary: requireString(input.changeSummary, "changeSummary"), diffJson: typeof input.diffJson === "string" ? input.diffJson : "{}"
    });
  });
  ipcMain.handle(brainWorkspaceIpcChannels.changeSetUpdate, async (_event, value: unknown) => {
    const input = requireRecord(value, "Change set update");
    const status = input.status;
    if (status !== "ACCEPTED" && status !== "REJECTED" && status !== "REVERTED") throw new TypeError("status is invalid");
    return dependencies.storage.updateChangeSet({ ownerId: await ownerId(), projectId: requireString(input.projectId, "projectId"), changeSetId: requireString(input.changeSetId, "changeSetId"), status, resultFileVersion: input.resultFileVersion === undefined ? undefined : Number(input.resultFileVersion) });
  });
  if (dependencies.quant) {
    ipcMain.handle(brainWorkspaceIpcChannels.quantSessionCreate, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant session");
      dependencies.quant!.createSession(requireString(input.projectId, "projectId"), typeof input.initialCash === "number" ? input.initialCash : 100_000);
      return { ok: true };
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantBarsQuery, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant bars");
      return dependencies.quant!.queryBarsAsync(requireString(input.projectId, "projectId"), input.query as any);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantOrderExecute, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant order");
      return dependencies.quant!.executeOrder(requireString(input.projectId, "projectId"), input.order as any);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantSnapshot, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant snapshot");
      return dependencies.quant!.snapshot(requireString(input.projectId, "projectId"), (input.prices || {}) as Record<string, number>);
    });
    ipcMain.handle(brainWorkspaceIpcChannels.quantSkillPerformance, async (_event, value: unknown) => {
      const input = requireRecord(value, "Quant performance");
      return dependencies.quant!.performance(requireString(input.projectId, "projectId"), requireString(input.skillId, "skillId"));
    });
  }
}
