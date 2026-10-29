/**
 * AUTOMATION-DEDICATED-THREAD-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * Creating an automation must bind a dedicated thread — never the UI/active selection.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  automationDedicatedThreadTitle,
  automationNeedsDedicatedThread
} from "./automation-dedicated-thread.ts";

export const CASE_ID = "AUTOMATION-DEDICATED-THREAD-SMOKE-001";

function brainSourceRoot() {
  const envRoot = String(process.env.NEWBRAIN_SOURCE_ROOT || "").trim();
  if (envRoot && existsSync(path.join(envRoot, "platforms", "windows"))) return envRoot;
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(path.join(current, "platforms", "windows")) && existsSync(path.join(current, "shared"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

function readFirst(candidates: string[]) {
  for (const filePath of candidates) {
    if (existsSync(filePath)) return readFileSync(filePath, "utf8");
  }
  throw new Error(`Missing source: ${candidates.join(" | ")}`);
}

test(`${CASE_ID} detects when a dedicated thread must be allocated`, () => {
  assert.equal(automationNeedsDedicatedThread({ workspaceId: "ws", threadId: "th" }), false);
  assert.equal(automationNeedsDedicatedThread({ workspaceId: "ws", threadId: "" }), true);
  assert.equal(automationNeedsDedicatedThread({ workspaceId: "", threadId: "th" }), true);
  assert.equal(automationDedicatedThreadTitle("每日巡检任务很长标题会被截断"), "每日巡检任务很长标题会被截断".slice(0, 36));
});

test(`${CASE_ID} createAutomationSpec never inherits active workspace/thread`, async () => {
  const root = brainSourceRoot();
  assert.ok(root, "BRAIN source root required");
  const policyPath = path.join(root, "platforms", "windows", "apps", "desktop", "src", "main", "automation-schedule-policy.ts");
  const policy = await import(new URL(`file:///${policyPath.replace(/\\/g, "/")}`).href) as {
    createAutomationSpec: (
      input: Record<string, string>,
      context: { makeId: () => string; activeWorkspaceId?: string; activeThreadId?: string }
    ) => { workspaceId?: string; threadId?: string };
  };
  const spec = policy.createAutomationSpec(
    { title: "巡检", trigger: "daily", status: "scheduled", intervalMinutes: "1440" },
    { makeId: () => "auto-1", activeWorkspaceId: "active-ws", activeThreadId: "active-thread" }
  );
  assert.equal(spec.workspaceId, undefined);
  assert.equal(spec.threadId, undefined);
});

test(`${CASE_ID} creation paths refuse selected/active thread binding`, () => {
  const root = brainSourceRoot();
  assert.ok(root, "BRAIN source root required");
  const workspace = readFileSync(new URL("../renderer/app/WorkspaceModules.tsx", import.meta.url), "utf8");
  const materialize = workspace.slice(
    workspace.indexOf("async function materializeCreatorFromChat"),
    workspace.indexOf("function submitComposerRequest")
  );
  assert.match(materialize, /workspaceId:\s*""/);
  assert.match(materialize, /threadId:\s*""/);
  assert.doesNotMatch(
    materialize,
    /workspaceId:\s*selectedWorkspace\?\.id/
  );
  assert.doesNotMatch(
    materialize,
    /threadId:\s*selectedThread\?\.id/
  );

  const main = readFirst([
    path.join(root, "platforms", "windows", "apps", "desktop", "src", "main", "index.ts"),
    path.join(process.cwd(), "src", "main", "index.ts")
  ]);
  const addFeature = main.slice(main.indexOf("async function addFeatureItem"), main.indexOf("async function updateFeatureItem"));
  assert.match(addFeature, /automationNeedsDedicatedThread/);
  assert.doesNotMatch(addFeature, /activeWorkspaceId,\s*\n\s*activeThreadId/);

  const scheduled = main.slice(main.indexOf("async function runScheduledAutomation"), main.indexOf("let automationTickQueued"));
  assert.doesNotMatch(scheduled, /\?\?\s*workspace\?\.threads\[0\]/);
  assert.match(scheduled, /Never fall back to threads\[0\]/);
});
