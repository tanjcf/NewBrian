import assert from "node:assert/strict";
import test from "node:test";

const {
  parseResearchWritingExportInput,
  parseResearchWritingIntakeInput,
  parseResearchWritingPayload
} = await import(new URL("./research-writing-contract.ts", import.meta.url).href);

test("normalizes valid research-writing IPC payloads", () => {
  assert.deepEqual(parseResearchWritingIntakeInput({ answers: [{ question: "Q", answer: "A" }] }), {
    userRequest: undefined,
    conversationContext: undefined,
    answers: [{ question: "Q", answer: "A" }],
    attachments: undefined
  });
  assert.deepEqual(parseResearchWritingPayload({ body: "Draft", sources: [] }), {
    title: undefined,
    body: "Draft",
    sources: []
  });
  assert.equal(parseResearchWritingExportInput({ payload: { body: "Draft", sources: [] }, format: "docx" }).format, "docx");
});

test("rejects malformed and unbounded research-writing IPC payloads", () => {
  assert.throws(() => parseResearchWritingIntakeInput({ answers: "invalid" }), /must be an array/);
  assert.throws(() => parseResearchWritingPayload({ body: 42, sources: [] }), /must be a string/);
  assert.throws(() => parseResearchWritingPayload({ body: "x", sources: Array.from({ length: 101 }, () => ({})) }), /too many/);
  assert.throws(() => parseResearchWritingExportInput({ payload: { body: "x", sources: [] }, format: "pdf" }), /Unsupported/);
});
