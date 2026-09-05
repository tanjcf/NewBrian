import assert from "node:assert/strict";
import test from "node:test";

const {
  buildAutoDelegateTurnConstraint,
  buildAutoModeOrchestratorInstruction,
  buildAutoModeRoleInstruction,
  shouldAutoDelegateHeavyWork
} = await import(new URL("./auto-orchestrator-policy.ts", import.meta.url).href);

test("shouldAutoDelegateHeavyWork keeps companion chat local", () => {
  assert.equal(shouldAutoDelegateHeavyWork({ taskClass: "chat", latestUserText: "你好" }), false);
  assert.equal(shouldAutoDelegateHeavyWork({ taskClass: "chat", latestUserText: "谢谢" }), false);
});

test("shouldAutoDelegateHeavyWork delegates code and research", () => {
  assert.equal(shouldAutoDelegateHeavyWork({ taskClass: "code", latestUserText: "修复编译错误" }), true);
  assert.equal(shouldAutoDelegateHeavyWork({ taskClass: "research", latestUserText: "调研竞品" }), true);
});

test("shouldAutoDelegateHeavyWork keeps media generation on parent tools", () => {
  assert.equal(
    shouldAutoDelegateHeavyWork({ taskClass: "general", latestUserText: "帮我生成一首流行歌曲" }),
    false
  );
  assert.equal(
    shouldAutoDelegateHeavyWork({ taskClass: "general", latestUserText: "做一张桌面壁纸" }),
    false
  );
});

test("shouldAutoDelegateHeavyWork skips gov_write when government product is offline", async () => {
  const { GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED } = await import(
    new URL("../shared/product-flags.ts", import.meta.url).href
  );
  if (GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED) return;
  assert.equal(
    shouldAutoDelegateHeavyWork({ taskClass: "gov_write", latestUserText: "请写一份政务调研报告并导出 PDF" }),
    false
  );
});

test("buildAutoModeRoleInstruction switches orchestrator vs companion", () => {
  assert.match(buildAutoModeRoleInstruction({ taskClass: "code", latestUserText: "实现登录" }), /orchestrator/i);
  assert.match(buildAutoModeRoleInstruction({ taskClass: "chat", latestUserText: "你好" }), /companion/i);
  assert.match(buildAutoModeOrchestratorInstruction(), /agent\.delegate/);
  assert.match(
    buildAutoModeRoleInstruction({ taskClass: "code", latestUserText: "实现登录", expertSummonActive: true }),
    /expert summoned/i
  );
  assert.equal(
    shouldAutoDelegateHeavyWork({ taskClass: "code", latestUserText: "实现登录", expertSummonActive: true }),
    false
  );
});

test("buildAutoDelegateTurnConstraint appends only for heavy Auto tasks", () => {
  assert.match(
    buildAutoDelegateTurnConstraint({ taskClass: "code", latestUserText: "修复编译错误" }),
    /agent\.delegate/
  );
  assert.equal(buildAutoDelegateTurnConstraint({ taskClass: "chat", latestUserText: "你好" }), "");
});
