import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type AddWorkspaceInput,
  type AddWorkspaceThreadInput,
  type ArchiveWorkspaceThreadInput,
  type ChatMessage,
  type CreateBlankWorkspaceInput,
  type ExportWorkspaceThreadHtmlInput,
  type ForkWorkspaceThreadInput,
  type RewindWorkspaceThreadInput,
  type OpenWorkspaceLocationInput,
  type RenameWorkspaceInput,
  type RenameWorkspaceThreadInput,
  type SearchResultSpec,
  type WorkspaceFileActionInput,
  type WorkspaceFileInput,
  type WorkspaceIdInput,
  type WorkspaceThreadInput
} from "@codex-forge/protocol";
import { parseWorkspaceThreadInput } from "./workspace-lifecycle-contract.js";
import { parseWorkspaceFileAction } from "./workspace-file-action-contract.js";

type MaybePromise<T> = T | Promise<T>;

interface WorkspaceIpcServices {
  list: () => MaybePromise<unknown>;
  add: (input: AddWorkspaceInput) => MaybePromise<unknown>;
  createBlank: (input: CreateBlankWorkspaceInput) => MaybePromise<unknown>;
  selectFolder: () => MaybePromise<unknown>;
  rename: (input: RenameWorkspaceInput) => MaybePromise<unknown>;
  remove: (input: WorkspaceIdInput) => MaybePromise<unknown>;
  openLocation: (input: OpenWorkspaceLocationInput) => MaybePromise<unknown>;
  addThread: (input: AddWorkspaceThreadInput) => MaybePromise<unknown>;
  forkThread: (input: ForkWorkspaceThreadInput) => MaybePromise<unknown>;
  rewindThread: (input: RewindWorkspaceThreadInput) => MaybePromise<unknown>;
  renameThread: (input: RenameWorkspaceThreadInput) => MaybePromise<unknown>;
  archiveThread: (input: ArchiveWorkspaceThreadInput) => MaybePromise<unknown>;
  deleteThread: (input: WorkspaceThreadInput) => MaybePromise<unknown>;
  activateThread: (input: WorkspaceThreadInput) => MaybePromise<unknown>;
  exportThreadHtml: (input: ExportWorkspaceThreadHtmlInput) => MaybePromise<unknown>;
  search: (query: string) => MaybePromise<SearchResultSpec[]>;
  previewConversationRef?: (input: import("@codex-forge/protocol").ConversationRefPreviewInput) => MaybePromise<import("@codex-forge/protocol").ConversationRefPreviewResult>;
  readFile: (input: WorkspaceFileInput) => MaybePromise<unknown>;
  previewFile: (input: WorkspaceFileInput) => MaybePromise<unknown>;
  openFile: (input: WorkspaceFileInput) => MaybePromise<unknown>;
  performFileAction: (input: WorkspaceFileActionInput) => MaybePromise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(input: unknown, label: string): Record<string, unknown> {
  if (!isRecord(input)) throw new TypeError(`${label} input is invalid.`);
  return input;
}

function requireString(input: Record<string, unknown>, field: string, label: string): string {
  const value = input[field];
  if (typeof value !== "string") throw new TypeError(`${label} input is invalid.`);
  return value;
}

function parseWorkspaceId(input: unknown): WorkspaceIdInput {
  const record = requireRecord(input, "Workspace");
  return { workspaceId: requireString(record, "workspaceId", "Workspace") };
}

function parseAdd(input: unknown): AddWorkspaceInput {
  const record = requireRecord(input, "Add workspace");
  const payload: AddWorkspaceInput = {
    name: requireString(record, "name", "Add workspace"),
    path: requireString(record, "path", "Add workspace")
  };
  if (typeof record.brainWorkspaceKey === "string" && record.brainWorkspaceKey.trim()) {
    payload.brainWorkspaceKey = record.brainWorkspaceKey.trim() as AddWorkspaceInput["brainWorkspaceKey"];
  }
  return payload;
}

function parseCreateBlank(input: unknown): CreateBlankWorkspaceInput {
  const record = requireRecord(input, "Create workspace");
  const payload: CreateBlankWorkspaceInput = { name: requireString(record, "name", "Create workspace") };
  if (typeof record.brainWorkspaceKey === "string" && record.brainWorkspaceKey.trim()) {
    payload.brainWorkspaceKey = record.brainWorkspaceKey.trim() as CreateBlankWorkspaceInput["brainWorkspaceKey"];
  }
  return payload;
}

function parseRename(input: unknown): RenameWorkspaceInput {
  const record = requireRecord(input, "Rename workspace");
  return { workspaceId: requireString(record, "workspaceId", "Rename workspace"), name: requireString(record, "name", "Rename workspace") };
}

function parseOpenLocation(input: unknown): OpenWorkspaceLocationInput {
  const record = requireRecord(input, "Open workspace location");
  if (record.target !== "explorer" && record.target !== "vscode") throw new TypeError("Open workspace location input is invalid.");
  return { workspaceId: requireString(record, "workspaceId", "Open workspace location"), target: record.target };
}

function parseAddThread(input: unknown): AddWorkspaceThreadInput {
  const record = requireRecord(input, "Add workspace thread");
  if (record.scope !== undefined && record.scope !== "project" && record.scope !== "chat") throw new TypeError("Add workspace thread input is invalid.");
  return { workspaceId: requireString(record, "workspaceId", "Add workspace thread"), title: requireString(record, "title", "Add workspace thread"), summary: requireString(record, "summary", "Add workspace thread"), scope: record.scope };
}

function parseRewindThread(input: unknown): RewindWorkspaceThreadInput {
  const record = requireRecord(input, "Rewind workspace thread");
  return {
    workspaceId: requireString(record, "workspaceId", "Rewind workspace thread"),
    threadId: requireString(record, "threadId", "Rewind workspace thread"),
    userMessageId: requireString(record, "userMessageId", "Rewind workspace thread")
  };
}

function parseForkThread(input: unknown): ForkWorkspaceThreadInput {
  const record = requireRecord(input, "Fork workspace thread");
  const owners = ["planner", "researcher", "verifier", "editor"];
  if (record.owner !== undefined && (typeof record.owner !== "string" || !owners.includes(record.owner))) throw new TypeError("Fork workspace thread input is invalid.");
  if (record.instruction !== undefined && typeof record.instruction !== "string") throw new TypeError("Fork workspace thread input is invalid.");
  return { workspaceId: requireString(record, "workspaceId", "Fork workspace thread"), sourceThreadId: requireString(record, "sourceThreadId", "Fork workspace thread"), title: requireString(record, "title", "Fork workspace thread"), owner: record.owner as ForkWorkspaceThreadInput["owner"], instruction: record.instruction };
}

function parseRenameThread(input: unknown): RenameWorkspaceThreadInput {
  const record = requireRecord(input, "Rename workspace thread");
  return { workspaceId: requireString(record, "workspaceId", "Rename workspace thread"), threadId: requireString(record, "threadId", "Rename workspace thread"), title: requireString(record, "title", "Rename workspace thread"), summary: requireString(record, "summary", "Rename workspace thread") };
}

function parseArchiveThread(input: unknown): ArchiveWorkspaceThreadInput {
  const record = requireRecord(input, "Archive workspace thread");
  if (typeof record.archived !== "boolean" || (record.scope !== undefined && record.scope !== "project" && record.scope !== "chat")) throw new TypeError("Archive workspace thread input is invalid.");
  return { workspaceId: requireString(record, "workspaceId", "Archive workspace thread"), threadId: requireString(record, "threadId", "Archive workspace thread"), archived: record.archived, scope: record.scope };
}

function parseLiveMessages(value: unknown): ChatMessage[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("Export workspace thread HTML input is invalid.");
  return value.map((item, index) => {
    if (!isRecord(item)) throw new TypeError(`Export workspace thread HTML message[${index}] is invalid.`);
    const role = item.role;
    if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") {
      throw new TypeError(`Export workspace thread HTML message[${index}] role is invalid.`);
    }
    const content = typeof item.content === "string" ? item.content : "";
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
    const id = typeof item.id === "string" && item.id.trim() ? item.id : `msg-${index}`;
    const message: ChatMessage = { id, role, content, createdAt };
    if (typeof item.reasoningSummary === "string") message.reasoningSummary = item.reasoningSummary;
    if (Array.isArray(item.attachments)) {
      message.attachments = item.attachments.flatMap((attachment) => {
        if (!isRecord(attachment)) return [];
        return [{
          name: typeof attachment.name === "string" ? attachment.name : "",
          path: typeof attachment.path === "string" ? attachment.path : "",
          url: typeof attachment.url === "string" ? attachment.url : ""
        }];
      });
    }
    return message;
  });
}

