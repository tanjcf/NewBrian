import assert from "node:assert/strict";
import test from "node:test";
import type { ModelChatInput } from "@codex-forge/protocol";
import type { PersistedGoalSnapshot } from "./codex-storage.js";

const { ModelChatGoalService } = await import(
  new URL("./model-chat-goal-service.ts", import.meta.url).href
);
const { selectModelChatSkills } = await import(
  new URL("./model-chat-skill-policy.ts", import.meta.url).href
);

function snapshot(selectedSkillNames: string[] = []): PersistedGoalSnapshot {
  return {
    goal: {
      threadId: "thread-1",
      goalId: "goal-1",
      objective: "write report",
      status: "active",
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAtMs: 1,
      updatedAtMs: 1
    },
    runtime: {
      threadId: "thread-1",
      goalId: "goal-1",
      phase: "idle",
      consecutiveBlockedTurns: 0,
      lastError: "old error",
      selectedSkillNames,
      updatedAtMs: 1
    },
    plan: [],
    pendingQuestion: null
  };
}

function createFixture(initial: PersistedGoalSnapshot | null = null) {
  let current = initial;
  const calls = {
    created: 0,
    registered: 0,
    resumed: 0,
    boundTurnIds: [] as string[],
    runtimeUpdates: [] as PersistedGoalSnapshot["runtime"][],
    usage: [] as Array<{ tokensUsed: number; timeUsedSeconds: number; lastError?: string }>,
    answered: [] as string[]
  };
  const storage = {
    getGoalSnapshot: () => current,
    createGoal: () => {
      calls.created += 1;
      current = snapshot();
      return current.goal;
    },
    replaceGoalPlan: () => undefined,
    createGoalQuestion: (_threadId: string, _goalId: string, input: { questionId: string; prompt: string; options: unknown[] }) => {
      if (current) {
        current = {
          ...current,
          pendingQuestion: {
            threadId: "thread-1",
            goalId: "goal-1",
            questionId: input.questionId,
            prompt: input.prompt,
            options: input.options,
            status: "pending",
            answer: "",
            createdAtMs: 1
          } as never
        };
      }
      return current?.pendingQuestion;
    },
    answerGoalQuestion: (_threadId: string, _goalId: string, questionId: string, answer: string) => {
      if (current?.pendingQuestion?.questionId === questionId) current = { ...current, pendingQuestion: null };
      calls.answered.push(answer);
    },
    setGoalPaused: () => {
      calls.resumed += 1;
      if (current) current = { ...current, goal: { ...current.goal, status: "active" } };
      return current?.goal;
    },
    upsertGoal: (goal: PersistedGoalSnapshot["goal"]) => {
      if (goal.turnId) calls.boundTurnIds.push(goal.turnId);
      if (current) current = { ...current, goal };
    },
    upsertGoalRuntime: (runtime: PersistedGoalSnapshot["runtime"]) => {
      calls.runtimeUpdates.push(runtime);
      if (current) current = { ...current, runtime };
    },
    recordGoalTurn: (_threadId: string, usage: (typeof calls.usage)[number]) => {
      calls.usage.push(usage);
      return current;
    }
  };
  let now = 1_000;
  const service = new ModelChatGoalService({
    storage,
    selectSkills: selectModelChatSkills,
    buildGovernmentWritingInitialPlan: () => [],
    registerGoalRuntimeTools: () => { calls.registered += 1; },
    nowMs: () => now
  } as never);
  const runtime = {
    getSkillDescriptors: () => [
      { name: "sd-project-manager", description: "Project context" }
    ],
    matchSkills: () => []
  };
  return { service, runtime, calls, advance: (milliseconds: number) => { now += milliseconds; } };
}

test("does not auto-awaken government-research-writing without explicit skill selection", () => {
  const fixture = createFixture();
  const session = fixture.service.start({
    modelInput: {} as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-1",
    turnId: "turn-natural-language",
    latestUserRequest: "写一个煤炭企业2025年年终总结发言稿，输出PDF文件",
    autoSkillEnabled: false
  });

  assert.equal(session.governmentSkillEnabled, false);
  assert.deepEqual(session.centralSkillNames, []);
  assert.equal(fixture.calls.created, 0);
  assert.equal(fixture.calls.registered, 0);
  assert.equal(session.goalSnapshot, null);
});

test("does not auto-awaken government skill for a research-doc style message without selection", () => {
  const fixture = createFixture();
  const session = fixture.service.start({
    modelInput: { selectedSkillNames: [] } as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-1",
    turnId: "turn-research-doc",
    latestUserRequest: "请阅读附件中的调研报告与合同材料，帮我整理要点并撰写研究说明。",
    autoSkillEnabled: false
  });

  assert.equal(session.governmentSkillEnabled, false);
  assert.ok(!session.centralSkillNames.includes("government-research-writing"));
  assert.equal(fixture.calls.created, 0);
});

