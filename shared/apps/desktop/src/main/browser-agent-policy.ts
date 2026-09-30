/**
 * NewBrain Browser Use agent permission policy (Codex-aligned).
 * Resolves browse / download / upload decisions per origin.
 */

export type BrowserAgentAction = "browse" | "download" | "upload";
export type BrowserAgentPermissionMode = "require_approval" | "always_allow" | "deny";
export type BrowserHistoryAccessMode = "always_ask" | "allow" | "deny";
export type BrowserAnnotatedScreenshotsMode = "always" | "ask" | "never";
export type BrowserLinkOpenTarget = "in-app-browser" | "system";

export interface BrowserAgentPermissionException {
  origin: string;
  browse: BrowserAgentPermissionMode;
  download: BrowserAgentPermissionMode;
  upload: BrowserAgentPermissionMode;
}

export interface BrowserAgentPermissionDefaults {
  browse: BrowserAgentPermissionMode;
  download: BrowserAgentPermissionMode;
  upload: BrowserAgentPermissionMode;
}

export interface BrowserUsePreferences {
  enabled: boolean;
  autoOpenPreview: boolean;
  preserveTabs: boolean;
  highResScreenshots: boolean;
  previewUrl: string;
  openWebLinksIn: BrowserLinkOpenTarget;
  openLocalLinksIn: BrowserLinkOpenTarget;
  showFullUrl: boolean;
  annotatedScreenshots: BrowserAnnotatedScreenshotsMode;
  downloadDir: string;
  askDownloadPath: boolean;
  historyAccess: BrowserHistoryAccessMode;
  siteToolsEnabled: boolean;
  agentPermissions: {
    defaults: BrowserAgentPermissionDefaults;
    exceptions: BrowserAgentPermissionException[];
  };
  fullCdpAccess: boolean;
}

export const DEFAULT_BROWSER_USE_PREFERENCES: Omit<
  BrowserUsePreferences,
  "autoOpenPreview" | "preserveTabs" | "highResScreenshots" | "previewUrl"
> = {
  enabled: true,
  openWebLinksIn: "in-app-browser",
  openLocalLinksIn: "in-app-browser",
  showFullUrl: false,
  annotatedScreenshots: "always",
  downloadDir: "",
  askDownloadPath: false,
  historyAccess: "always_ask",
  siteToolsEnabled: true,
  agentPermissions: {
    defaults: {
      browse: "require_approval",
      download: "require_approval",
      upload: "require_approval"
    },
    exceptions: [
      {
        origin: "http://127.0.0.1:8765",
        browse: "always_allow",
        download: "require_approval",
        upload: "require_approval"
      },
      {
        origin: "http://localhost:8765",
        browse: "always_allow",
        download: "require_approval",
        upload: "require_approval"
      }
    ]
  },
  fullCdpAccess: false
};

const PERMISSION_MODES = new Set<BrowserAgentPermissionMode>([
  "require_approval",
  "always_allow",
  "deny"
]);

export function isBrowserAgentPermissionMode(value: unknown): value is BrowserAgentPermissionMode {
  return typeof value === "string" && PERMISSION_MODES.has(value as BrowserAgentPermissionMode);
}

