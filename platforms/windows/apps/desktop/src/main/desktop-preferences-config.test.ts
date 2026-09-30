import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

const { createDefaultDesktopPreferences, normalizeDesktopPreferencesValue } =
  await import(new URL("./desktop-preferences-config.ts", import.meta.url).href);

test("launch at login defaults to enabled and keeps an explicit off value", () => {
  const workspaceStateRoot = resolve("test-state");
  const defaults = createDefaultDesktopPreferences(workspaceStateRoot, {});
  assert.equal(defaults.launchAtLogin, true);
  const omitted = normalizeDesktopPreferencesValue(undefined, {
    defaults, workspaceStateRoot, isPackaged: false
  });
  assert.equal(omitted.launchAtLogin, true);
  const disabled = normalizeDesktopPreferencesValue({ launchAtLogin: false } as never, {
    defaults, workspaceStateRoot, isPackaged: true
  });
  assert.equal(disabled.launchAtLogin, false);
});

test("reconstructs desktop preference defaults", () => {
  const workspaceStateRoot = resolve("test-state");
  const defaults = createDefaultDesktopPreferences(workspaceStateRoot, {});
  assert.equal(defaults.personalization.autoSkillEnabled, true);
  assert.deepEqual(normalizeDesktopPreferencesValue(undefined, {
    defaults, workspaceStateRoot, isPackaged: false
  }), defaults);
});

test("defaults autoSkillEnabled to true when the preference is omitted", () => {
  const workspaceStateRoot = resolve("test-state");
  const defaults = createDefaultDesktopPreferences(workspaceStateRoot, {});
  const normalized = normalizeDesktopPreferencesValue({
    personalization: {
      workMode: "coding",
      proactiveUpdates: true,
      includeVerificationSummary: true,
      reviewFindingsFirst: true
    } as never
  }, { defaults, workspaceStateRoot, isPackaged: false });
  assert.equal(normalized.personalization.autoSkillEnabled, true);
});

test("defaults market.directClawhubAllowed to true (desktop ClawHub direct)", () => {
  const workspaceStateRoot = resolve("test-state");
  const defaults = createDefaultDesktopPreferences(workspaceStateRoot, {});
  assert.equal(defaults.market.directClawhubAllowed, true);
  const normalized = normalizeDesktopPreferencesValue({} as never, {
    defaults,
    workspaceStateRoot,
    isPackaged: false
  });
  assert.equal(normalized.market.directClawhubAllowed, true);
  const closed = normalizeDesktopPreferencesValue({
    market: { directClawhubAllowed: false }
  } as never, {
    defaults,
    workspaceStateRoot,
    isPackaged: false
  });
  assert.equal(closed.market.directClawhubAllowed, false);
});

test("keeps last brain scene workspace key when present and leaves it unset by default", () => {
  const workspaceStateRoot = resolve("test-state");
  const defaults = createDefaultDesktopPreferences(workspaceStateRoot, {});
  assert.equal(defaults.brain.selectedWorkspaceKey, "");
  const normalized = normalizeDesktopPreferencesValue({
    brain: { selectedWorkspaceKey: "quant" }
  } as never, { defaults, workspaceStateRoot, isPackaged: false });
  assert.equal(normalized.brain.selectedWorkspaceKey, "quant");
  const invalid = normalizeDesktopPreferencesValue({
    brain: { selectedWorkspaceKey: "not-a-scene" }
  } as never, { defaults, workspaceStateRoot, isPackaged: false });
  assert.equal(invalid.brain.selectedWorkspaceKey, "");
});

test("browser preferences normalize missing fields to safe Browser Use defaults", () => {
  const workspaceStateRoot = resolve("test-state");
  const defaults = createDefaultDesktopPreferences(workspaceStateRoot, {});
  assert.equal(defaults.browser.enabled, true);
  assert.equal(defaults.browser.agentPermissions.defaults.browse, "require_approval");
  assert.equal(defaults.browser.fullCdpAccess, false);
  const legacy = normalizeDesktopPreferencesValue({
    browser: {
      autoOpenPreview: true,
      preserveTabs: false,
      highResScreenshots: true,
      previewUrl: "http://127.0.0.1:5173"
    }
  } as never, { defaults, workspaceStateRoot, isPackaged: false });
  assert.equal(legacy.browser.enabled, true);
  assert.equal(legacy.browser.openWebLinksIn, "in-app-browser");
  assert.equal(legacy.browser.agentPermissions.defaults.browse, "require_approval");
  assert.equal(legacy.browser.fullCdpAccess, false);
  assert.ok(
    legacy.browser.agentPermissions.exceptions.some((row) => row.origin === "http://127.0.0.1:8765")
  );
  const denied = normalizeDesktopPreferencesValue({
    browser: {
      ...defaults.browser,
      enabled: false,
      agentPermissions: {
        defaults: { browse: "deny", download: "deny", upload: "deny" },
        exceptions: [{ origin: "https://trusted.example", browse: "always_allow", download: "deny", upload: "deny" }]
      }
    }
  } as never, { defaults, workspaceStateRoot, isPackaged: false });
  assert.equal(denied.browser.enabled, false);
  assert.equal(denied.browser.agentPermissions.defaults.browse, "deny");
  assert.equal(denied.browser.agentPermissions.exceptions[0]?.origin, "https://trusted.example");
});
