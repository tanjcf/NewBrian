import assert from "node:assert/strict";
import test from "node:test";

const policy = await import(new URL("./model-chat-success-policy.ts", import.meta.url).href);

test("creates a distinct assistant message for each successful turn", () => {
  const messages = [
    { id: "assistant-turn-1", role: "assistant", content: "旧提纲" }
  ];
  const assistant = policy.ensureTurnAssistantMessage({
    messages,
    turnId: "turn-2",
    waitingForApproval: false,
    create: (id: string) => ({ id, role: "assistant", content: "" })
  });
  assistant.content = "完整正文与第一版 PDF";

  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, "旧提纲");
  assert.equal(messages[1].id, "assistant-turn-2");
  assert.match(messages[1].content, /第一版 PDF/);
});

test("does not duplicate a replayed successful turn and still creates during approval wait", () => {
  const messages = [{ id: "assistant-turn-2", role: "assistant", content: "完整正文" }];
  assert.equal(policy.ensureTurnAssistantMessage({
    messages,
    turnId: "turn-2",
    waitingForApproval: false,
    create: () => { throw new Error("must not create"); }
  }), messages[0]);
  const pending = policy.ensureTurnAssistantMessage({
    messages,
    turnId: "turn-3",
    waitingForApproval: true,
    create: (id: string) => ({ id, role: "assistant", content: "等待批准" })
  });
  assert.equal(pending?.id, "assistant-turn-3");
  assert.equal(messages.length, 2);
});
