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

export function createDesktopAuthHeaders(input: {
  accessToken?: string;
  device: DesktopDeviceFingerprint;
  createRequestId?: () => string;
  platform?: string;
}) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Desktop-Client": "codecn",
    "X-Request-Id": (input.createRequestId ?? randomUUID)(),
    "X-Desktop-Device-Id": input.device.device_id,
    "X-Desktop-Device-Name": input.device.device_name,
    "X-Desktop-Device-Type": input.device.device_type,
    "X-Desktop-OS-Name": input.device.os_name,
    "X-Desktop-OS-Version": input.device.os_version,
    "X-Desktop-App-Version": input.device.app_version,
    "X-Desktop-Mac-Id": input.device.mac_id,
    "X-Desktop-Motherboard-Id": input.device.motherboard_id,
    "X-Desktop-Disk-Id": input.device.disk_id,
    "X-Desktop-Platform": mapDesktopReleasePlatform(input.platform ?? input.device.os_name)
  };
  if (input.accessToken?.trim()) headers.Authorization = `Bearer ${input.accessToken.trim()}`;
  return headers;
}
