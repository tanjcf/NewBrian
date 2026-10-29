import { ipcMain, type WebContents } from "electron";
import {
  desktopIpcChannels,
  type CancelModelRequestInput,
  type RespondApprovalInput
} from "@codex-forge/protocol";
import {
  parseCancelModelRequestInput,
  parseLivePermissionModeInput,
  parseRespondApprovalInput,
  parseShellCommand
} from "./runtime-control-contract.js";

type MaybePromise<T> = T | Promise<T>;

interface RuntimeControlIpcServices {
  cancelModelRequest: (input: CancelModelRequestInput) => MaybePromise<unknown>;
  queueShellCommand: (command: string) => MaybePromise<unknown>;
  respondApproval: (sender: WebContents, input: RespondApprovalInput) => MaybePromise<unknown>;
  setLivePermissionMode: (input: { requestId: string; permissionMode: "full" }) => MaybePromise<unknown>;
}

/** Registers cancellation, shell, and approval controls behind strict input contracts. */
export function registerRuntimeControlIpcHandlers(services: RuntimeControlIpcServices) {
  ipcMain.handle(desktopIpcChannels.model.cancelRequest, (_event, input: unknown) =>
    services.cancelModelRequest(parseCancelModelRequestInput(input)));
  ipcMain.handle(desktopIpcChannels.core.queueShellCommand, (_event, command: unknown) =>
    services.queueShellCommand(parseShellCommand(command)));
  ipcMain.handle(desktopIpcChannels.core.respondApproval, (event, input: unknown) =>
    services.respondApproval(event.sender, parseRespondApprovalInput(input)));
  ipcMain.handle(desktopIpcChannels.core.setLivePermissionMode, (_event, input: unknown) =>
    services.setLivePermissionMode(parseLivePermissionModeInput(input)));
}
