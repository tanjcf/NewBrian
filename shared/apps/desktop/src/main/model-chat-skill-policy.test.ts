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

test("explicit government-research-writing selection enables the central workflow", () => {
  if (!GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED) return;

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

    assert.equal(selection.governmentSkillEnabled, true, `autoSkillEnabled=${autoSkillEnabled}`);
    assert.ok(selection.centralSkillNames.includes("government-research-writing"));
    assert.ok(selection.explicitSkillNames.includes("government-research-writing"));
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

test("autoSkill OFF: greeting does not force always-on project-manager shadow", () => {
  const selection = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: [],
    localSkillDescriptors: localSkills,
    heuristicSkills: [localSkills[0]],
    hasActiveGoal: false,
    autoSkillEnabled: false,
    latestUserRequest: "你好"
  });

  assert.deepEqual(selection.selectedLocalSkillNames, []);
  assert.deepEqual(selection.explicitSkillNames, []);
  assert.equal(selection.governmentSkillEnabled, false);
});

test("autoSkill ON: greeting still does not force project-manager without explicit need", () => {
  const selection = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: [],
    localSkillDescriptors: localSkills,
    heuristicSkills: [localSkills[0]],
    hasActiveGoal: false,
    autoSkillEnabled: true,
    latestUserRequest: "你好"
  });

  assert.deepEqual(selection.selectedLocalSkillNames, []);
});

test("simple chat does not use automatic skill or project-manager shadow", () => {
  for (const latestUserRequest of ["谢谢你", "这是什么意思", "帮我翻译成英文：你好"]) {
    const selection = selectModelChatSkills({
      requestedSkillNames: [],
      persistedSkillNames: [],
      localSkillDescriptors: localSkills,
      heuristicSkills: [localSkills[0]],
      hasActiveGoal: false,
      autoSkillEnabled: true,
      latestUserRequest
    });
    assert.deepEqual(selection.selectedLocalSkillNames, [], latestUserRequest);
  }
});

test("non-chat task still attaches always-on project-manager shadow", () => {
  const selection = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: [],
    localSkillDescriptors: localSkills,
    heuristicSkills: [localSkills[0]],
    hasActiveGoal: false,
    autoSkillEnabled: false,
    latestUserRequest: "修复 typescript 编译报错"
  });

  assert.deepEqual(selection.selectedLocalSkillNames, ["sd-project-manager"]);
});

test("explicit composer selection enables government-research-writing", () => {
  if (!GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED) return;

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
    assert.equal(selection.governmentSkillEnabled, true, `autoSkillEnabled=${autoSkillEnabled}`);
    assert.ok(selection.centralSkillNames.includes("government-research-writing"));
  }
});

test("autoSkill keyword advisory enables government-research-writing", () => {
  if (!GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED) return;

  const selection = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: [],
    localSkillDescriptors: localSkills.filter((skill) => skill.name !== "government-research-writing"),
    heuristicSkills: [],
    hasActiveGoal: false,
    autoSkillEnabled: true,
    latestUserRequest: "写一个煤炭企业2025年年终总结发言稿，输出PDF文件"
  });

  assert.equal(selection.governmentSkillEnabled, true);
  assert.ok(selection.centralSkillNames.includes("government-research-writing"));
});

test("autoSkill can revive persisted and heuristic government specialty", () => {
  if (!GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED) return;

  const fromPersisted = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: ["government-research-writing"],
    localSkillDescriptors: localSkills,
    heuristicSkills: [],
    hasActiveGoal: true,
    autoSkillEnabled: true,
    latestUserRequest: "继续"
  });
  assert.equal(fromPersisted.governmentSkillEnabled, true);

  const fromHeuristic = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: [],
    localSkillDescriptors: localSkills,
    heuristicSkills: [localSkills[1]],
    hasActiveGoal: false,
    autoSkillEnabled: true,
    latestUserRequest: researchPrompt
  });
  assert.equal(fromHeuristic.governmentSkillEnabled, true);
  assert.ok(fromHeuristic.centralSkillNames.includes("government-research-writing"));
});

test("project local skills can auto-wake even when Skill 自动唤醒 is off", () => {
  const projectSkill = { name: "market-brief", description: "市场简报", path: "C:/proj/.newbrain/skills/market-brief" };
  const selection = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: [],
    localSkillDescriptors: [projectSkill, ...localSkills.filter((skill) => skill.name.endsWith("-project-manager"))],
    heuristicSkills: [projectSkill],
    hasActiveGoal: false,
    autoSkillEnabled: false,
    latestUserRequest: "请根据项目 skill 生成一份新能源汽车市场分析简报并导出 PPT"
  });
  assert.ok(selection.selectedLocalSkillNames.includes("market-brief"), selection.selectedLocalSkillNames.join(","));
  assert.equal(selection.governmentSkillEnabled, false);
});

test("a greeting still loads the global companion memory when that skill is installed", () => {
  const selection = selectModelChatSkills({
    requestedSkillNames: [],
    persistedSkillNames: [],
    localSkillDescriptors: [
      ...localSkills,
      { name: "companion-memory", description: "长期设定" }
    ],
    heuristicSkills: [],
    hasActiveGoal: false,
    autoSkillEnabled: false,
    latestUserRequest: "你好"
  });
  assert.deepEqual(selection.selectedLocalSkillNames, ["companion-memory"]);
});
