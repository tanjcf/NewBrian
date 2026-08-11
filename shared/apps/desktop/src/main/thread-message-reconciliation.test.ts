import assert from "node:assert/strict";
import test from "node:test";

const reconciliation = import(
  new URL("./thread-message-reconciliation.ts", import.meta.url).href
) as Promise<typeof import("./thread-message-reconciliation.js")>;

test("keeps persisted context when the next request only contains a new user message", async () => {
  const { reconcileThreadMessages } = await reconciliation;
  const persisted = [
    { id: "u1", role: "user" as const, content: "Build a service", createdAt: "2026-01-01T00:00:00Z" },
    { id: "a1", role: "assistant" as const, content: "Which framework?", createdAt: "2026-01-01T00:00:01Z" },
    { id: "u2", role: "user" as const, content: "Use Python", createdAt: "2026-01-01T00:00:02Z" }
  ];

  const result = reconcileThreadMessages(
    persisted,
    [{ id: "u3", role: "user", content: "Continue after the failed request", createdAt: "2026-01-01T00:00:03Z" }],
    () => "generated",
    "2026-01-01T00:00:04Z"
  );

  assert.deepEqual(result.map((message) => message.id), ["u1", "a1", "u2", "u3"]);
});

test("does not duplicate messages already persisted before a request failure", async () => {
  const { reconcileThreadMessages } = await reconciliation;
  const persisted = [
    { id: "u1", role: "user" as const, content: "First", createdAt: "2026-01-01T00:00:00Z" },
    { id: "u2", role: "user" as const, content: "Failed turn", createdAt: "2026-01-01T00:00:01Z" }
  ];

  const result = reconcileThreadMessages(
    persisted,
    [
      { id: "u1", role: "user", content: "First", createdAt: "2026-01-01T00:00:00Z" },
      { id: "u2", role: "user", content: "Failed turn", createdAt: "2026-01-01T00:00:01Z" },
      { id: "u3", role: "user", content: "Retry", createdAt: "2026-01-01T00:00:02Z" }
    ],
    () => "generated",
    "2026-01-01T00:00:03Z"
  );

  assert.deepEqual(result.map((message) => message.content), ["First", "Failed turn", "Retry"]);
});

test("preserves display-only reasoning records without making them normal model turns", async () => {
  const { reconcileThreadMessages } = await reconciliation;
  const result = reconcileThreadMessages(
    [],
    [{
      id: "failed-assistant",
      role: "assistant",
      content: "",
      reasoningSummary: "Checked the workspace before the provider failed.",
      excludeFromModelContext: true,
      createdAt: "2026-01-01T00:00:00Z"
    }],
    () => "generated",
    "2026-01-01T00:00:01Z"
  );

  assert.equal(result[0]?.reasoningSummary, "Checked the workspace before the provider failed.");
  assert.equal(result[0]?.excludeFromModelContext, true);
});

test("does not re-ingest completed local-assistant stubs after assistant-turn exists", async () => {
  const { reconcileThreadMessages } = await reconciliation;
  const result = reconcileThreadMessages(
    [
      { id: "local-user-1", role: "user" as const, content: "写诗", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "assistant-turn-1",
        role: "assistant" as const,
        content: "《初见》",
        createdAt: "2026-01-01T00:00:05Z"
      }
    ],
    [
      { id: "local-user-1", role: "user", content: "写诗", createdAt: "2026-01-01T00:00:00Z" },
      {
        id: "local-assistant-1",
        role: "assistant",
        content: "《初见》",
        createdAt: "2026-01-01T00:00:01Z"
      },
      { id: "local-user-2", role: "user", content: "再来一首", createdAt: "2026-01-01T00:00:10Z" }
    ],
    () => "generated",
    "2026-01-01T00:00:11Z"
  );

  assert.deepEqual(result.map((message) => message.id), [
    "local-user-1",
    "assistant-turn-1",
    "local-user-2"
  ]);
});
