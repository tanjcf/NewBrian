/**
 * CHAT-INPUT-HISTORY-ORDER-SMOKE-001
 * Packaging must run this case and stop when it fails.
 * A new user input must stay below the previous turn's historical output.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  keepNewInputBelowHistoricalOutput,
  reconcileThreadDisplayMessages
} from "./thread-activity-policy.ts";

const CASE_ID = "CHAT-INPUT-HISTORY-ORDER-SMOKE-001";

test(`${CASE_ID} places a new question below the previous assistant output`, () => {
  const ordered = keepNewInputBelowHistoricalOutput([
    { id: "user-1", role: "user", content: "做一份 PPT", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "user-2", role: "user", content: "把第 6 页改成复购", createdAt: "2026-01-01T00:01:00.000Z" },
    { id: "assistant-1", role: "assistant", content: "历史输出：大纲已经写好", createdAt: "2026-01-01T00:00:05.000Z" }
  ]);
  assert.deepEqual(ordered.map((message) => message.id), ["user-1", "assistant-1", "user-2"]);
});

test(`${CASE_ID} keeps a snapshot merge from parking the old answer under the new input`, () => {
  const reconciled = reconcileThreadDisplayMessages(
    [
      { id: "user-1", role: "user", content: "做一份 PPT", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "local-assistant-1", role: "assistant", content: "历史输出：大纲已经写好", createdAt: "2026-01-01T00:00:05.000Z" },
      { id: "local-user-2", role: "user", content: "把第 6 页改成复购", createdAt: "2026-01-01T00:01:00.000Z" }
    ],
    [
      { id: "user-1", role: "user", content: "做一份 PPT", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "local-user-2", role: "user", content: "把第 6 页改成复购", createdAt: "2026-01-01T00:01:00.000Z" }
    ]
  );
  const ids = reconciled.map((message) => message.id);
  assert.ok(ids.indexOf("local-assistant-1") >= 0);
  assert.ok(ids.indexOf("local-assistant-1") < ids.indexOf("local-user-2"));
});

test(`${CASE_ID} still keeps a slightly newer thread summary above the first user message`, () => {
  const reconciled = reconcileThreadDisplayMessages(
    [{
      id: "local-user-new-thread",
      role: "user",
      content: "start a long government-writing task",
      createdAt: "2026-01-01T00:00:00.000Z"
    }],
    [{
      id: "thread-summary-message",
      role: "assistant",
      content: "thread created",
      createdAt: "2026-01-01T00:00:00.050Z"
    }]
  );
  assert.deepEqual(
    reconciled.map((message) => message.id),
    ["thread-summary-message", "local-user-new-thread"]
  );
});
