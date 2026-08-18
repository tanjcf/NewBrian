import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type DesktopAppUpdateStartResult,
  type DesktopAppUpdateStatus,
  type DesktopAppUpdateVerifyInput,
  type DesktopAppUpdateVerifyResult
} from "@codex-forge/protocol";

interface DesktopAppUpdateIpcServices {
  getStatus: () => Promise<DesktopAppUpdateStatus>;
  start: () => Promise<DesktopAppUpdateStartResult>;
  verify: (input?: DesktopAppUpdateVerifyInput) => Promise<DesktopAppUpdateVerifyResult>;
}

/** Register click-to-upgrade and verify-update IPC channels. */
export function registerDesktopAppUpdateIpc(services: DesktopAppUpdateIpcServices) {
  ipcMain.handle(desktopIpcChannels.appUpdate.getStatus, () => services.getStatus());
  ipcMain.handle(desktopIpcChannels.appUpdate.start, () => services.start());
  ipcMain.handle(
    desktopIpcChannels.appUpdate.verify,
    (_event, input?: DesktopAppUpdateVerifyInput) => services.verify(input)
  );
}
