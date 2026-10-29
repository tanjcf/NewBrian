import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationRefPreview } from "./conversation-ref-preview.ts";

test("buildConversationRefPreview keeps summary and last five turns", () => {
  const preview = buildConversationRefPreview({
    kind: "thread",
    title: "打包",
    summary: "MSI",
    workspaceId: "ws",
    threadId: "th",
    messages: [
      { role: "user", content: "1" },
      { role: "assistant", content: "2" },
      { role: "user", content: "3" },
      { role: "assistant", content: "4" },
      { role: "user", content: "5" },
      { role: "assistant", content: "6" },
      { role: "user", content: "7" }
    ]
  });
  assert.equal(preview.kind, "thread");
  assert.equal(preview.summary, "MSI");
  assert.equal(preview.truncated, true);
  assert.deepEqual(preview.turns?.map((item) => item.content), ["3", "4", "5", "6", "7"]);
});
