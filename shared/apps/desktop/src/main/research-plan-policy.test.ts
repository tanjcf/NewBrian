import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResearchLeadInstruction,
  buildResearchPlan,
  classifyResearchQueryShape
} from "./research-plan-policy.ts";

test("classifies straight depth and breadth research shapes", () => {
  assert.equal(classifyResearchQueryShape("贵州茅台最新公告"), "straight");
  assert.equal(classifyResearchQueryShape("深入分析茅台扩产对业绩的影响机制"), "depth");
  assert.equal(classifyResearchQueryShape("对比茅台五粮液泸州老窖近期公告"), "breadth");
});

test("buildResearchPlan keeps child budget within three", () => {
  const breadth = buildResearchPlan({ request: "对比三家酒企公告与股价", maxChildren: 3 });
  assert.equal(breadth.shape, "breadth");
  assert.ok(breadth.maxChildren <= 3);
  assert.match(buildResearchLeadInstruction(breadth), /Search→Fetch|web\.fetch_page/);
  const straight = buildResearchPlan({ request: "今天茅台股价多少" });
  assert.equal(straight.maxChildren, 1);
  assert.equal(straight.steps[0]?.role, "researcher");
});
