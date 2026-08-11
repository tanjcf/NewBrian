import assert from "node:assert/strict";
import test from "node:test";
import { buildContextCapsule } from "./context-capsule.js";

test("selects relevant and recent messages within explicit budgets", () => {
  const capsule = buildContextCapsule({
    instruction: "inspect authentication retry",
    maxMessages: 2,
    maxChars: 80,
    messages: [
      { role: "user", content: "unrelated visual polish" },
      { role: "assistant", content: "authentication retry is implemented in auth.ts" },
      { role: "user", content: "please continue the investigation" }
    ]
  });
  assert.equal(capsule.messages.length, 2);
  assert.match(capsule.messages[0].content, /authentication retry/);
  assert.match(capsule.messages[1].content, /continue/);
  assert.ok(capsule.budget.usedChars <= 80);
});
test("omits display-only and tool messages from child context", () => {
  const capsule = buildContextCapsule({
    instruction: "inspect",
    messages: [
      { role: "assistant", content: "safe visible progress", excludeFromModelContext: true },
      { role: "tool", content: "large raw tool output" },
      { role: "user", content: "inspect the project" }
    ]
  });
  assert.deepEqual(capsule.messages, [{ role: "user", content: "inspect the project" }]);
});

test("selects relevant durable memories and records message sources", () => {
  const capsule = buildContextCapsule({
    instruction: "Windows packaging",
    messages: [{ role: "user", content: "build release" }],
    memories: [
      { scope: "workspace", summary: "Use MSI for Windows packaging", usageCount: 1 },
      { scope: "workspace", summary: "Prefer blue buttons", usageCount: 10 }
    ]
  });
  assert.match(capsule.memories[0].summary, /Windows packaging/);
  assert.deepEqual(capsule.sources, [{ kind: "message", index: 0, role: "user" }]);
});
