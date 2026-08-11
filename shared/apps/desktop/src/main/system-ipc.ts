import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type OpenLogLocationResult,
  type OpenSkillLocationInput,
  type OpenSystemToolInput,
  type RendererFailureInput,
  type SystemOpenResult,
  type SystemToolEntry
} from "@codex-forge/protocol";

type MaybePromise<T> = T | Promise<T>;

interface SystemIpcServices {
  getTools: () => MaybePromise<SystemToolEntry[]>;
  openTool: (input: OpenSystemToolInput) => MaybePromise<SystemOpenResult>;
  openSkillLocation: (input: OpenSkillLocationInput) => MaybePromise<SystemOpenResult>;
  openLogLocation: () => MaybePromise<OpenLogLocationResult>;
  reportRendererFailure: (input: RendererFailureInput) => MaybePromise<{ ok: boolean; id: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOpenToolInput(input: unknown): OpenSystemToolInput {
  if (typeof input === "string") {
    return { toolId: input };
  }
  if (!isRecord(input)
    || typeof input.toolId !== "string"
    || (input.workspaceId !== undefined && typeof input.workspaceId !== "string")) {
    throw new TypeError("System tool input is invalid.");
  }
  return { toolId: input.toolId, workspaceId: input.workspaceId };
}

function parseOpenSkillInput(input: unknown): OpenSkillLocationInput {
  if (!isRecord(input)
    || (input.id !== undefined && typeof input.id !== "string")
    || (input.name !== undefined && typeof input.name !== "string")) {
    throw new TypeError("Skill location input is invalid.");
  }
  return { id: input.id, name: input.name };
}

export function parseRendererFailureInput(input: unknown): RendererFailureInput {
  if (!isRecord(input)
    || !["renderer_error", "renderer_unhandled_rejection", "renderer_bootstrap_error"].includes(String(input.kind))
    || typeof input.message !== "string"
    || (input.stackTrace !== undefined && typeof input.stackTrace !== "string")
    || (input.context !== undefined && !isRecord(input.context))) {
    throw new TypeError("Renderer failure input is invalid.");
  }
  return {
    kind: input.kind as RendererFailureInput["kind"],
    message: input.message,
    stackTrace: input.stackTrace,
    context: input.context
  };
}

/** Register native system capabilities behind validated, data-only IPC contracts. */
export function registerSystemIpcHandlers(services: SystemIpcServices) {
  ipcMain.handle(desktopIpcChannels.system.getTools, () => services.getTools());
  ipcMain.handle(desktopIpcChannels.system.openTool, (_event, input: unknown) =>
    services.openTool(parseOpenToolInput(input))
  );
  ipcMain.handle(desktopIpcChannels.system.openSkillLocation, (_event, input: unknown) =>
    services.openSkillLocation(parseOpenSkillInput(input))
  );
  ipcMain.handle(desktopIpcChannels.system.openLogLocation, () => services.openLogLocation());
  ipcMain.handle(desktopIpcChannels.system.reportRendererFailure, (_event, input: unknown) =>
    services.reportRendererFailure(parseRendererFailureInput(input))
  );
}
