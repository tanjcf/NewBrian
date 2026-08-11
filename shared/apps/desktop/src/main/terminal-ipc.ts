import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type TerminalSessionSnapshot
} from "@codex-forge/protocol";

type MaybePromise<T> = T | Promise<T>;

interface TerminalIpcServices {
  getSession: () => MaybePromise<TerminalSessionSnapshot>;
  writeInput: (input: string) => MaybePromise<TerminalSessionSnapshot>;
  restartSession: () => MaybePromise<TerminalSessionSnapshot>;
  openSystem: (cwd: string) => MaybePromise<{ ok: boolean }>;
}

/** Register terminal-session IPC while keeping process handles inside the main process. */
export function registerTerminalIpcHandlers(services: TerminalIpcServices) {
  ipcMain.handle(desktopIpcChannels.terminal.getSession, () => services.getSession());
  ipcMain.handle(desktopIpcChannels.terminal.writeInput, (_event, input: unknown) => {
    if (typeof input !== "string") {
      throw new TypeError("Terminal input must be a string.");
    }
    return services.writeInput(input);
  });
  ipcMain.handle(desktopIpcChannels.terminal.restartSession, () => services.restartSession());
  ipcMain.handle(desktopIpcChannels.terminal.openSystem, (_event, cwd: unknown) => {
    if (typeof cwd !== "string" || cwd.length > 4_096) throw new TypeError("System terminal path is invalid.");
    return services.openSystem(cwd.trim());
  });
}
