import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

const { createDefaultDesktopPreferences, normalizeDesktopPreferencesValue } =
  await import(new URL("./desktop-preferences-config.ts", import.meta.url).href);

test("launch at login defaults to enabled when the preference is omitted", () => {
  const workspaceStateRoot = resolve("test-state");
  const defaults = createDefaultDesktopPreferences(workspaceStateRoot, {});
  assert.equal(defaults.launchAtLogin, true);
  const normalized = normalizeDesktopPreferencesValue(undefined, {
    defaults,
    workspaceStateRoot,
    isPackaged: false
  });
  assert.equal(normalized.launchAtLogin, true);
  const explicitOff = normalizeDesktopPreferencesValue({ launchAtLogin: false } as never, {
    defaults,
    workspaceStateRoot,
    isPackaged: true
  });
  assert.equal(explicitOff.launchAtLogin, false);
});
