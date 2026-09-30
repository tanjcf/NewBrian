import assert from "node:assert/strict";
import test from "node:test";

const factory = await import(new URL("./thread-state-factory.ts", import.meta.url).href);
const snapshotPolicy = await import(new URL("./thread-snapshot-policy.ts", import.meta.url).href);
let idSequence = 0;
const context = {
  makeId: (prefix: string) => `${prefix}-${++idSequence}`,
  nowIso: () => "2026-07-17T08:00:00.000Z"
};

test("creates a versioned thread state with stable initialization invariants", () => {
  idSequence = 0;
  const state = factory.createDefaultThreadState("NewBrain", "架构重构", context);
  assert.equal(state.version, 2);
  assert.deepEqual(state.messages.map((item: { role: string }) => item.role), ["system"]);
  assert.match(state.messages[0].content, /NewBrain.*架构重构/);
  assert.equal(state.memories[0].scope, "workspace");
  assert.equal(state.timeline[0].type, "thread");
  assert.deepEqual(state.runs, []);
  assert.deepEqual(state.events, []);
  assert.equal(state.context.modelContextWindow, 128_000);
  assert.deepEqual([state.messages[0].id, state.memories[0].id, state.timeline[0].id], ["msg-1", "memory-2", "event-3"]);
});

test("creates timeline events using injected identity and time sources", () => {
  idSequence = 0;
  assert.deepEqual(factory.createTimelineEvent("file", "写入文件", "src/main.ts", context), {
    id: "event-1",
    type: "file",
    title: "写入文件",
    detail: "src/main.ts",
    createdAt: "2026-07-17T08:00:00.000Z"
  });
});

test("preserves persisted messages when an exported snapshot looks truncated", () => {
  const persisted = factory.createDefaultThreadState("NewBrain", "Persistence", context);
  persisted.messages.push({ id: "user-1", role: "user", content: "keep me", createdAt: context.nowIso() });
  const exported = { ...persisted, messages: [persisted.messages[0]], memories: [] };
  const merged = factory.mergeThreadStateForPersistence(exported, persisted);
  assert.deepEqual(merged.messages, persisted.messages);
  assert.deepEqual(merged.memories, persisted.memories);
});

test("does not merge a previous runtime conversation into a fresh thread", () => {
  const persisted = factory.createDefaultThreadState("NewBrain", "Fresh", context);
  const exported = factory.createDefaultThreadState("NewBrain", "Previous", context);
  exported.messages.push({ id: "old-user", role: "user", content: "old conversation", createdAt: context.nowIso() });
  const merged = factory.mergeThreadStateForPersistence(exported, persisted);
  assert.deepEqual(merged.messages, persisted.messages);
});

test("does not merge a foreign thread conversation into an occupied thread", () => {
  const persisted = factory.createDefaultThreadState("NewBrain", "你好", context);
  persisted.messages.push({ id: "hello-user", role: "user", content: "你好", createdAt: context.nowIso() });
  persisted.messages.push({
    id: "hello-assistant",
    role: "assistant",
    content: "你好！",
    createdAt: context.nowIso()
  });
  const exported = factory.createDefaultThreadState("NewBrain", "十五五规划详细内容", context);
  exported.messages.push({
    id: "plan-user",
    role: "user",
    content: "十五五规划详细内容",
    createdAt: context.nowIso()
  });
  exported.messages.push({
    id: "plan-assistant",
    role: "assistant",
    content: "规划全文如下",
    createdAt: context.nowIso()
  });
  const merged = factory.mergeThreadStateForPersistence(exported, persisted);
  assert.deepEqual(merged.messages, persisted.messages);
  assert.equal(merged.messages.some((item: { content?: string }) => String(item.content || "").includes("十五五")), false);
});

test("merges state collections by id while retaining persisted-only records", () => {
  const persisted = factory.createDefaultThreadState("NewBrain", "Persistence", context);
  persisted.memories.push({ id: "memory-shared", scope: "workspace", summary: "old", createdAt: context.nowIso() });
  const exported = factory.createDefaultThreadState("NewBrain", "Persistence", context);
  exported.memories = [
    { id: "memory-shared", scope: "workspace", summary: "updated", createdAt: context.nowIso() },
    { id: "memory-new", scope: "workspace", summary: "new", createdAt: context.nowIso() }
  ];
  const merged = factory.mergeThreadStateForPersistence(exported, persisted);
  assert.equal(merged.version, 2);
  assert.deepEqual(merged.memories.map((item: { id: string }) => item.id), [
    persisted.memories[0].id, "memory-shared", "memory-new"
  ]);
  assert.equal(merged.memories[1].summary, "updated");
});

const runtimeSnapshot = (overrides: Record<string, unknown> = {}) => ({
  session: { status: "idle" }, approval: null, patch: null, runs: [], ...overrides
});

test("derives thread status with approval and active work precedence", () => {
  assert.equal(snapshotPolicy.deriveThreadStatusMetadata(runtimeSnapshot({ approval: { message: "confirm" }, session: { status: "failed" } })).status, "awaiting-approval");
  assert.equal(snapshotPolicy.deriveThreadStatusMetadata(runtimeSnapshot({ session: { status: "failed" }, runs: [{ label: "queued", status: "queued" }] })).status, "running");
  assert.equal(snapshotPolicy.deriveThreadStatusMetadata(runtimeSnapshot({ runs: [{ label: "failed", status: "failed" }] })).status, "failed");
  assert.equal(snapshotPolicy.deriveThreadStatusMetadata(runtimeSnapshot()).status, "idle");
});

test("describes snapshots using patch, approval, and run precedence", () => {
  assert.equal(snapshotPolicy.describeThreadSnapshot(runtimeSnapshot({ patch: { summary: "updated" }, approval: { message: "confirm" }, runs: [{ label: "test" }] })), "补丁更新: updated");
  assert.equal(snapshotPolicy.describeThreadSnapshot(runtimeSnapshot({ approval: { message: "confirm" }, runs: [{ label: "test" }] })), "审批请求: confirm");
  assert.equal(snapshotPolicy.describeThreadSnapshot(runtimeSnapshot({ runs: [{ label: "test" }] })), "运行记录: test");
  assert.equal(snapshotPolicy.describeThreadSnapshot(runtimeSnapshot()), "线程内容已更新");
});

test("overlays persisted thread collections onto a runtime snapshot", () => {
  const result = snapshotPolicy.buildSnapshotWithThreadState(runtimeSnapshot({ messages: ["runtime"] }), {
    version: 2, messages: [], memories: [], runs: [], timeline: [], events: []
  });
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.timeline, []);
  assert.deepEqual(result.events, []);
  assert.equal(result.session.status, "idle");
});
