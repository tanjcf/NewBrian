import { ipcMain, type WebContents } from "electron";
import {
  desktopIpcChannels,
  type ShowAppMenuInput,
  type WindowControlAction
} from "@codex-forge/protocol";
import { parseShowAppMenuInput } from "./app-menu-contract.js";

type MaybePromise<T> = T | Promise<T>;

interface WindowIpcServices {
  control: (action: WindowControlAction) => MaybePromise<{ ok: boolean }>;
  showInputContextMenu: (sender: WebContents) => MaybePromise<{ ok: boolean }>;
  showAppMenu: (sender: WebContents, input: ShowAppMenuInput) => MaybePromise<{ ok: boolean }>;
}

function parseWindowAction(input: unknown): WindowControlAction {
  if (input !== "minimize" && input !== "maximize" && input !== "close") {
    throw new TypeError("Window control action is invalid.");
  }
  return input;
}

/** Register native window commands behind a finite action contract. */
export function registerWindowIpcHandlers(services: WindowIpcServices) {
  ipcMain.handle(desktopIpcChannels.window.control, (_event, action: unknown) =>
    services.control(parseWindowAction(action))
  );
  ipcMain.handle(desktopIpcChannels.window.showInputContextMenu, (event) =>
    services.showInputContextMenu(event.sender)
  );
  ipcMain.handle(desktopIpcChannels.window.showAppMenu, (event, input: unknown) =>
    services.showAppMenu(event.sender, parseShowAppMenuInput(input))
  );
}
