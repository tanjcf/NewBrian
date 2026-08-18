import assert from "node:assert/strict";
import test from "node:test";

const {
  parseListDelegatedAgentsInput,
  parseMergeDelegatedAgentResultsInput,
  parseRespondDelegatedAgentApprovalInput,
  parseRunDelegatedAgentInput
} = await import(new URL("./collaboration-contract.ts", import.meta.url).href);

test("normalizes valid delegated-agent inputs", () => {
  assert.deepEqual(parseRunDelegatedAgentInput({ workspaceId: " ws ", childThreadId: " child " }), {
    workspaceId: "ws", childThreadId: "child"
  });
  assert.deepEqual(parseListDelegatedAgentsInput({ workspaceId: "ws", parentThreadId: "parent" }), {
    workspaceId: "ws", parentThreadId: "parent"
  });
  assert.deepEqual(parseRespondDelegatedAgentApprovalInput({ workspaceId: "ws", childThreadId: "child", approved: false }), {
    workspaceId: "ws", childThreadId: "child", approved: false
  });
});

test("bounds and deduplicates delegated result merges", () => {
  assert.deepEqual(parseMergeDelegatedAgentResultsInput({
    workspaceId: "ws", parentThreadId: "parent", childThreadIds: [" child-1 ", "child-2"]
  }).childThreadIds, ["child-1", "child-2"]);
  assert.throws(() => parseMergeDelegatedAgentResultsInput({ workspaceId: "ws", parentThreadId: "parent", childThreadIds: [] }), /between 1 and 50/);
  assert.throws(() => parseMergeDelegatedAgentResultsInput({ workspaceId: "ws", parentThreadId: "parent", childThreadIds: ["child", " child "] }), /unique/);
  assert.throws(() => parseRespondDelegatedAgentApprovalInput({ workspaceId: "ws", childThreadId: "child", approved: "yes" }), /boolean/);
});
