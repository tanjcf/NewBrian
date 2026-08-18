import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./SettingsWorkspace.tsx", import.meta.url), "utf8");
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
    "question: !current.notifications?.question"
  ];

  for (const snippet of requiredSnippets) {
    assert.ok(generalSettingsSource.includes(snippet), `missing persisted setting snippet: ${snippet}`);
  }
});

test("general settings source remains UTF-8 clean", () => {
  assert.equal(source.includes("\uFFFD"), false);
  assert.equal(source.includes("???"), false);
});
