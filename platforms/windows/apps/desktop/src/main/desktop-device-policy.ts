import { createHash, randomUUID } from "node:crypto";
import { resolveDesktopPackagePreference } from "./desktop-app-update-patch.ts";

export { resolveDesktopPackagePreference } from "./desktop-app-update-patch.ts";

export interface DesktopDeviceFingerprint {
  device_id: string;
  device_name: string;
  device_type: string;
  os_name: string;
  os_version: string;
  app_version: string;
  mac_id: string;
  motherboard_id: string;
  disk_id: string;
}

export function createSafeMachineToken(...values: Array<string | undefined>) {
  const source = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join("|");
  return source ? createHash("sha256").update(source).digest("hex").slice(0, 48) : "";
}

/** Map Electron/Node process.platform to release platform ids used by OmniRoute. */
export function mapDesktopReleasePlatform(platform: string | undefined | null): "windows" | "macos" | "linux" {
  const normalized = String(platform ?? "").trim().toLowerCase();
  if (normalized === "darwin" || normalized === "macos" || normalized === "osx" || normalized === "mac") {
    return "macos";
  }
  if (normalized === "linux") {
    return "linux";
  }
  return "windows";
}

function scoreNetworkInterfaceName(name: string) {
  const lower = String(name || "").toLowerCase();
  let score = 0;
  if (/ethernet|eth\d|en\d|局域网|本地连接|本地網路/.test(lower)) score += 40;
  if (/wi-?fi|wlan|wireless|无线|wlan\d|wl/.test(lower)) score += 25;
  if (/bluetooth|virtual|vethernet|hyper-v|vmware|virtualbox|docker|wsl|loopback|vpn|tap|tun|npcap|pseudo/.test(lower)) {
    score -= 60;
  }
  return score;
}

/**
 * Pick a stable primary MAC across WiFi/Ethernet churn.
 * Prefer physical adapters and break ties with a sorted MAC so Object.values order
 * changes (common after WiFi handoff) do not rotate device identity.
 */
export function resolvePrimaryMacAddress(
  interfaces: Record<string, Array<{ internal?: boolean; mac?: string } | null | undefined> | undefined>
) {
  const candidates: Array<{ mac: string; score: number }> = [];
  for (const [name, records] of Object.entries(interfaces ?? {})) {
    for (const record of records ?? []) {
      if (!record || record.internal || !record.mac || record.mac === "00:00:00:00:00:00") continue;
      const mac = record.mac.replace(/:/g, "-").toLowerCase();
      if (!mac || mac === "00-00-00-00-00-00") continue;
      candidates.push({ mac, score: scoreNetworkInterfaceName(name) });
    }
  }
  if (!candidates.length) return "";
  candidates.sort((left, right) => right.score - left.score || left.mac.localeCompare(right.mac));
  return candidates[0]!.mac;
}

export function isUsableDesktopDeviceFingerprint(value: unknown): value is DesktopDeviceFingerprint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ["device_id", "mac_id", "motherboard_id", "disk_id"]
    .every((key) => typeof record[key] === "string" && String(record[key]).trim().length > 0);
}

/**
 * Keep durable device identity fields across network changes; refresh soft fields only.
 * This prevents WiFi MAC churn from forcing desktop re-login.
 */
export function reusePersistedDesktopDeviceFingerprint(
  persisted: DesktopDeviceFingerprint,
  live: DesktopDeviceFingerprint
): DesktopDeviceFingerprint {
  return {
    ...persisted,
    device_name: live.device_name || persisted.device_name,
    device_type: live.device_type || persisted.device_type,
    os_name: live.os_name || persisted.os_name,
    os_version: live.os_version || persisted.os_version,
    app_version: live.app_version || persisted.app_version
  };
}