function parseExportThreadHtml(input: unknown): ExportWorkspaceThreadHtmlInput {
  const base = parseWorkspaceThreadInput(input);
  const record = requireRecord(input, "Export workspace thread HTML");
  return {
    ...base,
    liveMessages: parseLiveMessages(record.liveMessages)
  };
}

function parseWorkspaceFile(input: unknown): WorkspaceFileInput {
  const record = requireRecord(input, "Workspace file");
  return { workspaceId: requireString(record, "workspaceId", "Workspace file"), filePath: requireString(record, "filePath", "Workspace file") };
}

export function registerWorkspaceIpcHandlers(services: WorkspaceIpcServices) {
  ipcMain.handle(desktopIpcChannels.workspace.list, () => services.list());
  ipcMain.handle(desktopIpcChannels.workspace.add, (_event, input: unknown) => services.add(parseAdd(input)));
  ipcMain.handle(desktopIpcChannels.workspace.createBlank, (_event, input: unknown) => services.createBlank(parseCreateBlank(input)));
  ipcMain.handle(desktopIpcChannels.workspace.selectFolder, () => services.selectFolder());
  ipcMain.handle(desktopIpcChannels.workspace.rename, (_event, input: unknown) => services.rename(parseRename(input)));
  ipcMain.handle(desktopIpcChannels.workspace.remove, (_event, input: unknown) => services.remove(parseWorkspaceId(input)));
  ipcMain.handle(desktopIpcChannels.workspace.openLocation, (_event, input: unknown) => services.openLocation(parseOpenLocation(input)));
  ipcMain.handle(desktopIpcChannels.workspace.addThread, (_event, input: unknown) => services.addThread(parseAddThread(input)));
  ipcMain.handle(desktopIpcChannels.workspace.forkThread, (_event, input: unknown) => services.forkThread(parseForkThread(input)));
  ipcMain.handle(desktopIpcChannels.workspace.rewindThread, (_event, input: unknown) => services.rewindThread(parseRewindThread(input)));
  ipcMain.handle(desktopIpcChannels.workspace.renameThread, (_event, input: unknown) => services.renameThread(parseRenameThread(input)));
  ipcMain.handle(desktopIpcChannels.workspace.archiveThread, (_event, input: unknown) => services.archiveThread(parseArchiveThread(input)));
  ipcMain.handle(desktopIpcChannels.workspace.deleteThread, (_event, input: unknown) => services.deleteThread(parseWorkspaceThreadInput(input)));
  ipcMain.handle(desktopIpcChannels.workspace.activateThread, (_event, input: unknown) => services.activateThread(parseWorkspaceThreadInput(input)));
  ipcMain.handle(desktopIpcChannels.workspace.exportThreadHtml, (_event, input: unknown) => services.exportThreadHtml(parseExportThreadHtml(input)));
  ipcMain.handle(desktopIpcChannels.search.workspaces, (_event, query: unknown) => {
    if (typeof query !== "string") throw new TypeError("Workspace search query must be a string.");
    return services.search(query);
  });
  if (typeof services.previewConversationRef === "function") {
    ipcMain.handle(desktopIpcChannels.search.conversationRefPreview, (_event, input: unknown) => {
      if (!isRecord(input)) throw new TypeError("Conversation ref preview input must be an object.");
      const kind = String(input.kind || "").trim();
      if (kind !== "thread" && kind !== "brain_conversation") {
        throw new TypeError("Conversation ref preview kind must be thread or brain_conversation.");
      }
      return services.previewConversationRef!({
        kind,
        workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : undefined,
        threadId: typeof input.threadId === "string" ? input.threadId : undefined,
        conversationId: typeof input.conversationId === "string" ? input.conversationId : undefined,
        turnLimit: typeof input.turnLimit === "number" ? input.turnLimit : undefined
      });
    });
  }
  ipcMain.handle(desktopIpcChannels.workspaceFiles.read, async (_event, input: unknown) => {
    try {
      return await services.readFile(parseWorkspaceFile(input));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: message,
        reason: /文件不存在|ENOENT|not found|无法预览/i.test(message) ? "missing_file" : "read_failed",
        content: "",
        binary: false,
        size: 0,
        path: typeof (input as { filePath?: unknown })?.filePath === "string" ? (input as { filePath: string }).filePath : ""
      };
    }
  });
  ipcMain.handle(desktopIpcChannels.workspaceFiles.preview, async (_event, input: unknown) => {
    try {
      return await services.previewFile(parseWorkspaceFile(input));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const filePath = typeof (input as { filePath?: unknown })?.filePath === "string"
        ? (input as { filePath: string }).filePath
        : "";
      return {
        ok: false,
        error: message,
        reason: /文件不存在|ENOENT|not found|无法预览/i.test(message) ? "missing_file" : "read_failed",
        path: filePath,
        name: filePath.split(/[\\/]/).pop() || filePath
      };
    }
  });
  ipcMain.handle(desktopIpcChannels.workspaceFiles.open, async (_event, input: unknown) => {
    try {
      return await services.openFile(parseWorkspaceFile(input));
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(desktopIpcChannels.workspaceFiles.performAction, async (_event, input: unknown) => {
    try {
      return await services.performFileAction(parseWorkspaceFileAction(input));
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  });
}
