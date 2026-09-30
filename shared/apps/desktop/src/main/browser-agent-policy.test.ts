import assert from "node:assert/strict";
import test from "node:test";

const {
  DEFAULT_BROWSER_USE_PREFERENCES,
  assertBrowserAgentPermission,
  browserAgentActionRequiresApproval,
  browserOriginFromUrl,
  normalizeBrowserOrigin,
  normalizeBrowserUsePreferencesPartial,
  resolveBrowserAgentPermissionMode,
  resolveBrowserLinkOpenTarget,
  evaluateBrowserToolPolicyDecision
} = await import(new URL("./browser-agent-policy.ts", import.meta.url).href);

const basePrefs = {
  enabled: true,
  autoOpenPreview: false,
  preserveTabs: true,
  highResScreenshots: false,
  previewUrl: "http://127.0.0.1:3000",
  ...DEFAULT_BROWSER_USE_PREFERENCES
};

test("normalizeBrowserOrigin lowercases host and drops path", () => {
  assert.equal(normalizeBrowserOrigin("HTTPS://Example.COM:443/path"), "https://example.com");
  assert.equal(normalizeBrowserOrigin("http://127.0.0.1:8765/x"), "http://127.0.0.1:8765");
  assert.equal(normalizeBrowserOrigin("not a url"), "");
});

test("browserOriginFromUrl extracts origin", () => {
  assert.equal(browserOriginFromUrl("http://127.0.0.1:8765/dashboard"), "http://127.0.0.1:8765");
  assert.equal(browserOriginFromUrl(""), "");
});

test("default browse requires approval; 127.0.0.1:8765 exception always allows", () => {
  assert.equal(
    resolveBrowserAgentPermissionMode(basePrefs, "https://example.com", "browse"),
    "require_approval"
  );
  assert.equal(
    resolveBrowserAgentPermissionMode(basePrefs, "http://127.0.0.1:8765", "browse"),
    "always_allow"
  );
  assert.equal(
    browserAgentActionRequiresApproval(basePrefs, "http://127.0.0.1:8765/app", "browse"),
    false
  );
  assert.equal(
    browserAgentActionRequiresApproval(basePrefs, "https://evil.example", "browse"),
    true
  );
});

test("disabled browser denies all actions", () => {
  const disabled = { ...basePrefs, enabled: false };
  assert.equal(resolveBrowserAgentPermissionMode(disabled, "http://127.0.0.1:8765", "browse"), "deny");
  assert.throws(
    () => assertBrowserAgentPermission(disabled, "http://127.0.0.1:8765", "browse"),
    /已关闭/
  );
});

test("normalize fills missing fields with safe defaults", () => {
  const normalized = normalizeBrowserUsePreferencesPartial(
    {
      autoOpenPreview: true,
      previewUrl: "http://localhost:4000"
    } as never,
    basePrefs
  );
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.agentPermissions.defaults.browse, "require_approval");
  assert.equal(normalized.fullCdpAccess, false);
  assert.equal(normalized.historyAccess, "always_ask");
  assert.ok(normalized.agentPermissions.exceptions.some((row) => row.origin.includes("127.0.0.1")));
});

test("resolveBrowserLinkOpenTarget distinguishes local vs web", () => {
  const prefs = {
    openWebLinksIn: "system" as const,
    openLocalLinksIn: "in-app-browser" as const
  };
  assert.equal(resolveBrowserLinkOpenTarget(prefs, "https://example.com"), "system");
  assert.equal(resolveBrowserLinkOpenTarget(prefs, "http://127.0.0.1:3000"), "in-app-browser");
});

test("evaluateBrowserToolPolicyDecision asks by default and allows exception origin", () => {
  const ask = evaluateBrowserToolPolicyDecision(basePrefs, "browser.open", {
    url: "https://news.example"
  });
  assert.equal(ask?.decision, "ask");
  const allow = evaluateBrowserToolPolicyDecision(basePrefs, "browser.open", {
    url: "http://127.0.0.1:8765/ok"
  });
  assert.equal(allow?.decision, "allow");
  const deny = evaluateBrowserToolPolicyDecision(
    { ...basePrefs, enabled: false },
    "browser.read_page",
    {},
    "http://127.0.0.1:8765"
  );
  assert.equal(deny?.decision, "deny");
  assert.equal(evaluateBrowserToolPolicyDecision(basePrefs, "shell.exec", {}), null);
});
