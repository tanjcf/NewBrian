import test from "node:test";
import assert from "node:assert/strict";
import { ExpertCollaboration, EXPERT_ACCEPT, EXPERT_SKIP, effectiveExpertPreference } from "./expert-collaboration.ts";

function fixture() {
  const questions: any[] = [], preferences: any[] = [], saved: any[] = [];
  const deps = {
    scope: "project", scene: "software", goal: () => ({ goalId: "task", status: "active" }),
    createGoal: () => ({ goalId: "task", status: "active" }), questions: () => questions,
    ask: (_: string, q: any) => questions.unshift({ ...q, status: "pending" }),
    applied: (_: string, id: string) => { questions.find(q => q.questionId === id).status = "applied"; },
    catalog: async () => [{ id: "review", displayName: "代码审查", installed: true, enabled: true }],
    preferences: async () => preferences,
    savePreference: async (p: any) => { saved.push(p); }
  };
  const choice = [{ expertId: "review", reason: "修改涉及权限校验", responsibility: "检查越权风险" }];
  return { questions, preferences, saved, deps, choice, service: new ExpertCollaboration(deps) };
}
test("first use requires a persisted user decision, restored service recognizes only approved experts", async () => {
  const f = fixture();
  await assert.rejects(f.service.authorize("review"), /CONFIRMATION_REQUIRED/);
  assert.equal((await f.service.propose("审查权限修改", f.choice)).status, "waiting_user");
  await assert.rejects(f.service.authorize("review"), /CONFIRMATION_REQUIRED/);
  f.questions[0].status = "answered"; f.questions[0].answer = EXPERT_ACCEPT;
  await new ExpertCollaboration(f.deps).authorize("review");
  await assert.rejects(f.service.authorize("other"), /UNAVAILABLE/);
  assert.equal(f.saved.length, 0);
});
test("declining does not repeat or activate, adjustments require a new concrete proposal", async () => {
  const f = fixture();
  await f.service.propose("审查", f.choice);
  f.questions[0].status = "answered"; f.questions[0].answer = "调整分工";
  await assert.rejects(f.service.authorize("review"), /CONFIRMATION_REQUIRED/);
  assert.equal((await f.service.propose("审查", [{ ...f.choice[0], responsibility: "只检查新增接口" }])).status, "waiting_user");
  f.questions[0].status = "answered"; f.questions[0].answer = EXPERT_SKIP;
  assert.equal((await f.service.propose("审查", f.choice)).status, "declined");
  await assert.rejects(f.service.authorize("review"), /DECLINED/);
});
test("project off overrides global auto; unknown task cannot inherit another task's acceptance", async () => {
  const f = fixture();
  f.preferences.push({ scope: "global", scene: "software", expertId: "review", mode: "auto" });
  await f.service.authorize("review");
  f.preferences.push({ scope: "project", scene: "software", expertId: "review", mode: "off" });
  assert.equal(effectiveExpertPreference(f.preferences, "project", "software", "review")?.mode, "off");
  await assert.rejects(f.service.authorize("review"), /CONFIRMATION_REQUIRED/);
  assert.equal((await f.service.propose("审查", f.choice)).status, "excluded_by_preference");
});
test("saving preferences requires separate scope confirmation and is not inferred from activation", async () => {
  const f = fixture();
  assert.equal((await f.service.preference("review", "auto")).status, "waiting_user");
  assert.equal(f.saved.length, 0);
  f.questions[0].status = "answered"; f.questions[0].answer = "仅本项目";
  await f.service.preference("review", "auto");
  assert.deepEqual(f.saved, [{ scope: "project", scene: "software", expertId: "review", mode: "auto" }]);
  assert.equal((await f.service.preference("review", "auto")).status, "waiting_user");
});
