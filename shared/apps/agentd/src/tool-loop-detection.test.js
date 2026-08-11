import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLoopBlockedResult,
  createToolLoopState,
  detectToolCallLoop,
  recordToolCall,
  resolveLoopDetectionConfig
} from "./tool-loop-detection.js";

const enabled = resolveLoopDetectionConfig({
  enabled: true,
  warningThreshold: 3,
  criticalThreshold: 5,
  globalCircuitBreakerThreshold: 8,
  pairProgress: [
    {
      idleTool: "web.search_official",
      progressTool: "web.read_official",
      warningThreshold: 3,
      criticalThreshold: 5
    }
  ]
});

test("pair_progress warns then blocks search without read", () => {
  const state = createToolLoopState();
  const result = { ok: true, exitCode: 0, output: "{\"count\":1}" };

  for (let index = 0; index < 2; index += 1) {
    recordToolCall(state, "web.search_official", { query: `q-${index}` }, result, enabled);
  }

  const warning = detectToolCallLoop(state, "web.search_official", { query: "q-2" }, enabled);
  assert.equal(warning.stuck, true);
  assert.equal(warning.level, "warning");
  assert.equal(warning.detector, "pair_progress");

  recordToolCall(state, "web.search_official", { query: "q-2" }, result, enabled);
  recordToolCall(state, "web.search_official", { query: "q-3" }, result, enabled);

  const critical = detectToolCallLoop(state, "web.search_official", { query: "q-4" }, enabled);
  assert.equal(critical.stuck, true);
  assert.equal(critical.level, "critical");
  assert.equal(critical.detector, "pair_progress");
});

test("pair_progress resets after web.read_official", () => {
  const state = createToolLoopState();
  const result = { ok: true, exitCode: 0, output: "ok" };
  for (let index = 0; index < 4; index += 1) {
    recordToolCall(state, "web.search_official", { query: `q-${index}` }, result, enabled);
  }
  recordToolCall(state, "web.read_official", { url: "https://www.gov.cn/a" }, result, enabled);

  const next = detectToolCallLoop(state, "web.search_official", { query: "fresh" }, enabled);
  assert.equal(next.stuck, false);
});

test("generic_repeat blocks identical no-progress outcomes", () => {
  const state = createToolLoopState();
  const params = { path: "/same.txt" };
  const result = { ok: true, exitCode: 0, output: "same-bytes" };
  for (let index = 0; index < 5; index += 1) {
    recordToolCall(state, "fs.read", params, result, enabled);
  }
  const critical = detectToolCallLoop(state, "fs.read", params, enabled);
  assert.equal(critical.stuck, true);
  assert.equal(critical.level, "critical");
  assert.equal(critical.detector, "generic_repeat");
});

test("disabled config never reports stuck", () => {
  const state = createToolLoopState();
  const disabled = resolveLoopDetectionConfig({ enabled: false });
  for (let index = 0; index < 20; index += 1) {
    recordToolCall(state, "fs.read", { path: "/x" }, { ok: true, output: "x" }, disabled);
  }
  assert.deepEqual(detectToolCallLoop(state, "fs.read", { path: "/x" }, disabled), { stuck: false });
});

test("buildLoopBlockedResult carries deniedReason", () => {
  assert.deepEqual(buildLoopBlockedResult("stop"), {
    ok: false,
    exitCode: 1,
    deniedReason: "tool-loop",
    output: "stop"
  });
});

test("failed_family blocks repeated write/shell failures even when args change", () => {
  const state = createToolLoopState();
  const cfg = resolveLoopDetectionConfig({
    enabled: true,
    failedFamilyWarningThreshold: 3,
    failedFamilyCriticalThreshold: 4
  });
  for (let index = 0; index < 2; index += 1) {
    recordToolCall(
      state,
      "workspace.apply_patch",
      { patch: `bad-${index}` },
      { ok: false, exitCode: 1, output: "Begin Patch" },
      cfg
    );
  }
  const warning = detectToolCallLoop(state, "workspace.write_file", { path: "a.py" }, cfg);
  assert.equal(warning.stuck, true);
  assert.equal(warning.level, "warning");
  assert.equal(warning.detector, "failed_family");

  recordToolCall(
    state,
    "workspace.write_file",
    { path: "a.py" },
    { ok: false, exitCode: 1, output: "denied" },
    cfg
  );
  const critical = detectToolCallLoop(state, "shell.exec", { command: "echo x" }, cfg);
  assert.equal(critical.stuck, true);
  assert.equal(critical.level, "critical");
  assert.equal(critical.detector, "failed_family");
});
