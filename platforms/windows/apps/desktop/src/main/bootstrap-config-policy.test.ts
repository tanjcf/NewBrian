import assert from "node:assert/strict";
import test from "node:test";

const policy = await import(new URL("./bootstrap-config-policy.ts", import.meta.url).href);

test("normalizes bootstrap environment fields and removes invalid entries", () => {
  const result = policy.normalizeBootstrapConfig({ environments: [
    { id: " custom ", label: " Custom Tool ", command: " tool.exe ", args: ["--check", 42], cwd: " C:/workspace " },
    { id: " " }
  ] });
  assert.deepEqual(result.environments, [{
    id: "custom", label: "Custom Tool", enabled: true, command: "tool.exe",
    args: ["--check"], cwd: "C:/workspace"
  }]);
});

test("falls back to required defaults when no valid environments remain", () => {
  const result = policy.normalizeBootstrapConfig({ environments: [{ id: " " }] });
  assert.deepEqual(result, policy.defaultBootstrapConfig);
  assert.deepEqual(result.environments.map((item: { id: string }) => item.id), ["conda", "python", "node", "project-deps"]);
});

test("creates enabled task definitions with stable label fallback", () => {
  const tasks = policy.createBootstrapTaskDefinitions({ environments: [
    { id: "enabled", label: " ", enabled: true },
    { id: "disabled", enabled: false }
  ] });
  assert.deepEqual(tasks, [{ id: "enabled", label: "enabled", enabled: true, command: undefined, args: undefined, cwd: undefined }]);
});

test("restores runtime task states with domain-specific precedence", () => {
  const definitions = policy.createBootstrapTaskDefinitions(policy.defaultBootstrapConfig);
  const tasks = policy.mergeBootstrapTaskStates(definitions, {
    tasks: [
      { id: "conda", label: "old", status: "running", detail: "old detail", startedAt: "start" },
      { id: "node", label: "old", status: "running", detail: "installing" }
    ],
    conda: { status: "ready", updatedAt: "conda-ready" },
    python: { status: "manual_required", updatedAt: "python-done", reason: "missing" },
    node: { status: "ready", updatedAt: "node-ready", version: "v24" }
  });
  const conda = tasks.find((task: { id: string }) => task.id === "conda");
  const python = tasks.find((task: { id: string }) => task.id === "python");
  const node = tasks.find((task: { id: string }) => task.id === "node");
  assert.deepEqual({ status: conda.status, startedAt: conda.startedAt, completedAt: conda.completedAt }, {
    status: "ready", startedAt: "start", completedAt: "conda-ready"
  });
  assert.deepEqual({ status: python.status, detail: python.detail }, { status: "manual_required", detail: "missing" });
  assert.deepEqual({ status: node.status, detail: node.detail }, { status: "running", detail: "installing" });
});

test("creates pending state for custom tasks without persisted history", () => {
  assert.deepEqual(policy.mergeBootstrapTaskStates([{ id: "custom", label: "Custom", enabled: true }]), [{
    id: "custom", label: "Custom", status: "pending", detail: undefined,
    startedAt: undefined, completedAt: undefined
  }]);
});

test("derives running status and progress from mixed task states", () => {
  const tasks = [
    { id: "ready", label: "Ready", status: "ready" },
    { id: "running", label: "Running", status: "running" },
    { id: "manual", label: "Manual", status: "manual_required" }
  ];
  const result = policy.createBootstrapStatusPayload({ overall: {
    status: "running", currentTaskId: "running", message: "working", updatedAt: "now"
  } }, tasks);
  assert.equal(result.overall.status, "running");
  assert.equal(result.overall.completedTasks, 2);
  assert.equal(result.overall.progressPercent, 67);
  assert.equal(result.overall.currentTaskId, "running");
});

test("derives manual-required and empty-ready terminal states", () => {
  const manual = policy.createBootstrapStatusPayload(undefined, [
    { id: "ready", label: "Ready", status: "ready" },
    { id: "manual", label: "Manual", status: "manual_required" }
  ]);
  assert.equal(manual.overall.status, "manual_required");
  assert.equal(manual.overall.progressPercent, 100);
  const empty = policy.createBootstrapStatusPayload(undefined, []);
  assert.equal(empty.overall.status, "ready");
  assert.equal(empty.overall.progressPercent, 100);
  assert.equal(empty.conda.status, "pending");
});