/** Normalize an origin string to protocol://host[:port] (lowercase host). */
export function normalizeBrowserOrigin(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${host}${port}`;
  } catch {
    return "";
  }
}

/** Extract origin from a full URL; empty when invalid. */
export function browserOriginFromUrl(url: unknown): string {
  try {
    const parsed = new URL(String(url ?? "").trim());
    return normalizeBrowserOrigin(parsed.origin);
  } catch {
    return "";
  }
}

export function resolveBrowserAgentPermissionMode(
  preferences: Pick<BrowserUsePreferences, "enabled" | "agentPermissions">,
  origin: string,
  action: BrowserAgentAction
): BrowserAgentPermissionMode {
  if (!preferences.enabled) return "deny";
  const normalized = normalizeBrowserOrigin(origin);
  const exceptions = preferences.agentPermissions?.exceptions ?? [];
  const hit = exceptions.find((item) => normalizeBrowserOrigin(item.origin) === normalized);
  if (hit && isBrowserAgentPermissionMode(hit[action])) {
    return hit[action];
  }
  const defaults = preferences.agentPermissions?.defaults;
  const fallback = defaults?.[action];
  return isBrowserAgentPermissionMode(fallback) ? fallback : "require_approval";
}

export function browserAgentActionRequiresApproval(
  preferences: Pick<BrowserUsePreferences, "enabled" | "agentPermissions">,
  origin: string,
  action: BrowserAgentAction
): boolean {
  return resolveBrowserAgentPermissionMode(preferences, origin, action) === "require_approval";
}

export function assertBrowserAgentPermission(
  preferences: Pick<BrowserUsePreferences, "enabled" | "agentPermissions">,
  origin: string,
  action: BrowserAgentAction
): void {
  const mode = resolveBrowserAgentPermissionMode(preferences, origin, action);
  if (!preferences.enabled) {
    throw new Error("Browser Use 已关闭。请在设置 → 浏览器中开启。");
  }
  if (mode === "deny") {
    throw new Error(`Browser Use 拒绝 ${action}：${normalizeBrowserOrigin(origin) || origin || "(unknown)"}`);
  }
}

export function normalizeBrowserAgentPermissionException(
  input: unknown,
  fallback: BrowserAgentPermissionException
): BrowserAgentPermissionException | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const origin = normalizeBrowserOrigin(row.origin);
  if (!origin) return null;
  return {
    origin,
    browse: isBrowserAgentPermissionMode(row.browse) ? row.browse : fallback.browse,
    download: isBrowserAgentPermissionMode(row.download) ? row.download : fallback.download,
    upload: isBrowserAgentPermissionMode(row.upload) ? row.upload : fallback.upload
  };
}

export function normalizeBrowserUsePreferencesPartial(
  input: Partial<BrowserUsePreferences> | undefined,
  defaults: BrowserUsePreferences
): BrowserUsePreferences {
  const defaultExceptionFallback: BrowserAgentPermissionException = {
    origin: "http://127.0.0.1:8765",
    browse: "always_allow",
    download: "require_approval",
    upload: "require_approval"
  };
  const rawExceptions = Array.isArray(input?.agentPermissions?.exceptions)
    ? input.agentPermissions.exceptions
    : defaults.agentPermissions.exceptions;
  const exceptions = rawExceptions
    .map((item) => normalizeBrowserAgentPermissionException(item, defaultExceptionFallback))
    .filter((item): item is BrowserAgentPermissionException => Boolean(item));

  const linkTarget = (value: unknown, fallback: BrowserLinkOpenTarget): BrowserLinkOpenTarget =>
    value === "system" || value === "in-app-browser" ? value : fallback;

  const annotated = (value: unknown, fallback: BrowserAnnotatedScreenshotsMode): BrowserAnnotatedScreenshotsMode =>
    value === "always" || value === "ask" || value === "never" ? value : fallback;

  const history = (value: unknown, fallback: BrowserHistoryAccessMode): BrowserHistoryAccessMode =>
    value === "always_ask" || value === "allow" || value === "deny" ? value : fallback;

  const defaultsBlock = input?.agentPermissions?.defaults;
  return {
    enabled: typeof input?.enabled === "boolean" ? input.enabled : defaults.enabled,
    autoOpenPreview:
      typeof input?.autoOpenPreview === "boolean" ? input.autoOpenPreview : defaults.autoOpenPreview,
    preserveTabs: typeof input?.preserveTabs === "boolean" ? input.preserveTabs : defaults.preserveTabs,
    highResScreenshots:
      typeof input?.highResScreenshots === "boolean"
        ? input.highResScreenshots
        : defaults.highResScreenshots,
    previewUrl: input?.previewUrl?.trim() || defaults.previewUrl,
    openWebLinksIn: linkTarget(input?.openWebLinksIn, defaults.openWebLinksIn),
    openLocalLinksIn: linkTarget(input?.openLocalLinksIn, defaults.openLocalLinksIn),
    showFullUrl: typeof input?.showFullUrl === "boolean" ? input.showFullUrl : defaults.showFullUrl,
    annotatedScreenshots: annotated(input?.annotatedScreenshots, defaults.annotatedScreenshots),
    downloadDir: typeof input?.downloadDir === "string" ? input.downloadDir.trim() : defaults.downloadDir,
    askDownloadPath:
      typeof input?.askDownloadPath === "boolean" ? input.askDownloadPath : defaults.askDownloadPath,
    historyAccess: history(input?.historyAccess, defaults.historyAccess),
    siteToolsEnabled:
      typeof input?.siteToolsEnabled === "boolean" ? input.siteToolsEnabled : defaults.siteToolsEnabled,
    agentPermissions: {
      defaults: {
        browse: isBrowserAgentPermissionMode(defaultsBlock?.browse)
          ? defaultsBlock.browse
          : defaults.agentPermissions.defaults.browse,
        download: isBrowserAgentPermissionMode(defaultsBlock?.download)
          ? defaultsBlock.download
          : defaults.agentPermissions.defaults.download,
        upload: isBrowserAgentPermissionMode(defaultsBlock?.upload)
          ? defaultsBlock.upload
          : defaults.agentPermissions.defaults.upload
      },
      exceptions
    },
    fullCdpAccess: typeof input?.fullCdpAccess === "boolean" ? input.fullCdpAccess : defaults.fullCdpAccess
  };
}

/** Whether a URL should prefer the in-app browser based on host locality. */
export function resolveBrowserLinkOpenTarget(
  preferences: Pick<BrowserUsePreferences, "openWebLinksIn" | "openLocalLinksIn">,
  url: string
): BrowserLinkOpenTarget {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
    return local ? preferences.openLocalLinksIn : preferences.openWebLinksIn;
  } catch {
    return preferences.openWebLinksIn;
  }
}

function browserToolAction(toolName: string): BrowserAgentAction | null {
  const name = String(toolName || "").trim();
  if (!name.startsWith("browser.")) return null;
  if (name.includes("download")) return "download";
  if (name.includes("upload")) return "upload";
  return "browse";
}

/**
 * Map browser.* tool calls onto agent permission decisions for the policy engine.
 * Returns null when the tool is not a Browser Use tool.
 */
export function evaluateBrowserToolPolicyDecision(
  preferences: Pick<BrowserUsePreferences, "enabled" | "agentPermissions">,
  toolName: string,
  argumentsValue: Record<string, unknown> = {},
  currentUrl = ""
): { decision: "allow" | "ask" | "deny"; source: string; reason: string; ruleId: string } | null {
  const action = browserToolAction(toolName);
  if (!action) return null;
  const origin =
    browserOriginFromUrl(argumentsValue.url) ||
    browserOriginFromUrl(currentUrl) ||
    normalizeBrowserOrigin(argumentsValue.origin);
  const mode = resolveBrowserAgentPermissionMode(preferences, origin, action);
  if (!preferences.enabled || mode === "deny") {
    return {
      decision: "deny",
      source: "browser-agent-policy",
      ruleId: ":browser-deny",
      reason: preferences.enabled
        ? `Browser Use denies ${action} for ${origin || "(unknown)"}`
        : "Browser Use is disabled."
    };
  }
  if (mode === "always_allow") {
    return {
      decision: "allow",
      source: "browser-agent-policy",
      ruleId: ":browser-always-allow",
      reason: `Browser Use always allows ${action} for ${origin || "(unknown)"}`
    };
  }
  return {
    decision: "ask",
    source: "browser-agent-policy",
    ruleId: ":browser-require-approval",
    reason: `Browser Use requires approval to ${action} ${origin || "(unknown)"}`
  };
}
