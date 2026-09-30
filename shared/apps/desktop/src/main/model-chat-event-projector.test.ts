import assert from "node:assert/strict";
import test from "node:test";
import type { WrittenArtifact } from "./output-summary.js";

const { ModelChatEventProjector } = await import(
  new URL("./model-chat-event-projector.ts", import.meta.url).href
);

function context() {
  const activities: Array<Record<string, unknown>> = [];
  const reasoning: string[] = [];
  const writtenArtifacts: WrittenArtifact[] = [];
  return {
    activities,
    reasoning,
    writtenArtifacts,
    projection: {
      requestId: "request-1",
      workspacePath: "C:/workspace",
      writtenArtifacts,
      getRuns: () => [{ id: "run-1", callId: "call-1", cwd: "C:/workspace", status: "completed" }],
      emitReasoningSummary: (delta: string) => { reasoning.push(delta); },
      publishActivity: (activity: Record<string, unknown>) => { activities.push(activity); }
    }
  };
}

test("projects tool calls and approvals without executing side effects", () => {
  const state = context();
  const projector = new ModelChatEventProjector();
  projector.project(state.projection, {
    type: "tool_call",
    payload: { id: "call-1", name: "shell.exec", arguments: { command: "git status" } }
  });
  projector.project(state.projection, {
    type: "approval_requested",
    payload: { call: { id: "call-1", name: "shell.exec", arguments: { command: "git status" } } }
  });
  assert.equal(state.activities[0].status, "running");
  assert.equal(state.activities[1].status, "approval");
  assert.match(state.reasoning.join(""), /正在运行命令：git status/);
});

test("deduplicates written artifacts and projects the canonical run result", () => {
  const state = context();
  const projector = new ModelChatEventProjector();
  const event = {
    type: "tool_result",
    payload: {
      callId: "call-1",
      name: "workspace.write_file",
      result: { ok: true, artifact: { path: "report.md", size: 12, changeType: "created" } }
    }
  };
  projector.project(state.projection, event);
  projector.project(state.projection, {
    ...event,
    payload: { ...event.payload, result: { ok: true, artifact: { path: "report.md", size: 20, changeType: "modified" } } }
  });
  assert.deepEqual(state.writtenArtifacts, [{ path: "report.md", size: 20, changeType: "modified" }]);
  assert.equal(state.activities.every((activity) => activity.type === "patch"), true);
  assert.equal(state.activities.some((activity) => activity.title === "已执行命令"), false);
});

test("projects plans as semantic progress without command-only fields", () => {
  const state = context();
  const projector = new ModelChatEventProjector();
  projector.project(state.projection, {
    type: "tool_call",
    payload: { id: "plan-1", name: "goal.update_plan", arguments: { steps: [] } }
  });
  projector.project(state.projection, {
    type: "tool_result",
    payload: { callId: "plan-1", name: "goal.update_plan", result: { ok: true, detail: "步骤已更新" } }
  });
  assert.equal(state.activities[0].title, "正在更新计划");
  assert.equal(state.activities[1].title, "已更新计划");
  assert.equal(state.activities[1].type, "complete");
  assert.equal(state.activities[1].command, undefined);
  assert.equal(state.activities[1].exitCode, undefined);
});

test("keeps shell output and exit code in the command activity", () => {
  const state = context();
  new ModelChatEventProjector().project(state.projection, {
    type: "tool_result",
    payload: { callId: "call-1", name: "shell.exec", result: { ok: true, command: "git status", exitCode: 0, stdout: "clean" } }
  });
  assert.equal(state.activities[0].type, "run");
  assert.equal(state.activities[0].title, "已运行命令");
  assert.equal(state.activities[0].exitCode, 0);
  assert.equal(state.activities[0].stdout, "clean");
});

test("projects a verified shell-generated PDF as a clickable created artifact", () => {
  const state = context();
  const projector = new ModelChatEventProjector();
  projector.project(state.projection, {
    type: "tool_result",
    payload: {
      callId: "inspect-pdf",
      name: "artifact.inspect",
      result: { ok: true, artifact: { path: "2025年上半年军事发展总结.pdf", size: 231_000 } }
    }
  });

  assert.deepEqual(state.writtenArtifacts, [{
    path: "2025年上半年军事发展总结.pdf",
    size: 231_000,
    changeType: "created"
  }]);
  assert.equal(state.activities[0]?.title, "已新建 2025年上半年军事发展总结.pdf");
  assert.equal(state.activities[0]?.artifactPath, "2025年上半年军事发展总结.pdf");
  assert.equal(state.activities[0]?.artifactSize, 231_000);
  assert.equal(state.activities[0]?.artifactVerified, true);
});

test("projects a native artifact.create result as an already verified file card", () => {
  const state = context();
  new ModelChatEventProjector().project(state.projection, {
    type: "tool_result",
    payload: {
      callId: "create-pptx",
      name: "artifact.create",
      result: { ok: true, artifact: { path: "outputs/review.pptx", size: 52_000, changeType: "created", verified: true } }
    }
  });
  assert.deepEqual(state.writtenArtifacts, [{ path: "outputs/review.pptx", size: 52_000, changeType: "created" }]);
  assert.equal(state.activities[0]?.artifactPath, "outputs/review.pptx");
  assert.equal(state.activities[0]?.artifactVerified, true);
});
