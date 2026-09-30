import assert from "node:assert/strict";
import test from "node:test";

const {
  isGuidePayloadEmpty,
  normalizeGuideRequest,
  toSteerAgentPayload
} = await import(new URL("./model-chat-guide.ts", import.meta.url).href);

test("normalizes string guide input as immediate steer", () => {
  assert.deepEqual(normalizeGuideRequest("hello你好！"), {
    message: "hello你好！",
    attachments: [],
    delivery: "steer"
  });
});

test("normalizes attachments and delivery modes", () => {
  assert.deepEqual(normalizeGuideRequest({
    message: "看附件",
    attachments: [
      { name: "a.png", path: "C:/a.png", url: "newbrain://a" },
      { path: "" },
      { path: "C:/b.docx" }
    ],
    delivery: "followup"
  }), {
    message: "看附件",
    attachments: [
      { name: "a.png", path: "C:/a.png", url: "newbrain://a" },
      { name: "b.docx", path: "C:/b.docx" }
    ],
    delivery: "followup"
  });
  assert.equal(normalizeGuideRequest({ message: "x", delivery: "interrupt" }).delivery, "interrupt");
});

test("steer payload stays a string when there are no attachments", () => {
  assert.equal(toSteerAgentPayload({ message: "go", attachments: [] }), "go");
  assert.deepEqual(toSteerAgentPayload({
    message: "go",
    attachments: [{ name: "a.png", path: "C:/a.png" }]
  }), {
    content: "go",
    attachments: [{ name: "a.png", path: "C:/a.png" }]
  });
});

test("empty guide requires message or attachments", () => {
  assert.equal(isGuidePayloadEmpty({ message: "", attachments: [] }), true);
  assert.equal(isGuidePayloadEmpty({
    message: "",
    attachments: [{ name: "a.png", path: "C:/a.png" }]
  }), false);
});
