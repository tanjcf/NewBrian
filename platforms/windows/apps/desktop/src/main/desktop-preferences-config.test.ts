import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

const { createDefaultDesktopPreferences, normalizeDesktopPreferencesValue } =
  await import(new URL("./desktop-preferences-config.ts", import.meta.url).href);

test("reconstructs desktop preference defaults", () => {
  const workspaceStateRoot = resolve("test-state");
  const defaults = createDefaultDesktopPreferences(workspaceStateRoot, {});
  assert.equal(defaults.personalization.autoSkillEnabled, false);
  assert.deepEqual(normalizeDesktopPreferencesValue(undefined, {
    defaults, workspaceStateRoot, isPackaged: false
  }), defaults);
});

test("defaults autoSkillEnabled to false when the preference is omitted", () => {
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
  assert.equal(normalized.personalization.autoSkillEnabled, false);
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
