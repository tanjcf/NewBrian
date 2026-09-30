import { basename, join } from "node:path";
import {
  assertBrowserAgentPermission,
  browserOriginFromUrl,
  resolveBrowserAgentPermissionMode,
  type BrowserUsePreferences
} from "./browser-agent-policy.ts";

export interface BrowserDownloadItemLike {
  getURL(): string;
  getFilename(): string;
  setSavePath(path: string): void;
  setSaveDialogOptions(options: { title?: string; defaultPath?: string }): void;
  cancel(): void;
}

export type BrowserDownloadAskSavePath = (filename: string) => Promise<string | null>;
export type BrowserDownloadAskApproval = (origin: string, filename: string) => Promise<boolean>;

/**
 * Apply Browser Use download directory / ask-path prefs and agent download permission.
 */
export async function applyBrowserDownloadItemPolicy(input: {
  item: BrowserDownloadItemLike;
  browser: Pick<BrowserUsePreferences, "enabled" | "agentPermissions" | "downloadDir" | "askDownloadPath">;
  askSavePath?: BrowserDownloadAskSavePath;
  askApproval?: BrowserDownloadAskApproval;
}): Promise<{ ok: boolean; detail: string }> {
  const url = input.item.getURL();
  const origin = browserOriginFromUrl(url);
  const filename = input.item.getFilename() || "download";
  try {
    assertBrowserAgentPermission(input.browser, origin, "download");
  } catch (error) {
    input.item.cancel();
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }

  const mode = resolveBrowserAgentPermissionMode(input.browser, origin, "download");
  if (mode === "require_approval" && input.askApproval) {
    const approved = await input.askApproval(origin || url, filename);
    if (!approved) {
      input.item.cancel();
      return { ok: false, detail: "用户拒绝了下载。" };
    }
  }

  const downloadDir = String(input.browser.downloadDir || "").trim();
  if (downloadDir && !input.browser.askDownloadPath) {
    input.item.setSavePath(join(downloadDir, basename(filename)));
    return { ok: true, detail: `saved to ${downloadDir}` };
  }

  if (input.browser.askDownloadPath && input.askSavePath) {
    const chosen = await input.askSavePath(filename);
    if (!chosen) {
      input.item.cancel();
      return { ok: false, detail: "用户取消了保存位置选择。" };
    }
    input.item.setSavePath(chosen);
    return { ok: true, detail: `saved to ${chosen}` };
  }

  if (downloadDir) {
    input.item.setSavePath(join(downloadDir, basename(filename)));
    return { ok: true, detail: `saved to ${downloadDir}` };
  }

  input.item.setSaveDialogOptions({ title: "保存下载", defaultPath: filename });
  return { ok: true, detail: "using system save dialog" };
}