test("new chat with empty selection never enables government skill when autoSkill is OFF", () => {
  const fixture = createFixture();
  fixture.runtime.matchSkills = () => [{
    name: "government-research-writing",
    description: "政务研究写作 调研报告"
  }];
  const session = fixture.service.start({
    modelInput: { selectedSkillNames: [] } as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-new",
    turnId: "turn-new-chat",
    latestUserRequest: "请撰写一篇地方实践调研报告并输出PDF",
    autoSkillEnabled: false
  });

  assert.equal(session.governmentSkillEnabled, false);
  assert.deepEqual(session.centralSkillNames, []);
  assert.ok(!session.selectedLocalSkillNames.includes("government-research-writing"));
  assert.equal(fixture.calls.created, 0);
});

test("autoSkill ON can keyword-awaken government-research-writing", () => {
  const fixture = createFixture();
  const session = fixture.service.start({
    modelInput: { selectedSkillNames: [] } as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-auto",
    turnId: "turn-auto-on",
    latestUserRequest: "写一个煤炭企业2025年年终总结发言稿，输出PDF文件",
    autoSkillEnabled: true
  });

  assert.equal(session.governmentSkillEnabled, true);
  assert.ok(session.centralSkillNames.includes("government-research-writing"));
  assert.equal(fixture.calls.created, 1);
});

test("explicit composer selection enables government-research-writing", () => {
  const fixture = createFixture();
  const session = fixture.service.start({
    modelInput: { selectedSkillNames: ["government-research-writing"] } as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-1",
    turnId: "turn-explicit-skill",
    latestUserRequest: "请阅读附件中的调研报告与合同材料，帮我整理要点并撰写研究说明。",
    autoSkillEnabled: false
  });

  assert.equal(session.governmentSkillEnabled, true);
  assert.ok(session.centralSkillNames.includes("government-research-writing"));
  assert.equal(fixture.calls.created, 1);
  assert.ok(session.goalSnapshot?.runtime.selectedSkillNames?.includes("government-research-writing"));
});

test("does not keep government-research-writing from an active goal when composer selection is empty", () => {
  const fixture = createFixture(snapshot(["government-research-writing", "sd-project-manager"]));
  const session = fixture.service.start({
    modelInput: { selectedSkillNames: [] } as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-1",
    turnId: "turn-cleared-selection",
    latestUserRequest: "继续帮我看一下材料",
    autoSkillEnabled: false
  });

  assert.equal(session.governmentSkillEnabled, false);
  assert.deepEqual(session.centralSkillNames, []);
  assert.ok(!session.explicitSkillNames.includes("government-research-writing"));
  assert.deepEqual(session.goalSnapshot?.runtime.selectedSkillNames, ["sd-project-manager"]);
  assert.equal(fixture.calls.created, 0);
});

test("autoSkill ON keeps government-research-writing from an active goal", () => {
  const fixture = createFixture(snapshot(["government-research-writing", "sd-project-manager"]));
  const session = fixture.service.start({
    modelInput: { selectedSkillNames: [] } as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-1",
    turnId: "turn-auto-persist",
    latestUserRequest: "继续",
    autoSkillEnabled: true
  });

  assert.equal(session.governmentSkillEnabled, true);
  assert.ok(session.centralSkillNames.includes("government-research-writing"));
  assert.ok(session.goalSnapshot?.runtime.selectedSkillNames?.includes("government-research-writing"));
});

test("composer re-selection re-enables government-research-writing on an active goal", () => {
  const fixture = createFixture(snapshot(["sd-project-manager"]));
  const session = fixture.service.start({
    modelInput: { selectedSkillNames: ["government-research-writing"] } as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-1",
    turnId: "turn-reselect",
    latestUserRequest: "继续写调研报告",
    autoSkillEnabled: false
  });

  assert.equal(session.governmentSkillEnabled, true);
  assert.ok(session.centralSkillNames.includes("government-research-writing"));
  assert.ok(session.goalSnapshot?.runtime.selectedSkillNames?.includes("government-research-writing"));
});

test("creates a government goal from explicit skill selection", () => {
  const fixture = createFixture();
  const session = fixture.service.start({
    modelInput: { selectedSkillNames: ["government-research-writing"] } as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-1",
    turnId: "turn-1",
    latestUserRequest: "write report"
  });

  assert.equal(fixture.calls.created, 1);
  assert.equal(session.governmentSkillEnabled, true);
  assert.equal(session.goalSnapshot?.goal.status, "active");
});

test("revision-explanation turn keeps the selected government skill without creating a new goal", () => {
  const completed = snapshot(["government-research-writing"]);
  completed.goal.status = "complete";
  completed.runtime.phase = "complete";
  const fixture = createFixture(completed);
  const session = fixture.service.start({
    modelInput: { selectedSkillNames: ["government-research-writing"] } as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-1",
    turnId: "turn-preview",
    latestUserRequest: "先在对话中给我修改说明，不要立即生成文件。"
  });

  assert.equal(session.governmentSkillEnabled, true);
  assert.equal(fixture.calls.created, 0);
  assert.equal(session.goalSnapshot?.goal.status, "complete");
});

