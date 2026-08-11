import { ipcMain } from "electron";
import {
  desktopIpcChannels,
  type DesktopBootstrapStatus,
  type DesktopPreferences
} from "@codex-forge/protocol";

interface SettingsIpcServices {
  getPreferences: () => Promise<DesktopPreferences>;
  savePreferences: (preferences: DesktopPreferences) => Promise<DesktopPreferences>;
  getBootstrapStatus: () => Promise<DesktopBootstrapStatus>;
  retryCondaBootstrap: () => Promise<DesktopBootstrapStatus>;
  startBootstrap: () => Promise<DesktopBootstrapStatus>;
}

/** Register the settings/bootstrap IPC surface at one audited main-process boundary. */
export function registerSettingsIpcHandlers(services: SettingsIpcServices) {
  ipcMain.handle(desktopIpcChannels.preferences.get, () => services.getPreferences());
  ipcMain.handle(
    desktopIpcChannels.preferences.save,
    (_event, preferences: DesktopPreferences) => services.savePreferences(preferences)
  );
  ipcMain.handle(desktopIpcChannels.bootstrap.getStatus, () => services.getBootstrapStatus());
  ipcMain.handle(desktopIpcChannels.bootstrap.retryConda, () => services.retryCondaBootstrap());
  ipcMain.handle(desktopIpcChannels.bootstrap.start, () => services.startBootstrap());
}
