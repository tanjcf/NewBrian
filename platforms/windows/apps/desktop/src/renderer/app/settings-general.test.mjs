import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const settingsWorkspacePath = [
  join(here, "SettingsWorkspace.tsx"),
  join(here, "../../../../../../../shared/apps/desktop/src/renderer/app/SettingsWorkspace.tsx")
].find((candidate) => existsSync(candidate));
if (!settingsWorkspacePath) {
  throw new Error("SettingsWorkspace.tsx was not found beside the test or in shared/");
}
const source = readFileSync(settingsWorkspacePath, "utf8");
const modelStart = source.indexOf('activeSettingsSection === "model"');
const modelEnd = source.indexOf(') : activeSettingsSection === "mcp"', modelStart);
const generalSettingsSource = source.slice(modelStart, modelEnd);

test("general settings page has no decorative-only controls", () => {
  assert.equal(/<button[^>]+className="codex-pill-select"/.test(generalSettingsSource), false);
  assert.equal(/<SettingsSwitch enabled=\{false\}/.test(generalSettingsSource), false);
  assert.equal(/<SettingsSwitch enabled\s*\/>/.test(generalSettingsSource), false);
  assert.equal(/className="active">排队/.test(generalSettingsSource), false);
});

test("general settings controls are wired to persisted desktop preferences", () => {
  const requiredSnippets = [
    'workMode: "coding"',
    'workMode: "everyday"',
    "configuration: { ...current.configuration, requireApprovalForShell: true }",
    "configuration: { ...current.configuration, requireApprovalForShell: false }",
    "requireApprovalForShell: !fullAccess",
    "reviewFindingsFirst: !current.personalization.reviewFindingsFirst",
    "const fullAccess = !desktopPreferences.permissions?.fullAccess",
    "fullAccess }",
    "defaultOpenTarget: event.target.value",
    "terminalShell: event.target.value",
    "language: event.target.value",
    "proactiveUpdates: !current.personalization.proactiveUpdates",
    "sendShortcut: event.target.value",
    'followBehavior: "queue"',
    'followBehavior: "guide"',
    "shortcut }",
    "const defaultProjectlessChat = !desktopPreferences.popup?.defaultProjectlessChat",
    "popup: { ...(current.popup || { shortcut: \"\" }), defaultProjectlessChat }",
    "microphone: event.target.value",
    "holdShortcut }",
    "toggleShortcut }",
    "const keepBarVisible = !desktopPreferences.dictation?.keepBarVisible",
    "dictation: { ...(current.dictation || {}), keepBarVisible }",
    "dictionaryOpen: current.dictation?.dictionaryOpen === false",
    "writeClipboard(String(entry.phrase || \"\"))",
    "turnComplete: event.target.value",
    "permission: !current.notifications?.permission",
    "question: !current.notifications?.question",
    "launchAtLogin: current.launchAtLogin === false",
    "开机自启动"
  ];

  for (const snippet of requiredSnippets) {
    assert.ok(generalSettingsSource.includes(snippet), `missing persisted setting snippet: ${snippet}`);
  }
});

test("general settings source remains UTF-8 clean", () => {
  assert.equal(source.includes("\uFFFD"), false);
  assert.equal(source.includes("???"), false);
});
