import assert from "node:assert/strict";
import test from "node:test";
import {
  findLivePendingApprovalActivity,
  markApprovalActivitiesSettling,
  mergeAssistantActivityItems,
  resolveEffectiveApproval
} from "./assistant-activity-merge.ts";

test("merge replaces 等待批准 with the same callId result", () => {
  const pending = {
    type: "run",
    title: "等待批准",
    status: "approval",
    callId: "call-1",
    command: "ffmpeg -version",
    detail: "ffmpeg -version"
  };
  const failed = {
    type: "run",
    title: "命令执行失败",
    status: "failed",
    callId: "call-1",
    command: "ffmpeg -version",
    detail: "ffmpeg -version",
    exitCode: 1
  };
  const merged = mergeAssistantActivityItems([pending], failed);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.title, "命令执行失败");
  assert.equal(merged[0]?.status, "failed");
  assert.equal(findLivePendingApprovalActivity(merged), undefined);
});

test("merge replaces 正在执行命令 then 等待批准 then failed for one call", () => {
  let items = mergeAssistantActivityItems([], {
    type: "run",
    title: "正在执行命令",
    callId: "c2",
    command: "echo hi"
  });
  items = mergeAssistantActivityItems(items, {
    type: "run",
    title: "等待批准",
    status: "approval",
    callId: "c2",
    command: "echo hi"
  });
  items = mergeAssistantActivityItems(items, {
    type: "run",
    title: "命令执行失败",
    status: "failed",
    callId: "c2",
    command: "echo hi",
    exitCode: 1
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, "命令执行失败");
});

test("resolveEffectiveApproval clears after snapshot approval is gone and run finished", () => {
  const activities = [{
    type: "run",
    title: "命令执行失败",
    status: "failed",
    callId: "call-1",
    command: "ffmpeg -version"
  }];
  assert.equal(resolveEffectiveApproval({
    snapshotApproval: null,
    selectedThreadAwaitingApproval: true,
    liveActivities: activities
  }), null);
});

test("resolveEffectiveApproval keeps live pending approval", () => {
  const decision = resolveEffectiveApproval({
    snapshotApproval: null,
    selectedThreadAwaitingApproval: false,
    liveActivities: [{
      type: "run",
      title: "等待批准",
      status: "approval",
      callId: "call-9",
      command: "git status"
    }]
  });
  assert.ok(decision);
  assert.match(decision!.message, /git status/);
});

test("resolveEffectiveApproval uses snapshot approval first", () => {
  const decision = resolveEffectiveApproval({
    snapshotApproval: { id: "a1", message: "确认执行 shell" },
    selectedThreadAwaitingApproval: false,
    liveActivities: []
  });
  assert.equal(decision?.message, "确认执行 shell");
});

test("resolveEffectiveApproval ignores catalog status when live activities already finished", () => {
  assert.equal(resolveEffectiveApproval({
    snapshotApproval: null,
    selectedThreadAwaitingApproval: true,
    liveActivities: [{
      type: "run",
      title: "等待批准",
      status: "approval",
      callId: "call-1",
      command: "ffmpeg -version"
    }, {
      type: "run",
      title: "命令执行失败",
      status: "failed",
      callId: "call-1",
      command: "ffmpeg -version"
    }]
  }), null);
});

test("resolveEffectiveApproval ignores a replay of the approval the user already decided", () => {
  assert.equal(resolveEffectiveApproval({
    snapshotApproval: { id: "approval-1", message: "Run a shell command" },
    selectedThreadAwaitingApproval: true,
    selectedThreadOwnsLiveApproval: true,
    selectedThreadHasLiveRequest: true,
    settledApprovalId: "approval-1",
    liveActivities: [{
      type: "run",
      title: "等待批准",
      status: "approval",
      callId: "call-1",
      command: "git pull"
    }]
  }), null);
  const next = resolveEffectiveApproval({
    snapshotApproval: { id: "approval-2", message: "Run another command" },
    selectedThreadOwnsLiveApproval: true,
    settledApprovalId: "approval-1"
  });
  assert.equal(next?.message, "Run another command");
});

test("resolveEffectiveApproval stays cleared while approve click is in flight", () => {
  assert.equal(resolveEffectiveApproval({
    snapshotApproval: null,
    selectedThreadAwaitingApproval: true,
    approvalDecisionPending: true,
    liveActivities: [{
      type: "run",
      title: "等待批准",
      status: "approval",
      callId: "call-9",
      command: "python -c \"from PIL import Image\""
    }]
  }), null);
});

test("resolveEffectiveApproval ignores foreign snapshot approval for another thread", () => {
  assert.equal(resolveEffectiveApproval({
    snapshotApproval: { id: "a-foreign", message: "确认执行 shell" },
    selectedThreadOwnsLiveApproval: false,
    selectedThreadAwaitingApproval: false,
    liveActivities: []
  }), null);
});

test("resolveEffectiveApproval does not synthesize sticky catalog awaiting without a live request", () => {
  assert.equal(resolveEffectiveApproval({
    snapshotApproval: null,
    selectedThreadOwnsLiveApproval: true,
    selectedThreadAwaitingApproval: true,
    selectedThreadHasLiveRequest: false,
    selectedThreadMessage: "原生工具调用等待批准",
    liveActivities: []
  }), null);
});

test("resolveEffectiveApproval synthesizes catalog awaiting only while this thread request is live", () => {
  const decision = resolveEffectiveApproval({
    snapshotApproval: null,
    selectedThreadOwnsLiveApproval: true,
    selectedThreadAwaitingApproval: true,
    selectedThreadHasLiveRequest: true,
    selectedThreadMessage: "原生工具调用等待批准",
    liveActivities: []
  });
  assert.equal(decision?.message, "原生工具调用等待批准");
});

test("markApprovalActivitiesSettling replaces sticky 等待批准 after approve", () => {
  const settled = markApprovalActivitiesSettling([{
    type: "run",
    title: "等待批准",
    status: "approval",
    callId: "call-1",
    command: "python -c \"print(1)\""
  }], true);
  assert.equal(settled[0]?.title, "正在执行命令");
  assert.equal(settled[0]?.status, "running");
  assert.equal(findLivePendingApprovalActivity(settled), undefined);
});
