import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner loads this source file directly.
import { buildStableDesktopDeviceId } from "./desktop-device.ts";

test("desktop device identity remains stable for the same OS user and machine", () => {
  const input = {
    platform: "win32",
    userDataPath: "C:\\Users\\Example\\.newbrain",
    machineIdentifier: "machine-guid-123"
  };
  const first = buildStableDesktopDeviceId(input);
  assert.equal(buildStableDesktopDeviceId({ ...input }), first);
  assert.equal(first.length, 24);
});

test("desktop device identity changes for a different machine", () => {
  const common = { platform: "win32", userDataPath: "C:\\Users\\Example\\.newbrain" };
  const first = buildStableDesktopDeviceId({ ...common, machineIdentifier: "machine-guid-123" });
  const second = buildStableDesktopDeviceId({ ...common, machineIdentifier: "machine-guid-456" });
  assert.notEqual(second, first);
});