test("leaves follow-up intent analysis to the model after a government goal completes", () => {
  const completed = snapshot(["government-research-writing"]);
  completed.goal.status = "complete";
  completed.runtime.phase = "complete";
  const fixture = createFixture(completed);
  const session = fixture.service.start({
    modelInput: { selectedSkillNames: ["government-research-writing"] } as ModelChatInput,
    runtime: fixture.runtime, threadId: "thread-1", turnId: "turn-export",
    latestUserRequest: "请根据当前对话决定下一步"
  });
  assert.equal(fixture.calls.created, 0);
  assert.equal(session.goalSnapshot?.goal.status, "complete");
});

test("records measured tokens and falls back to estimated tokens", () => {
  const measured = createFixture(snapshot());
  const measuredSession = measured.service.start({
    modelInput: { composerModes: ["goal"] } as ModelChatInput,
    runtime: measured.runtime,
    threadId: "thread-1",
    turnId: "turn-1",
    latestUserRequest: "continue"
  });
  measuredSession.accounting!.tokens = 42;
  measured.advance(1_500);
  measured.service.finish(measuredSession, 99);
  assert.deepEqual(measured.calls.usage[0], { tokensUsed: 42, timeUsedSeconds: 2, lastError: "" });

  const estimated = createFixture(snapshot());
  const estimatedSession = estimated.service.start({
    modelInput: { composerModes: ["goal"] } as ModelChatInput,
    runtime: estimated.runtime,
    threadId: "thread-1",
    turnId: "turn-1",
    latestUserRequest: "continue"
  });
  estimated.service.finish(estimatedSession, 99);
  assert.equal(estimated.calls.usage[0].tokensUsed, 99);
  assert.equal(estimated.calls.usage[0].timeUsedSeconds, 1);
});


test("resumes a paused goal and rebinds it to the continuing turn", () => {
  const paused = snapshot();
  paused.goal.status = "paused";
  const fixture = createFixture(paused);
  const session = fixture.service.start({
    modelInput: { selectedSkillNames: ["government-research-writing"] } as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-1",
    turnId: "turn-continuation",
    latestUserRequest: "continue the previous request"
  });

  assert.equal(fixture.calls.resumed, 1);
  assert.deepEqual(fixture.calls.boundTurnIds, ["turn-continuation"]);
  assert.equal(session.goalSnapshot?.goal.status, "active");
  assert.equal(session.goalSnapshot?.goal.turnId, "turn-continuation");
  assert.equal(fixture.calls.registered, 1);
});

test("consumes a numeric composer reply for a pending native choice before continuing", () => {
  const pending = snapshot(["government-research-writing"]);
  pending.pendingQuestion = {
    threadId: "thread-1", goalId: "goal-1", questionId: "company-type",
    prompt: "请选择公司类型", status: "pending", answer: "", createdAtMs: 1,
    options: [
      { label: "煤矿生产企业", description: "生产型企业", recommended: true },
      { label: "煤炭贸易公司", description: "贸易企业", recommended: false }
    ]
  };
  const fixture = createFixture(pending);
  const session = fixture.service.start({
    modelInput: { selectedSkillNames: ["government-research-writing"] } as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-1",
    turnId: "turn-answer",
    latestUserRequest: "1"
  });
  assert.deepEqual(fixture.calls.answered, ["煤矿生产企业"]);
  assert.equal(session.goalSnapshot?.pendingQuestion, null);
  assert.equal(session.goalSnapshot?.runtime.phase, "running");
});

test("consumes a natural-language outline confirmation from the main composer", () => {
  const pending = snapshot(["government-research-writing"]);
  pending.pendingQuestion = {
    threadId: "thread-1", goalId: "goal-1", questionId: "outline-confirmation",
    prompt: "请确认提纲", status: "pending", answer: "", createdAtMs: 1,
    options: [
      { label: "确认提纲，继续写作", description: "开始正文", recommended: true },
      { label: "调整结构", description: "继续修改", recommended: false }
    ]
  };
  const fixture = createFixture(pending);
  fixture.service.start({
    modelInput: {} as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-1",
    turnId: "turn-confirm-outline",
    latestUserRequest: "确认这个提纲。开始写完整正文，生成第一版PDF。"
  });
  assert.deepEqual(fixture.calls.answered, ["确认提纲，继续写作"]);
});

test("bare confirm on an outline gate selects the recommended option", () => {
  const pending = snapshot(["government-research-writing"]);
  pending.pendingQuestion = {
    threadId: "thread-1", goalId: "goal-1", questionId: "outline-confirmation",
    prompt: "请确认提纲", status: "pending", answer: "", createdAtMs: 1,
    options: [
      { label: "确认提纲，继续撰写", description: "开始正文", recommended: true },
      { label: "调整整体结构", description: "继续修改", recommended: false }
    ]
  };
  const fixture = createFixture(pending);
  fixture.service.start({
    modelInput: {} as ModelChatInput,
    runtime: fixture.runtime,
    threadId: "thread-1",
    turnId: "turn-bare-confirm",
    latestUserRequest: "确认"
  });
  assert.deepEqual(fixture.calls.answered, ["确认提纲，继续撰写"]);
});
