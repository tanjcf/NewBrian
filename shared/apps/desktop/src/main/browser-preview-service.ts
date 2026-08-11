import type { DesktopPreferences } from "@codex-forge/protocol";

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
}

/** Coordinates browser preview lifecycle and its observable thread diagnostics. */
export class BrowserPreviewService {
  private readonly dependencies: BrowserPreviewServiceDependencies;

  constructor(dependencies: BrowserPreviewServiceDependencies) {
    this.dependencies = dependencies;
  }

  async open(url?: string) {
    const preferences = await this.dependencies.getPreferences();
    const targetUrl = normalizeBrowserPreviewUrl(
      typeof url === "string" && url.trim() ? url : preferences.browser.previewUrl
    );
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
