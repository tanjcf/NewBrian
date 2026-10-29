import assert from "node:assert/strict";
import test from "node:test";
import { messagesBeforeUserMessage } from "./rewind-thread-messages.ts";

test("editing a user message keeps only the turns before it", () => {
  const messages = [
    { id: "s", role: "system", content: "sys" },
    { id: "u1", role: "user", content: "first" },
    { id: "a1", role: "assistant", content: "answer" },
    { id: "u2", role: "user", content: "second" },
    { id: "a2", role: "assistant", content: "later" }
  ];
  assert.deepEqual(
    messagesBeforeUserMessage(messages, "u2")?.map((message) => message.id),
    ["s", "u1", "a1"]
  );
  assert.deepEqual(messagesBeforeUserMessage(messages, "u1"), [messages[0]]);
  assert.equal(messagesBeforeUserMessage(messages, "a1"), null);
});
