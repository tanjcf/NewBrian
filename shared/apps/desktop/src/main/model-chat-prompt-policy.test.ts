import assert from "node:assert/strict";
import test from "node:test";

const { buildModelChatSystemPrompt } = await import(
  new URL("./model-chat-prompt-policy.ts", import.meta.url).href
);

const baseInput = {
  baseSystemPrompt: "You are NewBrain.",
  composerModes: [] as const,
  goalSnapshot: null,
  goalRuntimeRequested: false,
  explicitSkillNames: [],
  centralSkillNames: [],
  latestUserRequest: "帮我生成一首轻音乐",
  memories: [],
  loadedSkills: [],
  projectOs: "# Project OS\nUse outputs/ for artifacts.",
  sceneKnowledgeText: "当前场景：音乐创作\nmusic.song.generate 写入右侧 DAW。",
  brainWorkspaceKey: "music",
  localKnowledgeText: "--- global/user-output-rules.md ---\n- 偏好简洁标题"
};

test("buildModelChatSystemPrompt always injects platform inheritance and media policy without user skills", () => {
  const prompt = buildModelChatSystemPrompt(baseInput);
  assert.match(prompt, /music\.song\.generate/);
  assert.match(prompt, /Scene Tools sub-architecture/);
  assert.match(prompt, /User-skill platform inheritance/i);
  assert.match(prompt, /shell is Windows PowerShell|shell is zsh/i);
  assert.match(prompt, /Project OS/);
  assert.match(prompt, /Current scene capability knowledge/);
  assert.doesNotMatch(prompt, /<skill name=/);
});

test("buildModelChatSystemPrompt keeps platform layers when a user skill is loaded", () => {
  const prompt = buildModelChatSystemPrompt({
    ...baseInput,
    loadedSkills: [{
      name: "writing-style",
      description: "仿写规范",
      instructions: "# Writing Style\nFollow the user's tone.",
      instructionPath: "C:/proj/.newbrain/skills/writing-style/SKILL.md",
      referenceContents: []
    }]
  });
  assert.match(prompt, /User-skill platform inheritance/i);
  assert.match(prompt, /music\.song\.generate/);
  assert.match(prompt, /workspace\.glob/);
  assert.match(prompt, /workspace\.grep/);
  assert.match(prompt, /workspace\.read/);
  assert.match(prompt, /<skill name="writing-style">/);
  assert.match(prompt, /Follow the user's tone/);
});

test("non-music scenes still require bare music_generate in media policy", () => {
  const prompt = buildModelChatSystemPrompt({
    ...baseInput,
    brainWorkspaceKey: "explore",
    sceneKnowledgeText: "当前场景：场景学习探索",
    latestUserRequest: "生成一首歌"
  });
  assert.match(prompt, /music_generate/);
  assert.doesNotMatch(prompt, /Music scene Tools \(mandatory\)/);
});

test("buildModelChatSystemPrompt injects Auto orchestrator role for heavy tasks", () => {
  const prompt = buildModelChatSystemPrompt({
    ...baseInput,
    autoMode: true,
    autoTaskClass: "code",
    latestUserRequest: "修复整个项目的 TypeScript 编译错误并补测试"
  });
  assert.match(prompt, /Auto mode \(orchestrator\)/i);
  assert.match(prompt, /agent\.delegate/);
});

test("buildModelChatSystemPrompt injects Auto companion role for short chat", () => {
  const prompt = buildModelChatSystemPrompt({
    ...baseInput,
    autoMode: true,
    autoTaskClass: "chat",
    latestUserRequest: "你好"
  });
  assert.match(prompt, /Auto mode \(companion\)/i);
  assert.doesNotMatch(prompt, /Auto mode \(orchestrator\)/i);
});

test("buildModelChatSystemPrompt injects authoritative runtime date context", () => {
  const prompt = buildModelChatSystemPrompt({
    ...baseInput,
    runtimeNow: new Date("2026-08-28T18:30:00.000Z"),
    runtimeTimezone: "Asia/Shanghai"
  });
  assert.match(prompt, /Current date and time \(Asia\/Shanghai\): 2026-08-29/);
  assert.match(prompt, /Current year: 2026/);
  assert.match(prompt, /authoritative/i);
});
