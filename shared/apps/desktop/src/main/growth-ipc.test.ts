import assert from "node:assert/strict";
import test from "node:test";
import { desktopIpcChannels } from "@codex-forge/protocol";

test("growth IPC channel names match handbook §7.4 + G3 Hub", () => {
  assert.equal(desktopIpcChannels.growth.listInstances, "growth:list-instances");
  assert.equal(desktopIpcChannels.growth.listHumanTasks, "growth:list-human-tasks");
  assert.equal(desktopIpcChannels.growth.completeHumanTask, "growth:complete-human-task");
  assert.equal(desktopIpcChannels.growth.publishSkill, "growth:publish-skill");
  assert.equal(desktopIpcChannels.growth.listSkills, "growth:list-skills");
  assert.equal(desktopIpcChannels.growth.upsertMemory, "growth:upsert-memory");
  assert.equal(desktopIpcChannels.growth.listConnectors, "growth:list-connectors");
  assert.equal(desktopIpcChannels.growth.solidifyConnector, "growth:solidify-connector");
  assert.equal(desktopIpcChannels.growth.listTemplates, "growth:list-templates");
  assert.equal(desktopIpcChannels.growth.importTemplate, "growth:import-template");
  assert.equal(desktopIpcChannels.growth.completeAsyncWebhook, "growth:complete-async-webhook");
  assert.equal(desktopIpcChannels.growth.runtimeStatus, "growth:runtime-status");
  assert.equal(desktopIpcChannels.growth.setKillSwitch, "growth:set-kill-switch");
  assert.equal(desktopIpcChannels.growth.listRuntimeAudits, "growth:list-runtime-audits");
  assert.equal(desktopIpcChannels.growth.caseAsyncHumanDemo, "growth:case-async-human-demo");
});
