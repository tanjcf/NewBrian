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
import { buildUserSkillPlatformInheritanceInstruction } from "./user-skill-platform-policy.js";
import { buildAutoModeRoleInstruction } from "./auto-orchestrator-policy.js";
import type { AutoTaskClass } from "./model-auto-router.ts";
import { formatModelRuntimeDateContext } from "./model-runtime-date-context.js";

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
  /** Typed delivery preferences prompt block (document.style). */
  deliveryPreferencesText?: string;
  /** Disk-cached global + project knowledge (manual sync; inject every turn from local cache). */
  localKnowledgeText?: string;
  /** Current scene capability knowledge retrieved for this turn. */
  sceneKnowledgeText?: string;
  /** Active BRAIN workspace scene key (routes media tools to scene Tools when set). */
  brainWorkspaceKey?: string;
  /** Repo-root Project OS (NEWBRAIN.md / CLAUDE.md / AGENTS.md). */
  projectOs?: LoadedProjectOs | string;
  /** True when the turn uses MODEL_AUTO_ID / Auto routing. */
  autoMode?: boolean;
  autoTaskClass?: AutoTaskClass | string;
  /** Expert Marketplace summon instruction (thread-bound expert lead persona + SOP). */
  expertSummonInstruction?: string;
  /** True when an expert is summoned on this thread (suppresses generic Auto strong-delegate). */
  expertSummonActive?: boolean;
  /** Bridge text so global/project skills know how to summon marketplace experts. */
  skillExpertBridgeInstruction?: string;
  /** Test override for runtime clock (defaults to Date.now). */
  runtimeNow?: Date;
  /** IANA timezone for runtime date context (defaults to Asia/Shanghai). */
  runtimeTimezone?: string;
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
    "2. Grounding: apply injected user-output-rules and repo Project OS (NEWBRAIN.md); once a preference exists, act directly and do not re-ask the same topic.",
    "3. Post-Action: when the user corrects you or answers a learning question, treat it as durable preference learning (runtime will distill it).",
    "Ask at most one preference question per turn. Prefer executing when memory already answers the ambiguity.",
    "Durable architecture belongs in NEWBRAIN.md (editable). Do not tool-edit .newbrain preference references."
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
    formatModelRuntimeDateContext({ now: input.runtimeNow, timezone: input.runtimeTimezone }),
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
      "Scene Tools sub-architecture (BRAIN):",
      input.brainWorkspaceKey && input.brainWorkspaceKey !== "explore"
        ? `- Current scene \`${input.brainWorkspaceKey}\` MUST use its right-side Tools panel APIs (registered scene tools). Do not skip the Tools sub-architecture with prose-only answers or bare gateway-only media calls when scene tools exist.`
        : "- 场景学习探索 has no business Tools panel; use native chat + files/artifacts/tasks. When the user moves to quant/game/video/music/data/software/document, switch to that scene's Tools.",
      input.brainWorkspaceKey === "music"
        ? "- Music: use `music.daw.save` / `music.song.generate` / `music.project.inspect` / `music.render.*` so 右侧「生成/音轨/标记切片/导出」 updates. Never bare `music_generate` alone in this scene."
        : "",
      input.brainWorkspaceKey === "video"
        ? "- Video: use `video.pipeline.save` / `video.shot.generate` / `video.timeline.*` / `video.render.*`. Prefer these over bare `video_generate`."
        : "",
      input.brainWorkspaceKey === "quant"
        ? "- Quant: use `quant.market.query` / `quant.portfolio.*` / `quant.strategy.run` / `quant.radar.create` / `quant.note.add` so 右侧行情/组合/策略/雷达/笔记 updates."
        : "",
      input.brainWorkspaceKey === "data"
        ? "- Data: use `data.file.import_local` / `data.analysis.*` / `data.dataset.*`; do not bypass with ad-hoc shell pandas scripts."
        : "",
      input.brainWorkspaceKey === "document"
        ? "- Document: use document workspace / review / export tools and document.create_*; Skill text alone is not a document write."
        : "",
      input.brainWorkspaceKey === "game"
        ? "- Game: use right-side level/design/preview/cook tools; design prose alone does not mutate the project."
        : "",
      input.brainWorkspaceKey === "software"
        ? "- Software: use right-side terminal/code/test/deploy/Flow tools with approvals; do not replace them with unscoped shell."
        : ""
    ].filter(Boolean).join("\n"),
    [
      "Media generation policy (Auto / spring-app):",
      input.brainWorkspaceKey === "music"
        ? "- Music scene Tools (mandatory): when the user asks for a song/lyrics/style/soundtrack in the music workspace, you MUST use scene tools `music.daw.save` and/or `music.song.generate` (and `music.project.inspect` / `music.render.*` as needed). Do NOT satisfy the request with bare `music_generate` alone — that skips the right-side Tools DAW panel. After success, tell the user to check 右侧 Tools「生成/音轨」."
        : input.brainWorkspaceKey === "video"
          ? "- Video scene Tools (mandatory): prefer `video.shot.generate` / `video.pipeline.save` over bare `video_generate` so the right-side pipeline updates."
        : "- When the user clearly asks to create/generate an image, wallpaper, poster, video, song, music, or soundtrack, you MUST call `image_generate`, `video_generate`, or `music_generate` (or scene `music.song.generate` / video pipeline tools when those are registered) and WAIT for the tool result before any user-facing reply.",
      "- Do not ask style clarifying questions when the user already gave enough detail (e.g. 桌面背景 / 自然风光 / 已有完整歌词); pick a concrete prompt and call the tool immediately.",
      "- Capability questions (能不能/会不会/可不可以生成图片、视频或音乐) must be answered in text only — do NOT call media tools.",
      "- NEVER write '正在生成中...' / `![正在生成中...]` / fake progress markdown and stop. That is a hard failure.",
      "- After a successful tool result, tell the user the local relative path (`.newbrain/generated-media/` or scene `media/stems/` / `media/clips/`). Prefer side-panel / right Tools preview when already opened by the tool.",
      "- NEVER curl tokenhub.tencentmaas.com, NEVER search env/files for API keys, NEVER invent wand endpoints.",
      "- Provider credentials and TokenHub wand paths live only in spring-app Admin model config.",
      "- If a media tool fails because no model is available, tell the user to enable the matching model in Admin (混元生图/hy-image-v3 for images, a video model for video, a music-generation model for music) — do not fake media locally.",
      input.brainWorkspaceKey === "music"
        ? "- You DO have music scene tools (`music.song.generate` etc.) for real audio. Do not deny music capability or redirect to Suno/Udio unless those tools failed."
        : "- You DO have `music_generate` in this chat when the user wants an actual audio file (outside music scene Tools). Do not deny music capability or redirect to Suno/Udio unless the tool failed."
    ].join("\n"),
    modelEconomics,
    buildComposerModeInstruction(input.composerModes),
    buildGoalRuntimeInstruction(input.goalSnapshot, input.goalRuntimeRequested),
    buildSkillGoalRuntimeInstruction(input.explicitSkillNames, input.goalSnapshot),
    getCentralSkillInstruction(input.centralSkillNames),
    buildNativeToolSystemInstruction(input.latestUserRequest),
    buildUserSkillPlatformInheritanceInstruction(),
    input.skillExpertBridgeInstruction?.trim() || "",
    input.autoMode
      ? buildAutoModeRoleInstruction({
          taskClass: input.autoTaskClass,
          latestUserText: input.latestUserRequest,
          expertSummonActive: input.expertSummonActive
        })
      : "",
    buildAgentCollaborationInstruction(3),
    input.expertSummonInstruction?.trim() || "",
    memoryInstruction,
    buildProjectOsPromptBlock(input.projectOs ?? ""),
    buildPersonalizationInstruction(input.loadedSkills, input.personalizationGuidance),
    input.deliveryPreferencesText?.trim() || "",
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
