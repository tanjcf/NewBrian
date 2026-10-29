import assert from "node:assert/strict";
import test from "node:test";
import { applyLoginItemSettings, buildLoginItemSettings } from "./login-item-settings.ts";

test("packaged login item only toggles openAtLogin", () => {
  assert.deepEqual(buildLoginItemSettings({
    openAtLogin: true,
    platform: "win32",
    isPackaged: true,
    execPath: "C:\\Program Files\\NewBrain\\NewBrain.exe",
    appPath: "C:\\Program Files\\NewBrain\\resources\\app"
  }), { openAtLogin: true });
});

test("unpackaged Windows login item relaunches the dev app path", () => {
  assert.deepEqual(buildLoginItemSettings({
    openAtLogin: false,
    platform: "win32",
    isPackaged: false,
    execPath: "C:\\electron.exe",
    appPath: "I:\\BRAIN"
  }), {
    openAtLogin: false,
    path: "C:\\electron.exe",
    args: ["I:\\BRAIN"]
  });
});

test("non-windows login item stays on the platform default executable", () => {
  assert.deepEqual(buildLoginItemSettings({
    openAtLogin: true,
    platform: "darwin",
    isPackaged: false,
    execPath: "/electron",
    appPath: "/app"
  }), { openAtLogin: true });
});

test("applyLoginItemSettings forwards the built settings", () => {
  const calls: unknown[] = [];
  applyLoginItemSettings({
    isPackaged: true,
    getAppPath: () => "/unused",
    setLoginItemSettings: (settings) => calls.push(settings)
  }, true, "win32", "C:\\NewBrain.exe");
  assert.deepEqual(calls, [{ openAtLogin: true }]);
});
