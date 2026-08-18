import { ipcMain } from "electron";
import { desktopIpcChannels } from "@codex-forge/protocol";

type MaybePromise<T> = T | Promise<T>;

interface BrowserIpcServices {
  openPreview: (url?: string) => MaybePromise<{ ok: boolean; url: string }>;
  closePreview: () => MaybePromise<{ ok: boolean }>;
  capturePreview: () => MaybePromise<{ ok: boolean; path: string; url: string }>;
}

/** Register browser-preview IPC without exposing native preview-window capabilities. */
export function registerBrowserIpcHandlers(services: BrowserIpcServices) {
  ipcMain.handle(desktopIpcChannels.browser.openPreview, (_event, url: unknown) => {
    if (url !== undefined && typeof url !== "string") {
      throw new TypeError("Browser preview URL must be a string.");
    }
    return services.openPreview(url);
  });
  ipcMain.handle(desktopIpcChannels.browser.closePreview, () => services.closePreview());
  ipcMain.handle(desktopIpcChannels.browser.capturePreview, () => services.capturePreview());
}
