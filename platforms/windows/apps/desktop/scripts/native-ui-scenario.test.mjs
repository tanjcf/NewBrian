import assert from "node:assert/strict";
import test from "node:test";

import { validateScenario } from "./native-ui-scenario.mjs";

const completeScenario = {
  version: 1,
  id: "HOLON-NATIVE-UI-EXAMPLE",
  application: {
    windowTitle: "NewBrain",
    processNames: ["newbrain", "electron"],
    executable: "windows/apps/desktop/release/newbrain.exe"
  },
  steps: [
    { action: "maximize" },
    { action: "clickRelative", x: 72, y: 139 },
    { action: "assertVisible", name: "远程任务", timeoutMs: 10_000 },
    { action: "screenshot", output: "holon.png" },
    { action: "waitFile", path: "outputs/demo/result.txt", timeoutMs: 60_000 },
    { action: "assertFile", path: "outputs/demo/result.txt", contains: ["READY"] },
    { action: "closeWindow" },
    { action: "launchApplication" },
    { action: "waitWindow", title: "NewBrain", timeoutMs: 30_000 },
    { action: "screenshot", output: "recovered.png" }
  ]
};

test("accepts a parameterized native UI scenario with artifact and restart proof", () => {
  const normalized = validateScenario(completeScenario);
  assert.equal(normalized.id, completeScenario.id);
  assert.deepEqual(normalized.steps.map((step) => step.action), [
    "maximize", "clickrelative", "assertvisible", "screenshot", "waitfile", "assertfile",
    "closewindow", "launchapplication", "waitwindow", "screenshot"
  ]);
});

test("accepts a real-screen region assertion when Electron exposes no named controls", () => {
  const scenario = structuredClone(completeScenario);
  scenario.steps[2] = {
    action: "assertVisible",
    region: { x: 400, y: 140, width: 400, height: 120 },
    minForegroundRatio: 0.002
  };
  const normalized = validateScenario(scenario);
  assert.deepEqual(normalized.steps[2].region, scenario.steps[2].region);
});

test("rejects internal browser and application shortcuts", () => {
  for (const action of ["evaluate", "cdp", "dom", "internalApi", "window.newbrain"]) {
    assert.throws(
      () => validateScenario({ ...completeScenario, steps: [{ action }] }),
      /unsupported native UI action/i
    );
  }
});

test("rejects scenarios that can report success without artifact and restart evidence", () => {
  assert.throws(
    () => validateScenario({ ...completeScenario, steps: [{ action: "screenshot", output: "only.png" }] }),
    /artifact assertion/i
  );
  assert.throws(
    () => validateScenario({
      ...completeScenario,
      steps: completeScenario.steps.filter((step) => !["closeWindow", "launchApplication", "waitWindow"].includes(step.action))
    }),
    /restart recovery/i
  );
});

test("rejects absolute artifact paths so validators remain workspace scoped", () => {
  const scenario = structuredClone(completeScenario);
  scenario.steps[4].path = "C:\\outside\\result.txt";
  assert.throws(() => validateScenario(scenario), /workspace-relative/i);
});
