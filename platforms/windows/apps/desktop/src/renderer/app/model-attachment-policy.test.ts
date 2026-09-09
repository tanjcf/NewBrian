import assert from "node:assert/strict";
import test from "node:test";
const { compactModelAttachment } = await import(new URL("./model-attachment-policy.ts", import.meta.url).href) as typeof import("./model-attachment-policy.js");

test("replaces a large inline image preview with its bounded managed URL", () => {
  const compact = compactModelAttachment({
    name: "智能化综采工作面.png",
    path: "C:\\state\\attachments\\managed-image.png",
    url: `data:image/png;base64,${"a".repeat(3_000_000)}`
  });
  assert.equal(compact.url, "newbrain-attachment://media/managed-image.png");
  assert.ok(compact.url.length < 8_192);
  assert.equal(compact.name, "智能化综采工作面.png");
  assert.equal(compact.path, "C:\\state\\attachments\\managed-image.png");
});

test("preserves an already bounded attachment URL", () => {
  const attachment = {
    name: "安全工作纪要.docx",
    path: "C:\\state\\attachments\\managed.docx",
    url: "newbrain-attachment:///managed.docx"
  };
  assert.equal(compactModelAttachment(attachment), attachment);
});
