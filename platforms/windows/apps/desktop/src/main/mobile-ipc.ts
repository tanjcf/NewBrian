import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type MobilePairingState
} from "@codex-forge/protocol";

type MaybePromise<T> = T | Promise<T>;

interface MobileIpcServices {
  startPairing: () => MaybePromise<MobilePairingState>;
  getPairingStatus: () => MaybePromise<MobilePairingState>;
  stopPairing: () => MaybePromise<MobilePairingState>;
}

/** Register the mobile-pairing IPC surface without exposing the bridge server. */
export function registerMobileIpcHandlers(services: MobileIpcServices) {
  ipcMain.handle(desktopIpcChannels.mobile.startPairing, () => services.startPairing());
  ipcMain.handle(desktopIpcChannels.mobile.getPairingStatus, () => services.getPairingStatus());
  ipcMain.handle(desktopIpcChannels.mobile.stopPairing, () => services.stopPairing());
}
