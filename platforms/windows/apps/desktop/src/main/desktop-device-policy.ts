import { createHash, randomUUID } from "node:crypto";

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

export function resolvePrimaryMacAddress(
  interfaces: Record<string, Array<{ internal?: boolean; mac?: string } | null | undefined> | undefined>
) {
  for (const records of Object.values(interfaces)) {
    for (const record of records ?? []) {
      if (!record || record.internal || !record.mac || record.mac === "00:00:00:00:00:00") continue;
      return record.mac.replace(/:/g, "-").toLowerCase();
    }
  }
  return "";
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

export function createDesktopAuthHeaders(input: {
  accessToken?: string;
  device: DesktopDeviceFingerprint;
  createRequestId?: () => string;
  platform?: string;
}) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Desktop-Client": "codecn",
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
  return headers;
}
