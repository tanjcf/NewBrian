import assert from "node:assert/strict";
import test from "node:test";

const policy = await import(new URL("./desktop-device-policy.ts", import.meta.url).href);
const device = {
  device_id: "device-1", device_name: "workstation", device_type: "desktop",
  os_name: "win32", os_version: "11", app_version: "1.0.0",
  mac_id: "mac-hash", motherboard_id: "board-hash", disk_id: "disk-hash"
};

test("hashes hardware identifiers without exposing raw values", () => {
  const token = policy.createSafeMachineToken(" raw-mac ", "machine-guid");
  assert.equal(token.length, 48);
  assert.match(token, /^[a-f0-9]+$/);
  assert.equal(token.includes("raw-mac"), false);
  assert.equal(policy.createSafeMachineToken("", undefined), "");
  assert.equal(token, policy.createSafeMachineToken("raw-mac", "machine-guid"));
});

test("builds bounded desktop identity headers and trims bearer credentials", () => {
  const headers = policy.createDesktopAuthHeaders({
    accessToken: " secret-token ", device, createRequestId: () => "request-fixed"
  });
  assert.equal(headers.Authorization, "Bearer secret-token");
  assert.equal(headers["X-Request-Id"], "request-fixed");
  assert.equal(headers["X-Desktop-Device-Id"], "device-1");
  assert.equal(headers["X-Desktop-Disk-Id"], "disk-hash");
  assert.equal(headers["X-Desktop-Platform"], "windows");
});

test("maps Electron platforms onto release platform ids", () => {
  assert.equal(policy.mapDesktopReleasePlatform("win32"), "windows");
  assert.equal(policy.mapDesktopReleasePlatform("darwin"), "macos");
  assert.equal(policy.mapDesktopReleasePlatform("linux"), "linux");
});

test("omits authorization when no usable credential exists", () => {
  const headers = policy.createDesktopAuthHeaders({ accessToken: " ", device, createRequestId: () => "request-fixed" });
  assert.equal("Authorization" in headers, false);
});

test("selects the first external non-zero MAC address", () => {
  assert.equal(policy.resolvePrimaryMacAddress({
    loopback: [{ internal: true, mac: "00:00:00:00:00:00" }],
    ethernet: [{ internal: false, mac: "AA:BB:CC:DD:EE:FF" }]
  }), "aa-bb-cc-dd-ee-ff");
  assert.equal(policy.resolvePrimaryMacAddress({ empty: [] }), "");
});

test("builds a fingerprint while exposing only hashed hardware identifiers", () => {
  let stableInput: Record<string, string> | undefined;
  const fingerprint = policy.buildDesktopDeviceFingerprint({
    platform: "win32", platformLabel: "Windows", userDataPath: "C:/profile", workspacePath: "C:/workspace",
    hostname: "host-1", osVersion: "11", appVersion: "1.0", machineGuid: "raw-guid",
    primaryMac: "raw-mac", boardSerial: "raw-board", diskSerial: "raw-disk",
    buildStableDeviceId: (input: Record<string, string>) => { stableInput = input; return "stable-device"; }
  });
  assert.deepEqual(stableInput, { platform: "win32", userDataPath: "C:/profile", machineIdentifier: "raw-guid" });
  assert.equal(fingerprint.device_id, "stable-device");
  assert.equal(fingerprint.device_name, "host-1");
  assert.equal(fingerprint.mac_id.includes("raw"), false);
  assert.equal(fingerprint.motherboard_id.length, 48);
  assert.equal(fingerprint.disk_id.length, 48);
});
