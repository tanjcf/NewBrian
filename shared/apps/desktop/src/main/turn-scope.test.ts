import assert from "node:assert/strict";
import test from "node:test";

const {
  assertTurnScopeMatch,
  createTurnScope,
  patchTurnScope
} = await import(new URL("./turn-scope.ts", import.meta.url).href);

test("createTurnScope freezes workspace/thread/request and rejects blanks", () => {
  const scope = createTurnScope({
    workspaceId: "ws-1",
    threadId: "thread-a",
    requestId: "req-1",
    turnId: "turn-1",
    runtimeId: "thread-thread-a-req-1"
  });
  assert.deepEqual(scope, {
    workspaceId: "ws-1",
    threadId: "thread-a",
    requestId: "req-1",
    turnId: "turn-1",
    runtimeId: "thread-thread-a-req-1"
  });
  assert.throws(() => createTurnScope({
    workspaceId: "",
    threadId: "thread-a",
    requestId: "req-1"
  }), /workspaceId/);
});

test("patchTurnScope updates spring/media ids without changing identity keys", () => {
  const scope = createTurnScope({
    workspaceId: "ws-1",
    threadId: "thread-a",
    requestId: "req-1",
    turnId: "turn-1"
  });
  const next = patchTurnScope(scope, {
    turnId: "turn-2",
    springSessionId: "session-1",
    springTurnId: "spring-turn-1",
    mediaJobId: "job-9",
    workspaceId: "ws-hijack",
    threadId: "thread-b",
    requestId: "req-hijack"
  } as never);
  assert.equal(next.workspaceId, "ws-1");
  assert.equal(next.threadId, "thread-a");
  assert.equal(next.requestId, "req-1");
  assert.equal(next.turnId, "turn-2");
  assert.equal(next.springTurnId, "spring-turn-1");
  assert.equal(next.mediaJobId, "job-9");
});

test("assertTurnScopeMatch rejects cross-thread write targets", () => {
  const scope = createTurnScope({
    workspaceId: "ws-1",
    threadId: "thread-a",
    requestId: "req-1"
  });
  assert.doesNotThrow(() => assertTurnScopeMatch(scope, {
    workspaceId: "ws-1",
    threadId: "thread-a"
  }));
  assert.throws(() => assertTurnScopeMatch(scope, {
    workspaceId: "ws-1",
    threadId: "thread-b"
  }), /mismatch/);
});
