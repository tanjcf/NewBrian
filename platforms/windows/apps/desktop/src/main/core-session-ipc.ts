import { ipcMain } from "electron";
import { desktopIpcChannels, type GeneratePatchInput } from "@codex-forge/protocol";
import { parseGeneratePatchInput } from "./core-session-contract.js";

type MaybePromise<T> = T | Promise<T>;

interface CoreSessionIpcServices {
  bootstrap: () => MaybePromise<unknown>;
  getSnapshot: () => MaybePromise<unknown>;
  queueWorkspaceScan: () => MaybePromise<unknown>;
  queueGitStatus: () => MaybePromise<unknown>;
  generatePatch: (input: GeneratePatchInput) => MaybePromise<unknown>;
  applyPatch: () => MaybePromise<unknown>;
}

/** Registers core session queries and patch operations behind a narrow IPC boundary. */
export function registerCoreSessionIpcHandlers(services: CoreSessionIpcServices) {
  ipcMain.handle(desktopIpcChannels.core.bootstrap, () => services.bootstrap());
  ipcMain.handle(desktopIpcChannels.core.getSnapshot, () => services.getSnapshot());
  ipcMain.handle(desktopIpcChannels.core.queueWorkspaceScan, () => services.queueWorkspaceScan());
  ipcMain.handle(desktopIpcChannels.core.queueGitStatus, () => services.queueGitStatus());
  ipcMain.handle(desktopIpcChannels.core.generatePatch, (_event, input: unknown) => services.generatePatch(parseGeneratePatchInput(input)));
  ipcMain.handle(desktopIpcChannels.core.applyPatch, () => services.applyPatch());
}
