import assert from "node:assert/strict";
import test from "node:test";

const { buildModelChatResult } = await import(
  new URL("./model-chat-result-policy.ts", import.meta.url).href
);

test("approval waits still persist a visible assistant placeholder when body is empty", () => {
  const built = buildModelChatResult({
    generatedContent: "Let me create directories now.",
    disclosedSkills: [],
    workspacePath: "C:/project",
    writtenArtifacts: [],
    reasoningSummary: "",
    toolCalls: [{ id: "1", name: "shell.exec", arguments: { command: "mkdir x" } }],
    nativeWebSearches: [],
    awaitingApproval: true,
    runtimeSnapshot: { runs: [] },
    latestUserRequest: "按我之前规划的8张精选地图来做"
  });
  assert.match(built.canonicalContent, /等待你批准/);
  assert.match(built.result.content, /shell\.exec|待确认工具/);
});

test("completed empty turns still get an explicit fallback", () => {
  const built = buildModelChatResult({
    generatedContent: "now let me think",
    disclosedSkills: [],
    workspacePath: "C:/project",
    writtenArtifacts: [],
    reasoningSummary: "",
    toolCalls: [],
    nativeWebSearches: [],
    awaitingApproval: false,
    runtimeSnapshot: { runs: [] },
    latestUserRequest: "继续"
  });
  assert.match(built.canonicalContent, /没有生成可见回复/);
});
