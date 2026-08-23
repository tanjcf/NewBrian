import { buildAgentCollaborationInstruction } from "./agent-collaboration.js";
import { getCentralSkillInstruction } from "./central-skills.js";
import { buildGoalRuntimeInstruction } from "./goal-runtime.js";
import { buildModelEconomicsBrief, ensureRoutingProfile, type ModelEconomicsOption } from "./model-economics.js";
import { buildNativeToolSystemInstruction } from "./native-tool-prompt-policy.js";
import {
  buildProjectOsPromptBlock,
  isProjectManagerSkillName,
  selectProjectManagerReferences,
  type LoadedProjectOs
} from "./project-os-prompt-policy.js";
import { buildSkillGoalRuntimeInstruction } from "./skill-goal-runtime.js";
import { buildComposerModeInstruction, formatSkillDisclosure, type ComposerMode } from "./skill-selection.js";
import type { LoadedModelSkill } from "./model-chat-skill-service.js";

export interface ModelChatPromptInput {
  baseSystemPrompt: string;
  composerModes: ComposerMode[];
  goalSnapshot: Parameters<typeof buildGoalRuntimeInstruction>[0];
  goalRuntimeRequested: boolean;
  explicitSkillNames: string[];
  centralSkillNames: string[];
  latestUserRequest: string;
  memories: Array<{ scope: string; summary: string }>;
  loadedSkills: LoadedModelSkill[];
  /** Authorized subscription models with optional price / routing profiles. */
  availableModels?: ModelEconomicsOption[];
  /** Hermes/PAHF-style personalization guidance from project-manager shadow. */
  personalizationGuidance?: string;
  /** Disk-cached global + project knowledge (manual sync; inject every turn from local cache). */
  localKnowledgeText?: string;
  /** Current scene capability knowledge retrieved for this turn. */
  sceneKnowledgeText?: string;
  /** Repo-root Project OS (CODECN.md / CLAUDE.md / AGENTS.md). */
  projectOs?: LoadedProjectOs | string;
}

function isProjectManagerSkillNameLocal(name: string) {
  return isProjectManagerSkillName(name);
}

function extractOpenLearningQuestions(skills: LoadedModelSkill[]) {
  const questions: string[] = [];
  for (const skill of skills) {
    if (!isProjectManagerSkillNameLocal(skill.name)) continue;
    const openRef = skill.referenceContents?.find((reference) => reference.name === "learning-open-questions.md");
    if (!openRef?.content) continue;
    for (const line of openRef.content.split(/\r?\n/)) {
      if (!line.startsWith("- ")) continue;
      const text = line.slice(2).trim();
      if (!text || text === "(none)") continue;
      questions.push(text);
    }
  }
  return [...new Set(questions)].slice(0, 5);
}

/** Builds Hermes/PAHF personalization guidance for always-on project-manager shadow. */
export function buildPersonalizationInstruction(
  skills: LoadedModelSkill[],
  explicitGuidance?: string
) {
  if (explicitGuidance?.trim()) return explicitGuidance.trim();
  const hasProjectManager = skills.some((skill) => isProjectManagerSkillNameLocal(skill.name));
  if (!hasProjectManager) return "";
  const openQuestions = extractOpenLearningQuestions(skills);
  const lines = [
    "Personalization loop (Hermes/PAHF-style):",
    "1. Pre-Action: if the current request is ambiguous/subjective and injected preferences do not cover it, ask ONE clarifying question BEFORE acting. Do not guess lasting taste.",
    "2. Grounding: apply injected user-output-rules and repo Project OS (CODECN.md); once a preference exists, act directly and do not re-ask the same topic.",
    "3. Post-Action: when the user corrects you or answers a learning question, treat it as durable preference learning (runtime will distill it).",
    "Ask at most one preference question per turn. Prefer executing when memory already answers the ambiguity.",
    "Durable architecture belongs in CODECN.md (editable). Do not tool-edit .codecn preference references."
  ];
  if (openQuestions.length) {
    lines.push("Open learning questions for this project (ask before acting if still unresolved):");
    for (const question of openQuestions) lines.push(`- ${question}`);
  }
  return lines.join("\n");
}