export function buildDesktopDeviceFingerprint(input: {
  platform: NodeJS.Platform;
  platformLabel: string;
  userDataPath: string;
  workspacePath: string;
  hostname: string;
  osVersion: string;
  appVersion: string;
  machineGuid?: string;
  primaryMac?: string;
  boardSerial?: string;
  diskSerial?: string;
  buildStableDeviceId: (input: { platform: string; userDataPath: string; machineIdentifier: string }) => string;
}): DesktopDeviceFingerprint {
  // Prefer durable machine identifiers; MAC is last-resort only for brand-new installs.
  const machineIdentifier = input.machineGuid || input.primaryMac || input.hostname;
  return {
    device_id: input.buildStableDeviceId({
      platform: input.platform,
      userDataPath: input.userDataPath,
      machineIdentifier
    }),
    device_name: input.hostname || `${input.platformLabel}-desktop`,
    device_type: "desktop",
    os_name: input.platform,
    os_version: input.osVersion,
    app_version: input.appVersion,
    mac_id: createSafeMachineToken(input.primaryMac, input.machineGuid || input.hostname),
    motherboard_id: createSafeMachineToken(input.boardSerial, input.machineGuid, input.hostname),
    disk_id: createSafeMachineToken(input.diskSerial, input.machineGuid, input.workspacePath)
  };
}

/**
 * Node/Electron fetch rejects header values outside ByteString (code points > 255).
 * Chinese Windows hostnames must be ASCII-folded before entering X-Desktop-* headers.
 */
export function sanitizeDesktopHeaderValue(value: string, fallback = "desktop") {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]+/g, "-")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[-\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim()
    .slice(0, 128);
  return normalized || fallback;
}

/**
 * Local gate before calling spring-app password login.
 * `email_code_login_enabled` must not force a captcha here — the server skips OTP for
 * previously seen MAC or IP, and only requires a code for brand-new environments.
 */
export function shouldRequireLoginCodeLocally(input: {
  passwordLoginEnabled: boolean;
  captcha: string;
  e2eBypass?: boolean;
}): boolean {
  if (input.e2eBypass) return false;
  if (input.captcha.trim()) return false;
  return !input.passwordLoginEnabled;
}

export function createDesktopAuthHeaders(input: {
  accessToken?: string;
  device: DesktopDeviceFingerprint;
  createRequestId?: () => string;
  platform?: string;
  /** Override; otherwise derived from executablePath / process.execPath. */
  packagePreference?: "msi" | "nsis";
  executablePath?: string;
}) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Desktop-Client": "newbrain",
    "X-Request-Id": sanitizeDesktopHeaderValue((input.createRequestId ?? randomUUID)(), "request"),
    "X-Desktop-Device-Id": sanitizeDesktopHeaderValue(input.device.device_id, "device"),
    "X-Desktop-Device-Name": sanitizeDesktopHeaderValue(input.device.device_name, "desktop"),
    "X-Desktop-Device-Type": sanitizeDesktopHeaderValue(input.device.device_type, "desktop"),
    "X-Desktop-OS-Name": sanitizeDesktopHeaderValue(input.device.os_name, "win32"),
    "X-Desktop-OS-Version": sanitizeDesktopHeaderValue(input.device.os_version, "unknown"),
    "X-Desktop-App-Version": sanitizeDesktopHeaderValue(input.device.app_version, "0"),
    "X-Desktop-Mac-Id": sanitizeDesktopHeaderValue(input.device.mac_id, "mac"),
    "X-Desktop-Motherboard-Id": sanitizeDesktopHeaderValue(input.device.motherboard_id, "board"),
    "X-Desktop-Disk-Id": sanitizeDesktopHeaderValue(input.device.disk_id, "disk"),
    "X-Desktop-Platform": mapDesktopReleasePlatform(input.platform ?? input.device.os_name)
  };
  if (input.accessToken?.trim()) headers.Authorization = `Bearer ${input.accessToken.trim()}`;
  // Match Spring dual MSI+NSIS offers to the running install layout.
  if (headers["X-Desktop-Platform"] === "windows") {
    headers["X-Desktop-Package-Preference"] =
      input.packagePreference
      || resolveDesktopPackagePreference(input.executablePath || process.execPath);
  }
  return headers;
}
