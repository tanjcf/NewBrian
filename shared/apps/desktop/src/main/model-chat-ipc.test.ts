import assert from "node:assert/strict";
import test from "node:test";

const { parseModelChatInput } = await import(new URL("./model-chat-contract.ts", import.meta.url).href);

const validInput = {
  requestId: "request-1", workspaceId: "workspace-1", threadId: "thread-1", provider: "openai",
  baseUrl: "", apiKey: "", wireApi: "responses", model: "gpt-5", reviewModel: "",
  reasoningEffort: "high", disableResponseStorage: true, systemPrompt: "", messages: [{ role: "user", content: "hello" }]
};

test("normalizes a valid bounded model chat request", () => {
  const parsed = parseModelChatInput(validInput);
  assert.equal(parsed.messages[0]?.content, "hello");
  assert.equal(parsed.permissionMode, "agent");
});

test("migrates the removed approval tier to agent-managed approval", () => {
  assert.equal(parseModelChatInput({ ...validInput, permissionMode: "approval" }).permissionMode, "agent");
  assert.equal(parseModelChatInput({ ...validInput, permissionMode: "agent" }).permissionMode, "agent");
  assert.equal(parseModelChatInput({ ...validInput, permissionMode: "full" }).permissionMode, "full");
});

test("rejects malformed and oversized model chat requests", () => {
  assert.throws(() => parseModelChatInput({ ...validInput, wireApi: "legacy" }), /wire API/);
  assert.throws(() => parseModelChatInput({ ...validInput, disableResponseStorage: "yes" }), /boolean/);
  assert.throws(() => parseModelChatInput({ ...validInput, messages: Array(501).fill(validInput.messages[0]) }), /messages/);
  assert.throws(() => parseModelChatInput({ ...validInput, messages: [{ role: "user", content: "x".repeat(1_048_577) }] }), /content/);
});
