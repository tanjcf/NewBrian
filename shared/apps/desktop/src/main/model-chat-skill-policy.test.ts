import assert from "node:assert/strict";
import test from "node:test";

const { selectModelChatSkills } = await import(
  new URL("./model-chat-skill-policy.ts", import.meta.url).href
);
const {
  GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED
} = await import(new URL("./central-skills.ts", import.meta.url).href);

const localSkills = [
  { name: "sd-project-manager", description: "Project context" },
  {
    name: "government-research-writing",
    description: "Create and revise Chinese government-research and local-practice articles 调研报告 政策研究"
  }
];

const researchPrompt = "请撰写一篇地方实践调研报告，突出因地制宜路径。";

test("product offline: government-research-writing never enables from request, persist, heuristic, or keywords", () => {
  assert.equal(GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED, false);

  for (const autoSkillEnabled of [false, true]) {
    const selection = selectModelChatSkills({
      requestedSkillNames: ["government-research-writing"],
      persistedSkillNames: ["government-research-writing", "sd-project-manager"],
      localSkillDescriptors: localSkills,
      heuristicSkills: [localSkills[1]],
      hasActiveGoal: true,
      autoSkillEnabled,
      latestUserRequest: researchPrompt
    });

    assert.equal(selection.governmentSkillEnabled, false, `autoSkillEnabled=${autoSkillEnabled}`);
    assert.deepEqual(selection.centralSkillNames, []);
    assert.ok(!selection.explicitSkillNames.includes("government-research-writing"));
    assert.ok(!selection.selectedLocalSkillNames.includes("government-research-writing"));
    assert.ok(selection.explicitSkillNames.includes("sd-project-manager"));
  }
});

test("autoSkill OFF: does not revive government-research-writing from persisted goal alone", () => {
  const selection = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: ["government-research-writing", "sd-project-manager"],
    localSkillDescriptors: localSkills,
    heuristicSkills: [localSkills[1]],
    hasActiveGoal: true,
    autoSkillEnabled: false,
    latestUserRequest: researchPrompt
  });

  assert.equal(selection.governmentSkillEnabled, false);
  assert.deepEqual(selection.centralSkillNames, []);
  assert.ok(!selection.explicitSkillNames.includes("government-research-writing"));
  assert.ok(!selection.selectedLocalSkillNames.includes("government-research-writing"));
  assert.ok(selection.explicitSkillNames.includes("sd-project-manager"));
});

test("autoSkill OFF: new-chat research keywords and heuristic match do not enable specialty skill", () => {
  const selection = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: [],
    localSkillDescriptors: localSkills,
    heuristicSkills: [localSkills[0], localSkills[1]],
    hasActiveGoal: false,
    autoSkillEnabled: false,
    latestUserRequest: researchPrompt
  });

  assert.equal(selection.governmentSkillEnabled, false);
  assert.ok(!selection.centralSkillNames.includes("government-research-writing"));
  assert.ok(!selection.selectedLocalSkillNames.includes("government-research-writing"));
  assert.ok(selection.selectedLocalSkillNames.includes("sd-project-manager"));
});

test("autoSkill OFF: greeting still attaches always-on project-manager shadow", () => {
  const selection = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: [],
    localSkillDescriptors: localSkills,
    heuristicSkills: [localSkills[0]],
    hasActiveGoal: false,
    autoSkillEnabled: false,
    latestUserRequest: "你好"
  });

  assert.deepEqual(selection.selectedLocalSkillNames, ["sd-project-manager"]);
  assert.deepEqual(selection.explicitSkillNames, []);
  assert.equal(selection.governmentSkillEnabled, false);
});

test("autoSkill ON: greeting can still auto-inject project-manager from heuristics", () => {
  const selection = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: [],
    localSkillDescriptors: localSkills,
    heuristicSkills: [localSkills[0]],
    hasActiveGoal: false,
    autoSkillEnabled: true,
    latestUserRequest: "你好"
  });

  assert.deepEqual(selection.selectedLocalSkillNames, ["sd-project-manager"]);
});

test("product offline: explicit composer selection cannot enable government-research-writing", () => {
  for (const autoSkillEnabled of [false, true]) {
    const selection = selectModelChatSkills({
      requestedSkillNames: ["government-research-writing"],
      persistedSkillNames: [],
      localSkillDescriptors: localSkills,
      heuristicSkills: [],
      hasActiveGoal: false,
      autoSkillEnabled,
      latestUserRequest: "随便聊聊"
    });
    assert.equal(selection.governmentSkillEnabled, false, `autoSkillEnabled=${autoSkillEnabled}`);
    assert.deepEqual(selection.centralSkillNames, []);
  }
});

test("product offline: autoSkill keyword advisory does not enable government-research-writing", () => {
  const selection = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: [],
    localSkillDescriptors: localSkills.filter((skill) => skill.name !== "government-research-writing"),
    heuristicSkills: [],
    hasActiveGoal: false,
    autoSkillEnabled: true,
    latestUserRequest: "写一个煤炭企业2025年年终总结发言稿，输出PDF文件"
  });

  assert.equal(selection.governmentSkillEnabled, false);
  assert.ok(!selection.centralSkillNames.includes("government-research-writing"));
});

test("product offline: persisted goal specialty and heuristic specialty cannot auto-awaken", () => {
  const fromPersisted = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: ["government-research-writing"],
    localSkillDescriptors: localSkills,
    heuristicSkills: [],
    hasActiveGoal: true,
    autoSkillEnabled: true,
    latestUserRequest: "继续"
  });
  assert.equal(fromPersisted.governmentSkillEnabled, false);

  const fromHeuristic = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: [],
    localSkillDescriptors: localSkills,
    heuristicSkills: [localSkills[1]],
    hasActiveGoal: false,
    autoSkillEnabled: true,
    latestUserRequest: researchPrompt
  });
  assert.equal(fromHeuristic.governmentSkillEnabled, false);
  assert.ok(!fromHeuristic.centralSkillNames.includes("government-research-writing"));
});
