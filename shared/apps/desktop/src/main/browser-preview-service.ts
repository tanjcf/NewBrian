import type { DesktopPreferences } from "@codex-forge/protocol";
import { resolveBrowserLinkOpenTarget } from "./browser-agent-policy.ts";

export function normalizeBrowserPreviewUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Browser URL is required.");
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Browser navigation only supports http and https URLs.");
  }
  return parsed.toString();
}

export interface BrowserPreviewServiceDependencies {
  getPreferences: () => Promise<DesktopPreferences>;
  openWindow: (url: string) => Promise<unknown>;
  closeWindow: () => void;
  captureWindow: () => Promise<{ ok: boolean; path: string; url: string }>;
  saveThreadState: (summary: string) => Promise<unknown>;
  appendDiagnostics: (entry: string) => Promise<unknown>;
  /** Opens http(s) URLs in the OS default browser when link policy says system. */
  openExternal?: (url: string) => Promise<void>;
}

/** Coordinates browser preview lifecycle and its observable thread diagnostics. */
export class BrowserPreviewService {
  private readonly dependencies: BrowserPreviewServiceDependencies;

  constructor(dependencies: BrowserPreviewServiceDependencies) {
    this.dependencies = dependencies;
  }

  async open(url?: string) {
    const preferences = await this.dependencies.getPreferences();
    if (preferences.browser.enabled === false) {
      throw new Error("Browser Use 已关闭。请在设置 → 浏览器中开启。");
    }
    const targetUrl = normalizeBrowserPreviewUrl(
      typeof url === "string" && url.trim() ? url : preferences.browser.previewUrl
    );
    if (resolveBrowserLinkOpenTarget(preferences.browser, targetUrl) === "system") {
      const openExternal = this.dependencies.openExternal;
      if (!openExternal) {
        throw new Error("System browser open is unavailable in this runtime.");
      }
      await openExternal(targetUrl);
      await this.dependencies.saveThreadState(`Opened system browser: ${targetUrl}`);
      await this.dependencies.appendDiagnostics(`opened system browser ${targetUrl}`);
      return { ok: true, url: targetUrl };
    }
    await this.dependencies.openWindow(targetUrl);
    await this.dependencies.saveThreadState(`Opened browser preview: ${targetUrl}`);
    await this.dependencies.appendDiagnostics(`opened preview ${targetUrl}`);
    return { ok: true, url: targetUrl };
  }

  close() {
    this.dependencies.closeWindow();
    return { ok: true };
  }

  capture() {
    return this.dependencies.captureWindow();
  }
}
