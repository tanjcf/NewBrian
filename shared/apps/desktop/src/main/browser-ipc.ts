import { dialog, ipcMain, session } from "electron";
import { desktopIpcChannels } from "@codex-forge/protocol";

type MaybePromise<T> = T | Promise<T>;

export type BrowserHistoryRow = { id: string; url: string; title: string; visitedAt: string };
export type BrowserCredentialRow = {
  id: string;
  origin: string;
  username: string;
  hasPassword: boolean;
  updatedAt: string;
};
export type BrowserContactRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  updatedAt: string;
};

interface BrowserIpcServices {
  openPreview: (url?: string) => MaybePromise<{ ok: boolean; url: string }>;
  closePreview: () => MaybePromise<{ ok: boolean }>;
  capturePreview: () => MaybePromise<{ ok: boolean; path: string; url: string }>;
  clearBrowsingData: () => MaybePromise<{ ok: boolean; detail: string }>;
  listHistory: () => MaybePromise<BrowserHistoryRow[]>;
  removeHistoryEntry: (id: string) => MaybePromise<BrowserHistoryRow[]>;
  clearHistory: () => MaybePromise<{ ok: boolean }>;
  selectDownloadDir: () => MaybePromise<{ path: string } | null>;
  listCredentials: () => MaybePromise<BrowserCredentialRow[]>;
  upsertCredential: (input: {
    origin: string;
    username: string;
    password: string;
    id?: string;
  }) => MaybePromise<BrowserCredentialRow[]>;
  removeCredential: (id: string) => MaybePromise<BrowserCredentialRow[]>;
  listContacts: () => MaybePromise<BrowserContactRow[]>;
  upsertContact: (input: {
    name: string;
    email?: string;
    phone?: string;
    id?: string;
  }) => MaybePromise<BrowserContactRow[]>;
  removeContact: (id: string) => MaybePromise<BrowserContactRow[]>;
  getCdpAccess: () => MaybePromise<{ enabled: boolean; partition: string; detail: string }>;
  probeSiteTools: () => MaybePromise<{ origin: string; enabled: boolean; endpoints: string[]; detail: string }>;
}

/** Register browser-preview and Browser Use management IPC. */
export function registerBrowserIpcHandlers(services: BrowserIpcServices) {
  ipcMain.handle(desktopIpcChannels.browser.openPreview, (_event, url: unknown) => {
    if (url !== undefined && typeof url !== "string") {
      throw new TypeError("Browser preview URL must be a string.");
    }
    return services.openPreview(url);
  });
  ipcMain.handle(desktopIpcChannels.browser.closePreview, () => services.closePreview());
  ipcMain.handle(desktopIpcChannels.browser.capturePreview, () => services.capturePreview());
  ipcMain.handle(desktopIpcChannels.browser.clearBrowsingData, () => services.clearBrowsingData());
  ipcMain.handle(desktopIpcChannels.browser.listHistory, () => services.listHistory());
  ipcMain.handle(desktopIpcChannels.browser.removeHistoryEntry, (_event, id: unknown) => {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("History entry id must be a string.");
    return services.removeHistoryEntry(id.trim());
  });
  ipcMain.handle(desktopIpcChannels.browser.clearHistory, () => services.clearHistory());
  ipcMain.handle(desktopIpcChannels.browser.selectDownloadDir, () => services.selectDownloadDir());
  ipcMain.handle(desktopIpcChannels.browser.listCredentials, () => services.listCredentials());
  ipcMain.handle(desktopIpcChannels.browser.upsertCredential, (_event, input: unknown) => {
    if (!input || typeof input !== "object") throw new TypeError("Credential payload must be an object.");
    const row = input as Record<string, unknown>;
    return services.upsertCredential({
      origin: String(row.origin ?? ""),
      username: String(row.username ?? ""),
      password: String(row.password ?? ""),
      id: typeof row.id === "string" ? row.id : undefined
    });
  });
  ipcMain.handle(desktopIpcChannels.browser.removeCredential, (_event, id: unknown) => {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("Credential id must be a string.");
    return services.removeCredential(id.trim());
  });
  ipcMain.handle(desktopIpcChannels.browser.listContacts, () => services.listContacts());
  ipcMain.handle(desktopIpcChannels.browser.upsertContact, (_event, input: unknown) => {
    if (!input || typeof input !== "object") throw new TypeError("Contact payload must be an object.");
    const row = input as Record<string, unknown>;
    return services.upsertContact({
      name: String(row.name ?? ""),
      email: typeof row.email === "string" ? row.email : undefined,
      phone: typeof row.phone === "string" ? row.phone : undefined,
      id: typeof row.id === "string" ? row.id : undefined
    });
  });
  ipcMain.handle(desktopIpcChannels.browser.removeContact, (_event, id: unknown) => {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("Contact id must be a string.");
    return services.removeContact(id.trim());
  });
  ipcMain.handle(desktopIpcChannels.browser.getCdpAccess, () => services.getCdpAccess());
  ipcMain.handle(desktopIpcChannels.browser.probeSiteTools, () => services.probeSiteTools());
}

/** Clear storage for the Browser Use persist partition. */
export async function clearNewbrainBrowserSessionData(partition = "persist:newbrain-browser") {
  const browserSession = session.fromPartition(partition);
  await browserSession.clearStorageData();
  await browserSession.clearCache();
}

export async function pickBrowserDownloadDirectory(): Promise<{ path: string } | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return { path: result.filePaths[0] };
}

export async function askBrowserHistoryAccessDialog(actionLabel = "访问浏览历史"): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["允许", "拒绝"],
    defaultId: 0,
    cancelId: 1,
    title: "Browser Use",
    message: `是否允许${actionLabel}？`
  });
  return result.response === 0;
}

export async function askBrowserAnnotationDialog(): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["包含批注元数据", "跳过"],
    defaultId: 0,
    cancelId: 1,
    title: "批注截图",
    message: "是否为此次截图写入批注元数据？"
  });
  return result.response === 0;
}

export async function askBrowserDownloadApprovalDialog(origin: string, filename: string): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["允许下载", "拒绝"],
    defaultId: 0,
    cancelId: 1,
    title: "Browser Use 下载",
    message: `是否允许从 ${origin || "未知站点"} 下载 ${filename}？`
  });
  return result.response === 0;
}

export async function pickBrowserDownloadSavePath(filename: string): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    title: "保存下载",
    defaultPath: filename
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}
