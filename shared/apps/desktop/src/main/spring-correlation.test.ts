import assert from "node:assert/strict";
import test from "node:test";

const {
  collectSpringCorrelationMismatches,
  formatSpringCorrelationDiagnostics,
  withSpringCorrelationBody,
  withSpringCorrelationHeaders
} = await import(new URL("./spring-correlation.ts", import.meta.url).href);

test("collectSpringCorrelationMismatches ignores missing echoes and reports conflicts", () => {
  assert.deepEqual(collectSpringCorrelationMismatches({
    threadId: "thread-a",
    requestId: "req-1"
  }, { model: "auto" }), []);

  assert.deepEqual(collectSpringCorrelationMismatches({
    threadId: "thread-a",
    requestId: "req-1"
  }, {
    thread_id: "thread-a",
    requestId: "req-1"
  }), []);

  const mismatches = collectSpringCorrelationMismatches({
    workspaceId: "ws-1",
    threadId: "thread-a",
    requestId: "req-1"
  }, {
    workspaceId: "ws-2",
    thread_id: "thread-b",
    clientMessageId: "req-9"
  });
  assert.equal(mismatches.length, 3);
  assert.match(formatSpringCorrelationDiagnostics("auto/route", mismatches), /thread_id/);
  assert.match(formatSpringCorrelationDiagnostics("auto/route", mismatches), /local TurnScope/);
});

test("withSpringCorrelationBody and headers attach ids without dropping payload", () => {
  const body = withSpringCorrelationBody({ model: "auto" }, {
    workspaceId: "ws-1",
    threadId: "thread-a",
    requestId: "req-1"
  });
  assert.equal(body.model, "auto");
  assert.equal(body.thread_id, "thread-a");
  assert.equal(body.request_id, "req-1");

  const headers = withSpringCorrelationHeaders({ Accept: "application/json" }, {
    threadId: "thread-a",
    requestId: "req-1"
  });
  assert.equal(headers.Accept, "application/json");
  assert.equal(headers["X-NewBrain-Thread-Id"], "thread-a");
  assert.equal(headers["X-NewBrain-Request-Id"], "req-1");
});
