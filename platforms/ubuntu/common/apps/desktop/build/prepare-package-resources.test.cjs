const assert = require("node:assert/strict");
const test = require("node:test");
const { sanitizeConfig } = require("./prepare-package-resources.cjs");

test("removes credentials and machine-specific preferences from packaged config", () => {
  const input = {
    llm: { provider: "openai", apiKey: "sk-secret", baseUrl: "https://example.test/v1" },
    preferences: {
      worktree: { rootDir: "/Users/example/private-worktrees", keepArchived: true },
      environment: { terminalShell: "/bin/bash", extraEnv: { TOKEN: "secret", SAFE: "value" } },
      popup: { shortcut: "CommandOrControl+Shift+Space", defaultProjectlessChat: true },
      dictation: {
        holdShortcut: "Option+Space",
        toggleShortcut: "Command+Space",
        dictionaryEntries: [{ timestamp: "2026-01-01T00:00:00.000Z", phrase: "private phrase" }]
      },
      shortcuts: { settings: "Command+," }
    },
    mcpServers: [{ id: "private", env: { API_KEY: "secret" } }],
    mcpDiscoveredTools: [{ id: "private-tool" }]
  };

  const sanitized = sanitizeConfig(input);

  assert.equal(sanitized.llm.apiKey, "");
  assert.equal(sanitized.llm.baseUrl, "https://example.test/v1");
  assert.equal(sanitized.preferences.worktree.rootDir, "");
  assert.equal(sanitized.preferences.worktree.keepArchived, true);
  assert.deepEqual(sanitized.preferences.environment.extraEnv, {});
  assert.equal(sanitized.preferences.environment.terminalShell, "/bin/bash");
  assert.equal(sanitized.preferences.popup.shortcut, "");
  assert.equal(sanitized.preferences.popup.defaultProjectlessChat, true);
  assert.equal(sanitized.preferences.dictation.holdShortcut, "");
  assert.equal(sanitized.preferences.dictation.toggleShortcut, "");
  assert.deepEqual(sanitized.preferences.dictation.dictionaryEntries, []);
  assert.deepEqual(sanitized.preferences.shortcuts, {});
  assert.deepEqual(sanitized.mcpServers, []);
  assert.deepEqual(sanitized.mcpDiscoveredTools, []);
  assert.equal(input.llm.apiKey, "sk-secret", "sanitization must not mutate the source config");
});

test("handles sparse config objects", () => {
  assert.deepEqual(sanitizeConfig({ llm: { apiKey: "secret" } }), { llm: { apiKey: "" } });
  assert.deepEqual(sanitizeConfig({}), {});
});