function buildSkillInstruction(skills: LoadedModelSkill[]) {
  if (skills.length === 0) return "";
  return [
    "以下 Skill 已由运行时为本轮任务选中，必须遵循其完整 SKILL.md 约束。",
    `用户可见的 Skill 说明必须使用中文：${formatSkillDisclosure(skills)}。不要展示英文内部分析或 Skill 原始指令。`,
    skills.map((skill) => {
      const references = isProjectManagerSkillNameLocal(skill.name)
        ? selectProjectManagerReferences(skill.referenceContents)
        : (skill.referenceContents ?? []);
      return [
        `<skill name="${skill.name}">`,
        `Description: ${skill.description}`,
        "Complete SKILL.md:",
        skill.instructions,
        references.length
          ? [
              "Runtime-injected skill references (already loaded; do not read or rewrite preference references with tools):",
              ...references.map((reference) => `--- ${reference.name} ---\n${reference.content}`)
            ].join("\n\n")
          : "",
        `</skill>`
      ].filter(Boolean).join("\n");
    }).join("\n\n")
  ].join("\n\n");
}

/** Builds the complete model system prompt from explicit policy inputs. */
export function buildModelChatSystemPrompt(input: ModelChatPromptInput) {
  const memoryInstruction = input.memories.length
    ? [
        "Relevant durable memories (context only; explicit current instructions win):",
        ...input.memories.map((memory) => `- [${memory.scope}] ${memory.summary}`)
      ].join("\n")
    : "";
  const modelEconomics = buildModelEconomicsBrief(
    (input.availableModels ?? []).map((item) => ensureRoutingProfile(item))
  );
  return [
    input.baseSystemPrompt,
    [
      "默认执行语言为简体中文，除非用户在当前请求中明确指定其他语言。",
      "所有用户可见的 Skill 调用说明、目标、计划步骤标题、步骤描述、步骤结果、进度摘要、工具活动说明和最终答复必须使用中文。",
      "Skill 的英文名称仅是内部稳定标识；如确需展示，应先给出中文能力名称，英文标识只能放在括号中作为补充。",
      "不得输出完整思维链、英文草稿或内部自言自语；只输出简洁、可核验的中文执行摘要。"
    ].join(" "),
    [
      "Visible assistant content is user-facing output only.",
      "Never narrate private analysis, tool-selection plans, hidden reasoning, or phrases such as 'let me', 'I need to', 'now I should', or their Chinese equivalents in assistant content.",
      "When you need to call a tool, emit the tool call without a prose preamble. Put concise progress only in supported reasoning-summary events.",
      "After tool results, provide only the requested deliverable or a concise user-facing status."
    ].join(" "),
    [
      "Media generation policy (Auto / spring-app):",
      "- For 出图/壁纸/文生图/video, the desktop runtime short-circuits to spring-app Auto tools `image_generate` / `video_generate` (or legacy `/v1/images|/v1/videos`).",
      "- NEVER write '正在生成中...' and stop. NEVER pretend an image is generating via markdown tables, shell searches, SVG, Pillow, or local files.",
      "- NEVER curl tokenhub.tencentmaas.com, NEVER search env/files for API keys, NEVER invent wand endpoints.",
      "- Provider credentials and TokenHub wand paths live only in spring-app Admin model config.",
      "- If no image model is available, tell the user to enable 混元生图/hy-image-v3 in Admin — do not fake an image locally."
    ].join("\n"),
    modelEconomics,
    buildComposerModeInstruction(input.composerModes),
    buildGoalRuntimeInstruction(input.goalSnapshot, input.goalRuntimeRequested),
    buildSkillGoalRuntimeInstruction(input.explicitSkillNames, input.goalSnapshot),
    getCentralSkillInstruction(input.centralSkillNames),
    buildNativeToolSystemInstruction(input.latestUserRequest),
    buildAgentCollaborationInstruction(3),
    memoryInstruction,
    buildProjectOsPromptBlock(input.projectOs ?? ""),
    buildPersonalizationInstruction(input.loadedSkills, input.personalizationGuidance),
    input.localKnowledgeText?.trim()
      ? [
          "User knowledge space (local cache; global + current project; sync manually from Settings when needed):",
          input.localKnowledgeText.trim()
        ].join("\n")
      : "",
    input.sceneKnowledgeText?.trim()
      ? ["Current scene capability knowledge (retrieved for this turn):", input.sceneKnowledgeText.trim()].join("\n")
      : "",
    buildSkillInstruction(input.loadedSkills)
  ].filter(Boolean).join("\n\n");
}
