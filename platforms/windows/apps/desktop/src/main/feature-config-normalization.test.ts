import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

const { normalizeFeatureConfig } = await import(new URL("./feature-config-normalization.ts", import.meta.url).href);
const automationPolicy = await import(new URL("./automation-schedule-policy.ts", import.meta.url).href);

const defaults = { skills: [], plugins: [], automations: [], runtime: { rustCoreTools: "disabled" as const } };
const context = { defaults, workspaceStateRoot: resolve("state"), workspacePath: resolve("workspace"), isPackaged: true };

test("normalizes feature skill status", () => {
  const result = normalizeFeatureConfig({ skills: [{ id: "skill", name: "Skill", status: "unexpected" }] }, context);
  assert.equal(result.skills[0]?.status, "enabled");
});

test("filters non-portable packaged plugin paths", () => {
  const result = normalizeFeatureConfig({ plugins: [{
    id: "plugin", name: "Plugin", summary: "", version: "1", status: "enabled",
    source: resolve("outside", "plugin"), manifestPath: resolve("outside", "plugin.json"),
    capabilities: [], skillRoots: [], mcpServerIds: []
  }] }, context);
  assert.deepEqual(result.plugins, []);
});

test("keeps repository plugin virtual paths in packaged installs", () => {
  const result = normalizeFeatureConfig({ plugins: [{
    id: "repository:game-studio", name: "Game Studio", summary: "", version: "1.0.0", status: "enabled",
    source: "repository://packages/game-studio/1.0.0",
    manifestPath: "repository://packages/game-studio/1.0.0/.codex-plugin/plugin.json",
    capabilities: ["skills"], skillRoots: ["repository://packages/game-studio/1.0.0/skills"], mcpServerIds: []
  }] }, context);
  assert.equal(result.plugins[0]?.id, "repository:game-studio");
  assert.equal(result.plugins[0]?.skillRoots?.[0], "repository://packages/game-studio/1.0.0/skills");
});

test("keeps packaged builtin plugin contribution paths", () => {
  const result = normalizeFeatureConfig({ plugins: [{
    id: "plugin-pdf", name: "PDF", summary: "PDF", status: "enabled",
    source: "builtin:pdf", manifestPath: "builtin:pdf/.codex-plugin/plugin.json",
    capabilities: ["pdf"], skillRoots: [], mcpServerIds: []
  }] }, { defaults, workspaceStateRoot: resolve("state"), workspacePath: resolve("workspace"), isPackaged: true });
  assert.equal(result.plugins[0]?.source, "builtin:pdf");
});

test("removes legacy Codex error-remediation features from NewBrain configuration", () => {
  const result = normalizeFeatureConfig({
    skills: [
      { id: "skill-error-auto-remediation", name: "error-auto-remediation", status: "enabled" },
      { id: "skill-keep", name: "Keep", status: "enabled" }
    ],
    automations: [
      { id: "automation-error-remediation", title: "NewBrain 每日异常自动修复", status: "scheduled", trigger: "daily" },
      { id: "automation-keep", title: "Keep", status: "idle", trigger: "manual" }
    ]
  }, context);

  assert.deepEqual(result.skills.map((item: { id: string }) => item.id), ["skill-keep"]);
  assert.deepEqual(result.automations.map((item: { id: string }) => item.id), ["automation-keep"]);
});

test("keeps Rust Core tools disabled unless an administrator selects a supported mode", () => {
  assert.equal(normalizeFeatureConfig({}, context).runtime.rustCoreTools, "disabled");
  assert.equal(normalizeFeatureConfig({ runtime: { rustCoreTools: "read" } }, context).runtime.rustCoreTools, "read");
  assert.equal(normalizeFeatureConfig({ runtime: { rustCoreTools: "read-write" } }, context).runtime.rustCoreTools, "read-write");
  assert.equal(normalizeFeatureConfig({ runtime: { rustCoreTools: "unsafe" as never } }, context).runtime.rustCoreTools, "disabled");
});

test("selects only due scheduled automation work", () => {
  const now = Date.parse("2026-07-17T08:00:00.000Z");
  const due = automationPolicy.selectDueAutomations([
    { id: "due", title: "Due", status: "scheduled", trigger: "interval", intervalMinutes: 5, nextRunAt: "2026-07-17T07:59:00.000Z" },
    { id: "future", title: "Future", status: "scheduled", trigger: "interval", intervalMinutes: 5, nextRunAt: "2026-07-17T08:01:00.000Z" },
    { id: "paused", title: "Paused", status: "paused", trigger: "interval", intervalMinutes: 5, nextRunAt: "2026-07-17T07:59:00.000Z" }
  ], now);
  assert.deepEqual(due.map((item: { id: string }) => item.id), ["due"]);
});

test("applies automation success and bounded failure backoff", () => {
  const now = Date.parse("2026-07-17T08:00:00.000Z");
  const items = [{ id: "job", title: "Job", status: "scheduled", trigger: "interval", intervalMinutes: 10, failureCount: 1 }];
  const success = automationPolicy.markAutomationSucceeded(items, "job", "started", now)[0];
  assert.equal(success.nextRunAt, "2026-07-17T08:10:00.000Z");
  assert.equal(success.failureCount, 0);
  const retry = automationPolicy.markAutomationFailed(items, "job", new Error("failed"), now)[0];
  assert.equal(retry.status, "scheduled");
  assert.equal(retry.nextRunAt, "2026-07-17T08:10:00.000Z");
  const paused = automationPolicy.markAutomationFailed([{ ...items[0], failureCount: 2 }], "job", "failed", now)[0];
  assert.equal(paused.status, "paused");
  assert.equal(paused.nextRunAt, undefined);
});

test("creates and updates automation configuration through one lifecycle policy", () => {
  const now = Date.parse("2026-07-17T08:00:00.000Z");
  const created = automationPolicy.createAutomationSpec({
    id: " job ", title: " Build ", status: "scheduled", trigger: " interval ", intervalMinutes: "15",
    action: "git_status"
  }, { makeId: () => "generated", activeWorkspaceId: "workspace", activeThreadId: "thread", nowMs: now });
  assert.deepEqual({ id: created.id, title: created.title, workspaceId: created.workspaceId, action: created.action }, {
    id: "job", title: "Build", workspaceId: "workspace", action: "git_status"
  });
  assert.equal(created.nextRunAt, "2026-07-17T08:15:00.000Z");
  const paused = automationPolicy.updateAutomationSpec(created, { status: "paused", intervalMinutes: "invalid" }, now);
  assert.equal(paused.intervalMinutes, 15);
  assert.equal(paused.nextRunAt, undefined);
});

test("schedules the error remediation automation for the next local 19:00", () => {
  const before = new Date(2026, 6, 22, 18, 30, 0).getTime();
  const after = new Date(automationPolicy.computeNextDailyRunAt("19:00", before));
  assert.equal(after.getHours(), 19);
  assert.equal(after.getDate(), 22);
  const late = new Date(automationPolicy.computeNextDailyRunAt("19:00", new Date(2026, 6, 22, 19, 30).getTime()));
  assert.equal(late.getDate(), 23);
  assert.equal(late.getHours(), 19);
  const due = automationPolicy.selectDueAutomations([{
    id: "error-remediation", title: "Error remediation", status: "scheduled", trigger: "daily",
    action: "error_remediation", dailyTime: "19:00", nextRunAt: new Date(before - 1).toISOString()
  }], before);
  assert.equal(due.length, 1);
});
