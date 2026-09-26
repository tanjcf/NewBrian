import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type DesktopAppUpdateAppliedInfo,
  type DesktopAppUpdateStartResult,
  type DesktopAppUpdateStatus,
  type DesktopAppUpdateVerifyInput,
  type DesktopAppUpdateVerifyResult
} from "@codex-forge/protocol";

interface DesktopAppUpdateIpcServices {
  getStatus: () => Promise<DesktopAppUpdateStatus>;
  start: () => Promise<DesktopAppUpdateStartResult>;
  apply: () => Promise<DesktopAppUpdateStartResult>;
  getApplied: () => Promise<DesktopAppUpdateAppliedInfo | null>;
  dismissApplied: () => Promise<void>;
  skipVersion: (version?: string) => Promise<{ ok: boolean; detail: string }>;
  verify: (input?: DesktopAppUpdateVerifyInput) => Promise<DesktopAppUpdateVerifyResult>;
}

/** Register click-to-upgrade and verify-update IPC channels. */
export function registerDesktopAppUpdateIpc(services: DesktopAppUpdateIpcServices) {
  ipcMain.handle(desktopIpcChannels.appUpdate.getStatus, () => services.getStatus());
  ipcMain.handle(desktopIpcChannels.appUpdate.start, () => services.start());
  ipcMain.handle(desktopIpcChannels.appUpdate.apply, () => services.apply());
  ipcMain.handle(desktopIpcChannels.appUpdate.getApplied, () => services.getApplied());
  ipcMain.handle(desktopIpcChannels.appUpdate.dismissApplied, () => services.dismissApplied());
  ipcMain.handle(
    desktopIpcChannels.appUpdate.skipVersion,
    (_event, version?: string) => services.skipVersion(version)
  );
  ipcMain.handle(
    desktopIpcChannels.appUpdate.verify,
    (_event, input?: DesktopAppUpdateVerifyInput) => services.verify(input)
  );
}
