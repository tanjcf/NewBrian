import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ensureProgrammingSkillReferences,
  PROGRAMMING_SKILL_TEMPLATE_MARKER
} from "./programming-skill-seed.js";
import {
  SCENE_TOOLS_TEMPLATE_MARKER,
  SCENE_KNOWLEDGE_FILENAME,
  SCENE_TOOLS_ROUTING_FILENAME,
  ensureSceneProjectInit,
  normalizeSceneKey
} from "./scene-knowledge-seed.js";
import {
  DELIVERY_PREFERENCES_FILENAME,
  DOCUMENT_STYLE_DOMAIN,
  applyDocumentStyleDomain,
  buildDeliveryPreferenceUiState,
  clearDocumentStyleDomain,
  deliveryRulesSummaryLine,
  emptyDeliveryPreferences,
  formatDeliveryPreferencesPromptBlock,
  hasDocumentStyle,
  parseDeliveryPreferences,
  summarizeDocumentStyle
} from "./delivery-preferences.js";
import {
  extractDeliveryPreferenceUpdate,
  isDocumentDeliveryIntent,
  isDocumentStyleSensitive
} from "./delivery-preference-extract.js";

/**
 * Hermes/PAHF-style active user-shadow learning for project-manager.
 *
 * Loop:
 * 1. Pre-Action Clarification — if the request is preference-sensitive and
 *    memory has no matching preference, open a learning question and ask BEFORE acting.
 * 2. Preference Grounding — always apply injected user-output-rules / project knowledge.
 * 3. Post-Action Feedback — every turn is summarized; corrections/answers become durable prefs.
 */

const USER_RULE_TERMS = [
  "rule", "requirement", "must", "never", "always", "prefer", "habit", "style", "format", "output", "summary",
  "规则", "要求", "用户要求", "必须", "不要", "别再", "每次", "以后", "偏好", "习惯", "格式", "输出", "总结",
  "中文", "详细", "简洁", "更新到", "收录", "全程", "负责", "改成", "改为", "应该"
];

const PROJECT_KNOWLEDGE_TERMS = [
  "project", "architecture", "feature", "module", "runtime", "desktop", "agentd", "skill", "memory", "knowledge",
  "api", "schema", "database", "workflow", "pipeline",
  "项目", "架构", "功能", "模块", "目录", "运行时", "桌面端", "技能", "知识", "文档", "接口", "协议", "实现", "重构"
];

const REUSABLE_RULE_MARKERS = [
  "from now on", "in future", "for future", "every time", "always", "remember", "preserve", "must",
  "以后", "今后", "每次", "始终", "记住", "长期", "持久", "保存为", "作为默认", "默认", "习惯"
];

const CORRECTION_MARKERS = [
  "不要", "别再", "改成", "改为", "应该是", "不对", "错了", "重新按", "按我说", "按我的",
  "instead", "don't", "do not", "never", "rather than", "prefer", "change to", "should be", "wrong",
  "修正", "纠正", "修改意见", "反馈意见"
];

const ONE_SHOT_MARKERS = [
  "this request", "this time only", "only this", "just this", "for this message",
  "本次", "这一次", "仅此", "就这一次", "只这一次", "这次请求", "当前这条"
];

const TASK_ONLY_MARKERS = [
  "create ", "write file", "生成文件", "创建文件", "输出 exactly", "output exactly",
  "写一个", "新建", "删除文件", "commit", "push"
];

/** Subjective / ambiguous cues that warrant pre-action clarification when memory is empty. */
const SUBJECTIVE_MARKERS = [
  "好看", "更好", "合适", "优雅", "舒服", "随便", "看着办", "你决定", "你来定", "怎么都行",
  "风格", "偏好", "习惯", "详细还是", "简洁还是", "哪种", "哪一种", "选哪个", "怎么办比较好",
  "帮我改改", "优化一下", "改进一下", "润色", "重构一下",
  "favorite", "prefer", "better", "nicer", "cleaner", "whatever", "you decide", "up to you",
  "style", "taste", "subjective"
];

const ASK_MARKERS = [
  "?", "？", "吗", "呢", "请确认", "请选择", "你希望", "你更希望", "你想要", "要不要",
  "哪种", "哪一种", "还是", "可否", "能否", "可以告诉我",
  "which", "prefer", "would you like", "do you want", "should i", "can you confirm"
];

const DEFAULT_OUTPUT_RULES = [
  "For Chinese user requests, answer in Chinese unless the user asks otherwise.",
  "Reusable user preferences and corrections must be actively distilled into this project manager skill after each turn.",
  "Prefer summarizing lasting working habits over copying one-shot task text verbatim.",
  "When a preference-sensitive request is ambiguous and no matching preference exists yet, ask ONE clarifying question before acting; after the user answers, distill it into a durable preference and stop re-asking."
];

/** Repo-root Project OS instruction file (Claude Code–style source of truth). */
export const PROJECT_OS_FILENAME = "NEWBRAIN.md";

const PROJECT_OS_LEGACY_FILES = ["CLAUDE.md", "AGENTS.md"];

const PROJECT_KNOWLEDGE_INDEX_LIMIT = 24;

/** Detect the stock NEWBRAIN.md template so upgrades do not hide richer legacy files. */
export function isDefaultProjectOsScaffold(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return true;
  return trimmed.includes("_(fill in)_")
    && /Project OS/i.test(trimmed)
    && /repo-root source of truth/i.test(trimmed);
}

const fileWriteQueues = new Map();
/** Wait budget for a live peer holding a fresh lock before failing activate/writes. */
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 20;
/**
 * Cross-process lock age after which we treat the file as abandoned.
 * Writers only hold during tiny markdown appends; a multi-second hold means a crash left the .lock behind.
 */
const LOCK_STALE_MS = 30_000;

function safeName(value) {
  const normalized = String(value || "project")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "project";
}

function cleanLine(value, limit = 700) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function includesAny(value, terms) {
  const text = String(value || "").toLowerCase();
  return terms.some((term) => text.includes(String(term).toLowerCase()));
}

function isReusableRuleRequest(value) {
  return includesAny(value, REUSABLE_RULE_MARKERS);
}

function isCorrectionOrPreference(value) {
  return includesAny(value, CORRECTION_MARKERS) || includesAny(value, USER_RULE_TERMS);
}

function isOneShotTask(value) {
  const text = String(value || "");
  if (includesAny(text, ONE_SHOT_MARKERS)) return true;
  if (includesAny(text, TASK_ONLY_MARKERS) && !isReusableRuleRequest(text) && !isCorrectionOrPreference(text)) {
    return true;
  }
  return false;
}

function isPreferenceSensitive(value) {
  const text = String(value || "");
  if (!text.trim()) return false;
  if (isOneShotTask(text) && !includesAny(text, SUBJECTIVE_MARKERS)) return false;
  return includesAny(text, SUBJECTIVE_MARKERS)
    || includesAny(text, CORRECTION_MARKERS)
    || /怎么(写|做|改|选|配)|哪种|更好|偏好|风格|格式|详细|简洁/.test(text);
}

function uniquePush(list, value) {
  const item = cleanLine(value);
  if (item && !list.includes(item)) list.push(item);
}

function distillPreferenceLines(user) {
  const text = cleanLine(user, 900);
  if (!text) return [];
  const lines = [];
  if (isReusableRuleRequest(text) || isCorrectionOrPreference(text)) {
    if (includesAny(text, CORRECTION_MARKERS)) {
      uniquePush(lines, `修正: ${text}`);
    } else if (isReusableRuleRequest(text)) {
      uniquePush(lines, `规则: ${text}`);
    } else {
      uniquePush(lines, `偏好: ${text}`);
    }
  }
  return lines;
}

function distillProjectFacts(user, assistant) {
  const combined = `${user}\n${assistant}`;
  if (!includesAny(combined, PROJECT_KNOWLEDGE_TERMS) && !includesAny(user, CORRECTION_MARKERS)) {
    return [];
  }
  // Keep a short NEWBRAIN.md candidate index — architecture belongs in repo-root NEWBRAIN.md,
  // not as unbounded bullets in runtime project-knowledge.md.
  const facts = [];
  uniquePush(
    facts,
    `NEWBRAIN候选: ${cleanLine(user, 180)}${assistant ? ` → ${cleanLine(assistant, 120)}` : ""}`
  );
  return facts;
}

function significantTokens(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/u)
    .filter((token) => token.length >= 2)
    .slice(0, 40);
}

function hasRelevantPreference(user, rulesText) {
  const rules = String(rulesText || "");
  if (!rules.trim()) return false;
  const durable = rules.split(/\r?\n/)
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => /^(规则|偏好|修正)[:：]/.test(line) || isCorrectionOrPreference(line) || isReusableRuleRequest(line));
  if (!durable.length) return false;
  const userTokens = new Set(significantTokens(user).filter((token) =>
    !["帮我", "一下", "这个", "那个", "请", "the", "and", "for", "with"].includes(token)
  ));
  if (!userTokens.size) return durable.length > 0 && includesAny(user, SUBJECTIVE_MARKERS) === false;
  return durable.some((rule) => {
    const ruleTokens = significantTokens(rule);
    const overlap = ruleTokens.filter((token) => userTokens.has(token));
    return overlap.length >= 1 || includesAny(rule, SUBJECTIVE_MARKERS) && includesAny(user, SUBJECTIVE_MARKERS);
  });
}

function proposeLearningQuestion(user) {
  return cleanLine(
    `待确认偏好: ${cleanLine(user, 180)} — 请先问用户确认长期习惯（输出语言/详细程度/格式/是否写入项目知识），确认后再执行；答完后总结为可复用偏好。`,
    500
  );
}

function looksLikeClarifyingQuestion(assistant) {
  const text = cleanLine(assistant, 1_200);
  if (!text) return false;
  if (!includesAny(text, ASK_MARKERS)) return false;
  // Prefer short ask-first replies; long finished deliverables are not learning questions.
  if (text.length > 900 && !/先确认|请确认|你希望|你更希望|before (i|we) (act|change|edit)/i.test(text)) {
    return false;
  }
  return includesAny(text, [
    ...SUBJECTIVE_MARKERS,
    ...USER_RULE_TERMS,
    "确认", "选择", "希望", "偏好", "风格", "格式", "详细", "简洁", "preference", "confirm", "style", "format"
  ]);
}

function extractAskedLearningQuestion(assistant) {
  if (!looksLikeClarifyingQuestion(assistant)) return "";
  const text = cleanLine(assistant, 500);
  return cleanLine(`已向用户追问: ${text}`, 500);
}

function parseOpenQuestionLines(source) {
  return String(source || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Ask at most") && !/^#/.test(line));
}

function looksLikeAnswerToOpenQuestion(user, openQuestions) {
  if (!openQuestions.length) return false;
  const text = cleanLine(user, 900);
  if (!text) return false;
  // Short preference answers, or explicit preference/correction phrasing.
  if (text.length <= 160) return true;
  if (isCorrectionOrPreference(text) || isReusableRuleRequest(text)) return true;
  if (isOneShotTask(text) && text.length > 200) return false;
  return includesAny(text, SUBJECTIVE_MARKERS) || includesAny(text, ["选择", "选", "要", "用", "prefer", "choose"]);
}

function distillAnsweredOpenQuestion(user, openQuestions) {
  if (!looksLikeAnswerToOpenQuestion(user, openQuestions)) return "";
  const question = openQuestions[0];
  return cleanLine(`偏好: ${cleanLine(question, 180)} → 用户答复: ${cleanLine(user, 280)}`, 500);
}

function buildActiveSessionSummary(user, assistant, learned) {
  const parts = [
    `用户: ${cleanLine(user, 320)}`,
    `助手: ${cleanLine(assistant, 320)}`
  ];
  if (learned.outputRules.length) {
    parts.push(`主动学习规则: ${learned.outputRules.slice(0, 3).join(" | ")}`);
  }
  if (learned.projectFacts.length) {
    parts.push(`知识沉淀: ${learned.projectFacts.slice(0, 2).join(" | ")}`);
  }
  if (learned.openQuestions?.length) {
    parts.push(`待学习追问: ${learned.openQuestions.slice(0, 2).join(" | ")}`);
  }
  if (learned.resolvedQuestions?.length) {
    parts.push(`已关闭追问: ${learned.resolvedQuestions.slice(0, 2).join(" | ")}`);
  }
  if (!learned.outputRules.length && !learned.projectFacts.length) {
    parts.push("主动学习: 本轮以会话摘要记录，未升级为长期规则");
  }
  return cleanLine(parts.join("；"), 1_400);
}

/**
 * Actively distill durable learning from one user/assistant exchange.
 * @param {string} user
 * @param {string} assistant
 * @param {{ openQuestions?: string[] }} [context]
 */
export function extractFacts(user, assistant, context = {}) {
  const facts = {
    outputRules: [],
    projectFacts: [],
    requestedRules: [],
    openQuestions: [],
    resolvedQuestions: [],
    clearOpenQuestions: false,
    sessionSummary: ""
  };

  const priorOpen = [...(context.openQuestions ?? [])];
  const oneShot = isOneShotTask(user);
  const preferenceLines = distillPreferenceLines(user);
  const answered = distillAnsweredOpenQuestion(user, priorOpen);

  if (answered) {
    uniquePush(facts.outputRules, answered);
    facts.clearOpenQuestions = true;
    for (const question of priorOpen) uniquePush(facts.resolvedQuestions, question);
  }

  if (!oneShot) {
    for (const line of preferenceLines) uniquePush(facts.outputRules, line);
    if (isReusableRuleRequest(user) && includesAny(user, USER_RULE_TERMS)) {
      uniquePush(facts.outputRules, user);
    }
    if (isReusableRuleRequest(user)) {
      uniquePush(facts.requestedRules, user);
    }
  } else if (isReusableRuleRequest(user) && includesAny(user, USER_RULE_TERMS)) {
    uniquePush(facts.outputRules, user);
    uniquePush(facts.requestedRules, user);
  }

  for (const fact of distillProjectFacts(user, assistant)) {
    uniquePush(facts.projectFacts, fact);
  }

  const asked = extractAskedLearningQuestion(assistant);
  if (asked && !facts.clearOpenQuestions) {
    uniquePush(facts.openQuestions, asked);
  }

  facts.sessionSummary = buildActiveSessionSummary(user, assistant, facts);
  return facts;
}

/**
 * Pre-action gap analysis: open a learning question when preference memory is insufficient.
 * Exported for unit tests.
 */
export function detectLearningGap(user, rulesText, existingOpenQuestions = []) {
  if (!isPreferenceSensitive(user)) {
    return { shouldAsk: false, question: "", openQuestions: [...existingOpenQuestions] };
  }
  if (hasRelevantPreference(user, rulesText)) {
    return { shouldAsk: false, question: "", openQuestions: [...existingOpenQuestions] };
  }
  const question = proposeLearningQuestion(user);
  const openQuestions = [...existingOpenQuestions];
  uniquePush(openQuestions, question);
  return { shouldAsk: true, question, openQuestions };
}

/** Compact PAHF guidance for system prompt injection. */
export function buildPersonalizationGuidance(input = {}) {
  const openQuestions = (input.openQuestions ?? []).filter(Boolean).slice(0, 3);
  const lines = [
    "Personalization loop (Hermes/PAHF-style):",
    "1. Pre-Action: if the current request is ambiguous/subjective and injected preferences do not cover it, ask ONE clarifying question BEFORE acting. Do not guess lasting taste.",
    "2. Grounding: apply injected user-output-rules, delivery preferences, and repo Project OS (NEWBRAIN.md); once a preference exists, act directly and do not re-ask the same topic.",
    "3. Post-Action: when the user corrects you or answers a learning question, treat it as durable preference learning (runtime will distill it).",
    "Ask at most one preference question per turn. Prefer executing when memory already answers the ambiguity.",
    "Durable architecture and project conventions belong in repo-root NEWBRAIN.md (agent may edit). Runtime preference files under .newbrain must not be edited with tools."
  ];
  if (openQuestions.length) {
    lines.push("Open learning questions for this project (ask before acting if still unresolved):");
    for (const question of openQuestions) lines.push(`- ${question}`);
  }
  const deliveryBlock = String(input.deliveryPreferencesText || "").trim();
  if (deliveryBlock) lines.push(deliveryBlock);
  return lines.join("\n");
}

/** Pre-turn gap for document.style when the user wants a document but no style memory exists. */
export function detectDocumentStyleLearningGap(user, hasStyleMemory, existingOpenQuestions = []) {
  if (!isDocumentDeliveryIntent(user)) {
    return { shouldAsk: false, question: "", openQuestions: [...existingOpenQuestions] };
  }
  if (isDocumentStyleSensitive(user) || hasStyleMemory) {
    return { shouldAsk: false, question: "", openQuestions: [...existingOpenQuestions] };
  }
  if (includesAny(user, ONE_SHOT_MARKERS)) {
    return { shouldAsk: false, question: "", openQuestions: [...existingOpenQuestions] };
  }
  const question = "待确认交付版式: 正文用什么字体和行距？（例如宋体、小四、行距1.5；也可说仅本次）";
  const openQuestions = [...existingOpenQuestions];
  uniquePush(openQuestions, question);
  return { shouldAsk: true, question, openQuestions };
}

async function upsertDeliveryRulesSummary(filePath, summaryLine) {
  const line = cleanLine(summaryLine);
  if (!line) return false;
  return withFileQueue(filePath, async () => {
    let source = await readText(filePath);
    if (!source) source = "# User Output Rules\n\n";
    const nextLines = source.split(/\r?\n/).filter((entry) => !/^- 交付版式:/.test(entry.trim()));
    if (!nextLines[nextLines.length - 1]?.trim()) nextLines.pop();
    nextLines.push(`- ${line}`, "");
    const next = nextLines.join("\n");
    if (next === source) return false;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, next, "utf8");
    return true;
  });
}

function isDurableLearnedRuleLine(line) {
  const text = cleanLine(line);
  if (!text) return false;
  if (DEFAULT_OUTPUT_RULES.includes(text)) return true;
  if (isReusableRuleRequest(text)) return true;
  if (/^(规则|偏好|修正|交付版式)[:：]/.test(text)) return true;
  if (isCorrectionOrPreference(text)) return true;
  return false;
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True when `pid` still exists (signal 0). EPERM means alive but inaccessible. */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") return true;
    return false;
  }
}

/**
 * Parse lock metadata written by acquireFileLock.
 * @returns {{ pid: number, createdAt: string, ageMs: number } | null}
 */
async function readLockMetadata(lockPath) {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    const pid = Number(parsed?.pid);
    const createdAt = String(parsed?.createdAt || "");
    const createdMs = Date.parse(createdAt);
    return {
      pid: Number.isInteger(pid) ? pid : NaN,
      createdAt,
      ageMs: Number.isFinite(createdMs) ? Math.max(0, Date.now() - createdMs) : Number.POSITIVE_INFINITY
    };
  } catch {
    return null;
  }
}

/**
 * Remove abandoned locks left by crashed agentd/desktop processes.
 * Clears when: metadata unreadable, holder PID is dead, or lock age >= LOCK_STALE_MS.
 * @returns {Promise<boolean>} true if the lock path is gone (or was cleared)
 */
async function tryClearStaleLock(lockPath) {
  const meta = await readLockMetadata(lockPath);
  if (!meta) {
    try {
      await fs.access(lockPath);
    } catch (error) {
      if (error?.code === "ENOENT") return true;
    }
    await fs.rm(lockPath, { force: true });
    return true;
  }
  const alive = isPidAlive(meta.pid);
  if (!alive || meta.ageMs >= LOCK_STALE_MS) {
    await fs.rm(lockPath, { force: true });
    return true;
  }
  return false;
}

async function describeLockHolder(lockPath) {
  const meta = await readLockMetadata(lockPath);
  if (!meta) return "holder=unknown/unreadable";
  const alive = isPidAlive(meta.pid);
  return `holderPid=${Number.isInteger(meta.pid) ? meta.pid : "?"} alive=${alive} ageMs=${Number.isFinite(meta.ageMs) ? Math.round(meta.ageMs) : "?"}`;
}

async function acquireFileLock(filePath) {
  const lockPath = `${filePath}.lock`;
  const startedAt = Date.now();
  while (true) {
    let handle;
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return async () => {
        try {
          await handle?.close();
        } finally {
          await fs.rm(lockPath, { force: true });
        }
      };
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (error?.code !== "EEXIST") throw error;
      // Crash leftovers must not block activate/workspace for the full timeout.
      if (await tryClearStaleLock(lockPath)) continue;
      if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
        // Final steal attempt in case the holder died while we waited.
        if (await tryClearStaleLock(lockPath)) continue;
        const holder = await describeLockHolder(lockPath);
        throw new Error(
          `Timed out waiting for user shadow lock: ${lockPath} (${holder}). `
          + "If no NewBrain/agentd process is writing this file, delete the .lock and retry thread activate."
        );
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

async function withFileQueue(filePath, action) {
  const previous = fileWriteQueues.get(filePath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const release = await acquireFileLock(filePath);
    try {
      return await action();
    } finally {
      await release();
    }
  });
  fileWriteQueues.set(filePath, current.finally(() => {
    if (fileWriteQueues.get(filePath) === current) fileWriteQueues.delete(filePath);
  }));
  return current;
}

async function appendUniqueUnlocked(filePath, header, lines) {
  const cleanLines = [...new Set(lines.map((line) => cleanLine(line)).filter(Boolean))];
  let source = await readText(filePath);
  if (!source) source = `${header}\n\n`;
  if (!cleanLines.length) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, source, "utf8");
    return false;
  }
  const nextLines = cleanLines.filter((line) => !source.includes(line));
  if (!nextLines.length) return false;
  const stamp = new Date().toISOString();
  const addition = [`\n## ${stamp}`, ...nextLines.map((line) => `- ${line}`), ""].join("\n");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${source.trimEnd()}\n${addition}`, "utf8");
  return true;
}

async function appendUnique(filePath, header, lines) {
  return withFileQueue(filePath, () => appendUniqueUnlocked(filePath, header, lines));
}

async function writeOpenQuestionsFile(filePath, openQuestions) {
  return withFileQueue(filePath, async () => {
    const unique = [...new Set(openQuestions.map((line) => cleanLine(line)).filter(Boolean))].slice(0, 8);
    const next = [
      "# Learning Open Questions",
      "",
      "Ask at most ONE of these before acting when preference memory is still empty for the topic. After the user answers, the runtime distills a durable preference and clears the question.",
      "",
      ...(unique.length ? unique.map((line) => `- ${line}`) : ["- (none)"]),
      ""
    ].join("\n");
    const source = await readText(filePath);
    if (source === next) return false;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, next, "utf8");
    return true;
  });
}

async function sanitizeOutputRules(filePath) {
  return withFileQueue(filePath, async () => {
    const source = await readText(filePath);
    const reusableRules = source.split(/\r?\n/)
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter((line) => isDurableLearnedRuleLine(line));
    const uniqueRules = [...new Set([...DEFAULT_OUTPUT_RULES, ...reusableRules])];
    const next = ["# User Output Rules", "", ...uniqueRules.map((line) => `- ${line}`), ""].join("\n");
    if (source === next) return false;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, next, "utf8");
    return true;
  });
}

/** Keep project-knowledge as a short candidate index (header + latest bullets). */
async function trimProjectKnowledgeIndex(filePath) {
  return withFileQueue(filePath, async () => {
    const source = await readText(filePath);
    if (!source.trim()) return false;
    const bullets = source.split(/\r?\n/)
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
    if (bullets.length <= PROJECT_KNOWLEDGE_INDEX_LIMIT) return false;
    const kept = bullets.slice(-PROJECT_KNOWLEDGE_INDEX_LIMIT);
    const next = ["# Project Knowledge", "", ...kept.map((line) => `- ${line}`), ""].join("\n");
    await fs.writeFile(filePath, next, "utf8");
    return true;
  });
}

function buildProjectOsMarkdown(projectName, workspacePath) {
  return `# ${projectName} Project OS

This file is the **repo-root source of truth** for how NewBrain (and any compatible agent) should work in this workspace.
Keep it short, accurate, and version-controlled with the project. Prefer updating this file over burying facts in chat.

## Overview

- Project path: \`${workspacePath}\`
- Purpose: _(fill in)_

## How to build / test

- Build: _(fill in)_
- Test: _(fill in)_
- Lint / typecheck: _(fill in)_

## Layout

- Key directories and entrypoints: _(fill in)_

## Conventions

- Do:
  - Follow existing patterns in this repo
  - Keep durable architecture notes in this file (\`NEWBRAIN.md\`)
- Don't:
  - Edit \`.newbrain/skills/*/references/*\` with tools (runtime owns preference learning)
  - Invent project conventions that contradict this file

## Working notes

- _(Agent and humans may append durable decisions here)_
`;
}

/** One-time upgrade: seed NEWBRAIN.md from an existing CLAUDE.md / AGENTS.md body. */
function buildMigratedProjectOsMarkdown(projectName, legacyFileName, legacyContent) {
  const body = String(legacyContent || "").trim();
  return `# ${projectName} Project OS

> Migrated from \`${legacyFileName}\` for NewBrain Project OS compatibility. Edit this file going forward; the original \`${legacyFileName}\` was left unchanged.

${body}
`;
}

function buildSkillMarkdown(projectName, brainWorkspaceKey = "explore") {
  const sceneKey = normalizeSceneKey(brainWorkspaceKey);
  return `---
name: ${safeName(projectName)}-project-manager
description: Always-on Project OS + preference shadow for this workspace. Own PAHF personalization under .newbrain; durable architecture lives in repo-root NEWBRAIN.md. Enforce scene Tools sub-architecture (except explore) and seeded programming guardrails when coding.
metadata:
  short-description: Project OS, scene Tools, preferences, coding guardrails
---

# ${projectName} Project Manager

This skill is the always-on shadow for ${projectName}. It combines Claude Code–style **Project OS** (repo-root \`NEWBRAIN.md\`) with a Hermes/PAHF **personalization** loop (runtime-managed preference files), **scene Tools routing**, and seeded **programming guardrails** for reliable code edits.

## Project OS (repo layer)

1. Durable project truth lives in repo-root \`NEWBRAIN.md\` (also honor \`CLAUDE.md\` / \`AGENTS.md\` if present and \`NEWBRAIN.md\` is empty).
2. When architecture, build/test commands, directory layout, or lasting conventions change, **update \`NEWBRAIN.md\` with workspace tools**.
3. You may edit \`NEWBRAIN.md\`, \`docs/**\`, and normal project source files.
4. Do **not** use tools to create or edit \`.newbrain\`, \`.codebuddy\`, skill \`references/\`, memory, or session-summary files — the runtime owns those after each turn.

## ${SCENE_TOOLS_TEMPLATE_MARKER}

1. Read \`references/${SCENE_KNOWLEDGE_FILENAME}\` and \`references/${SCENE_TOOLS_ROUTING_FILENAME}\` for this project's BRAIN scene (\`${sceneKey}\`).
2. Except **场景学习探索 / explore**, every deliverable that touches the scene MUST use the registered **right-side Tools sub-architecture** (music DAW 生成/音轨/标记切片/导出, video pipeline, quant panels, data Julius, document review, etc.). Do not satisfy with prose-only or bare gateway media tools that skip the panel.
3. Prefer scene Agent tools (\`music.*\`, \`video.*\`, \`quant.*\`, \`data.*\`, document tools) over bare Auto \`music_generate\` / \`video_generate\` when those scene tools are registered.
4. After Tools writes, tell the user which right-side tab to inspect.

## Required Workflow (PAHF)

1. The NewBrain runtime injects preference references (\`user-output-rules\`, open questions) and Project OS text into context.
2. **Pre-Action Clarification**: If the request is ambiguous or subjective AND preference memory does not answer it, ask ONE clarifying question BEFORE editing, generating, or committing.
3. **Preference Grounding**: Apply injected user rules and \`NEWBRAIN.md\`. Once a preference exists, act directly and do not re-ask.
4. **Post-Action Learning**: When the user corrects you or answers a learning question, state the durable preference clearly; the runtime distills it into references. Do not wait for "记住/以后".
5. Do not call tools merely to re-read injected preference references.
6. Ask at most one preference question per turn. Prefer completing the task when memory already covers the ambiguity.

## ${PROGRAMMING_SKILL_TEMPLATE_MARKER}

When the user request edits, generates, completes, or documents source code—especially Java/Spring on Windows—follow the seeded programming-skill pack:

1. Read and enforce \`references/programming-guardrails.md\` (core rules, workspace retrieval via \`workspace.glob\`/\`workspace.grep\`/\`workspace.read\`, encoding, patch strategy, recovery, real-fix evaluation).
2. When touching any \`.java\` file, also enforce \`references/java-javadoc-rules.md\`. Missing required method Javadoc in a touched type means the change is incomplete.
3. Before designing or implementing Spring/backend modules, follow \`references/backend-technical-design-framework.md\`; mark unused sections \`N/A\` with a concrete reason.
4. Prefer smallest safe patches; preserve UTF-8 without BOM; never claim a coding fix complete without stating verified vs unverified evidence.
5. For locating or reading project source, use platform tools \`workspace.glob\` / \`workspace.grep\` / \`workspace.read\` (aliases \`glob\` / \`grep\` / \`read\`)—not unbounded shell recursive search.

## Runtime knowledge files (do not edit with tools)

- \`references/user-output-rules.md\`: distilled habits, preferences, and corrections.
- \`references/${DELIVERY_PREFERENCES_FILENAME}\`: typed delivery preferences (document.style); runtime-owned JSON.
- \`references/learning-open-questions.md\`: open preference questions to ask before acting.
- \`references/session-digest.md\`: append-only session summaries.
- \`references/project-knowledge.md\`: short NEWBRAIN.md candidate index only (not the architecture source of truth).
- \`references/${SCENE_KNOWLEDGE_FILENAME}\`: BRAIN scene rules knowledge baseline for this project.
- \`references/${SCENE_TOOLS_ROUTING_FILENAME}\`: mandatory right-side Tools sub-architecture routing.
- \`references/programming-guardrails.md\`: coding reliability, encoding, Java safety, Spring structure, patch/recovery, evaluation.
- \`references/java-javadoc-rules.md\`: mandatory Java method Javadoc rules.
- \`references/backend-technical-design-framework.md\`: mandatory Spring/backend design sections.
`;
}

export class UserShadow {
  constructor(input = {}) {
    this.workspacePath = path.resolve(input.workspacePath);
    this.projectName = input.projectName || path.basename(this.workspacePath);
    this.brainWorkspaceKey = normalizeSceneKey(input.brainWorkspaceKey);
    this.skillName = `${safeName(this.projectName)}-project-manager`;
    this.skillPath = path.join(this.workspacePath, ".newbrain", "skills", this.skillName);
    this.referencesPath = path.join(this.skillPath, "references");
  }

  openQuestionsPath() {
    return path.join(this.referencesPath, "learning-open-questions.md");
  }

  outputRulesPath() {
    return path.join(this.referencesPath, "user-output-rules.md");
  }

  deliveryPreferencesPath() {
    return path.join(this.referencesPath, DELIVERY_PREFERENCES_FILENAME);
  }

  projectOsPath() {
    return path.join(this.workspacePath, PROJECT_OS_FILENAME);
  }

  async readDeliveryPreferences() {
    try {
      const raw = JSON.parse(await readText(this.deliveryPreferencesPath()) || "{}");
      return parseDeliveryPreferences(raw);
    } catch {
      return emptyDeliveryPreferences();
    }
  }

  async writeDeliveryPreferences(file) {
    const next = parseDeliveryPreferences(file);
    await fs.mkdir(this.referencesPath, { recursive: true });
    await fs.writeFile(this.deliveryPreferencesPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  /**
   * Clear document.style from thread and/or project.
   * @param {"thread"|"project"|"both"} scope
   */
  async clearDocumentStyle(scope = "both", threadFile = null) {
    await this.ensureProjectSkill();
    const changed = [];
    let threadDeliveryPreferences = parseDeliveryPreferences(threadFile);
    let projectDeliveryPreferences = await this.readDeliveryPreferences();
    if (scope === "thread" || scope === "both") {
      threadDeliveryPreferences = clearDocumentStyleDomain(threadDeliveryPreferences);
      changed.push("thread-delivery-preferences");
    }
    if (scope === "project" || scope === "both") {
      projectDeliveryPreferences = clearDocumentStyleDomain(projectDeliveryPreferences);
      await this.writeDeliveryPreferences(projectDeliveryPreferences);
      changed.push("delivery-preferences");
    }
    if (changed.length) {
      const projectStyle = projectDeliveryPreferences.domains?.[DOCUMENT_STYLE_DOMAIN]?.values;
      await upsertDeliveryRulesSummary(
        this.outputRulesPath(),
        scope === "thread" && projectStyle && Object.keys(projectStyle).length
          ? deliveryRulesSummaryLine(projectStyle)
          : "交付版式: （已清除）"
      );
      await sanitizeOutputRules(this.outputRulesPath());
    }
    return {
      changed,
      threadDeliveryPreferences,
      projectDeliveryPreferences,
      deliveryPreferencesText: formatDeliveryPreferencesPromptBlock({
        project: projectDeliveryPreferences,
        thread: threadDeliveryPreferences
      })
    };
  }

  /** Promote current thread document.style into project defaults. */
  async pinThreadStyleToProject(threadFile) {
    await this.ensureProjectSkill();
    const threadDeliveryPreferences = parseDeliveryPreferences(threadFile);
    const style = threadDeliveryPreferences.domains[DOCUMENT_STYLE_DOMAIN];
    if (!style?.values || !Object.keys(style.values).length) {
      return {
        changed: [],
        pinned: false,
        threadDeliveryPreferences,
        projectDeliveryPreferences: await this.readDeliveryPreferences()
      };
    }
    const projectDeliveryPreferences = applyDocumentStyleDomain(await this.readDeliveryPreferences(), {
      ...style,
      scope: "project",
      source: style.source || "user_explicit",
      confidence: Math.max(Number(style.confidence) || 0.9, 0.9),
      summary: style.summary || summarizeDocumentStyle(style.values),
      updatedAt: new Date().toISOString()
    });
    await this.writeDeliveryPreferences(projectDeliveryPreferences);
    await upsertDeliveryRulesSummary(this.outputRulesPath(), deliveryRulesSummaryLine(style.values));
    await sanitizeOutputRules(this.outputRulesPath());
    return {
      changed: ["delivery-preferences", "user-output-rules"],
      pinned: true,
      threadDeliveryPreferences,
      projectDeliveryPreferences,
      deliveryPreferencesText: formatDeliveryPreferencesPromptBlock({
        project: projectDeliveryPreferences,
        thread: threadDeliveryPreferences
      })
    };
  }

  async getDeliveryPreferenceUiState(threadFile = null) {
    const openQuestions = await this.readOpenQuestions();
    return buildDeliveryPreferenceUiState({
      thread: threadFile,
      project: await this.readDeliveryPreferences(),
      openQuestions
    });
  }

  /**
   * Ensure repo-root NEWBRAIN.md exists without clobbering user history.
   * Upgrade rules:
   * - Never overwrite a hand-written NEWBRAIN.md
   * - If NEWBRAIN is missing (or only the stock scaffold) and CLAUDE.md/AGENTS.md
   *   already has real content, seed NEWBRAIN.md from that legacy file once
   * - Otherwise create the default scaffold
   */
  async ensureProjectOsFiles() {
    const filePath = this.projectOsPath();
    const existing = await readText(filePath);
    const existingIsReal = existing.trim() && !isDefaultProjectOsScaffold(existing);
    if (existingIsReal) {
      return { created: false, path: filePath, seededFrom: null };
    }

    await fs.mkdir(this.workspacePath, { recursive: true });

    for (const legacyName of PROJECT_OS_LEGACY_FILES) {
      const legacyPath = path.join(this.workspacePath, legacyName);
      const legacyText = await readText(legacyPath);
      if (!legacyText.trim() || isDefaultProjectOsScaffold(legacyText)) continue;
      await fs.writeFile(
        filePath,
        buildMigratedProjectOsMarkdown(this.projectName, legacyName, legacyText),
        "utf8"
      );
      return { created: true, path: filePath, seededFrom: legacyName };
    }

    if (existing.trim()) {
      return { created: false, path: filePath, seededFrom: null };
    }

    await fs.writeFile(filePath, buildProjectOsMarkdown(this.projectName, this.workspacePath), "utf8");
    return { created: true, path: filePath, seededFrom: null };
  }

  async ensureProjectSkill() {
    await fs.mkdir(this.workspacePath, { recursive: true });
    await fs.mkdir(this.referencesPath, { recursive: true });
    await this.ensureProjectOsFiles();
    const skillFile = path.join(this.skillPath, "SKILL.md");
    const existingSkill = await readText(skillFile);
    if (!existingSkill
      || existingSkill.includes("Read `references/user-output-rules.md` before producing user-facing output.")
      || !existingSkill.includes("PAHF")
      || !existingSkill.includes("Pre-Action Clarification")
      || !existingSkill.includes("NEWBRAIN.md")
      || !existingSkill.includes("Project OS")
      || !existingSkill.includes(PROGRAMMING_SKILL_TEMPLATE_MARKER)
      || !existingSkill.includes("references/programming-guardrails.md")
      || !existingSkill.includes("workspace.glob")
      || !existingSkill.includes(SCENE_TOOLS_TEMPLATE_MARKER)
      || !existingSkill.includes(SCENE_KNOWLEDGE_FILENAME)) {
      await fs.writeFile(skillFile, buildSkillMarkdown(this.projectName, this.brainWorkspaceKey), "utf8");
    }
    await ensureProgrammingSkillReferences(this.referencesPath, fs.writeFile.bind(fs), fs.mkdir.bind(fs));
    await ensureSceneProjectInit({
      workspacePath: this.workspacePath,
      projectName: this.projectName,
      brainWorkspaceKey: this.brainWorkspaceKey
    });
    const outputRulesPath = this.outputRulesPath();
    await appendUnique(outputRulesPath, "# User Output Rules", DEFAULT_OUTPUT_RULES);
    await sanitizeOutputRules(outputRulesPath);
    await appendUnique(path.join(this.referencesPath, "project-knowledge.md"), "# Project Knowledge", [
      `Project path: ${this.workspacePath}`,
      `BRAIN scene: ${this.brainWorkspaceKey}`,
      `Architecture and lasting conventions live in repo-root ${PROJECT_OS_FILENAME}; this file only keeps a short NEWBRAIN candidate index.`,
      `Scene Tools routing: see references/${SCENE_TOOLS_ROUTING_FILENAME} and references/${SCENE_KNOWLEDGE_FILENAME}.`
    ]);
    await appendUnique(path.join(this.referencesPath, "session-digest.md"), "# Session Digest", []);
    if (!(await readText(this.deliveryPreferencesPath()))) {
      await this.writeDeliveryPreferences(emptyDeliveryPreferences());
    }
    const openPath = this.openQuestionsPath();
    if (!(await readText(openPath))) {
      await writeOpenQuestionsFile(openPath, []);
    }
    return { skillName: this.skillName, skillPath: this.skillPath, brainWorkspaceKey: this.brainWorkspaceKey };
  }

  async readOpenQuestions() {
    return parseOpenQuestionLines(await readText(this.openQuestionsPath()))
      .filter((line) => line !== "(none)");
  }

  /**
   * Pre-turn hook: open learning questions when the request is preference-sensitive
   * and durable preference memory does not cover it.
   */
  async prepareLearningTurn(user, options = {}) {
    await this.ensureProjectSkill();
    const rulesText = await readText(this.outputRulesPath());
    const existingOpen = await this.readOpenQuestions();
    const projectDelivery = await this.readDeliveryPreferences();
    const threadHasStyle = hasDocumentStyle(options.threadDeliveryPreferences);
    const projectHasStyle = hasDocumentStyle(projectDelivery);
    const gap = detectLearningGap(user, rulesText, existingOpen);
    const styleGap = detectDocumentStyleLearningGap(
      user,
      threadHasStyle || projectHasStyle,
      gap.shouldAsk ? gap.openQuestions : existingOpen
    );
    const shouldAsk = gap.shouldAsk || styleGap.shouldAsk;
    const openQuestions = shouldAsk
      ? (styleGap.shouldAsk ? styleGap.openQuestions : gap.openQuestions)
      : existingOpen;
    const changed = [];
    if (shouldAsk) {
      if (await writeOpenQuestionsFile(this.openQuestionsPath(), openQuestions)) {
        changed.push("learning-open-questions");
      }
    }
    const deliveryPreferencesText = formatDeliveryPreferencesPromptBlock({
      project: projectDelivery,
      thread: options.threadDeliveryPreferences
    });
    return {
      skillName: this.skillName,
      skillPath: this.skillPath,
      changed,
      shouldAsk,
      openQuestions,
      deliveryPreferencesText,
      personalizationGuidance: buildPersonalizationGuidance({ openQuestions, deliveryPreferencesText })
    };
  }

  async absorbExchange(input) {
    await this.ensureProjectSkill();
    const priorOpen = await this.readOpenQuestions();
    const facts = extractFacts(input.user, input.assistant, { openQuestions: priorOpen });
    const changed = [];
    if (await appendUnique(this.outputRulesPath(), "# User Output Rules", facts.outputRules)) {
      changed.push("user-output-rules");
    }
    // Short NEWBRAIN candidate index only — avoid unbounded architecture dumps.
    const knowledgePath = path.join(this.referencesPath, "project-knowledge.md");
    const trimmedFacts = facts.projectFacts.slice(0, 2);
    if (trimmedFacts.length && await appendUnique(knowledgePath, "# Project Knowledge", trimmedFacts)) {
      changed.push("project-knowledge");
      await trimProjectKnowledgeIndex(knowledgePath);
    }
    if (await appendUnique(path.join(this.referencesPath, "session-digest.md"), "# Session Digest", [facts.sessionSummary])) {
      changed.push("session-digest");
    }
    if (await appendUnique(this.outputRulesPath(), "# User Output Rules", facts.requestedRules)) {
      changed.push("requested-rules");
    }

    let nextOpen = priorOpen;
    if (facts.clearOpenQuestions) {
      nextOpen = [];
    } else if (facts.openQuestions.length) {
      nextOpen = [...priorOpen];
      for (const question of facts.openQuestions) uniquePush(nextOpen, question);
    }
    if (await writeOpenQuestionsFile(this.openQuestionsPath(), nextOpen)) {
      changed.push("learning-open-questions");
    }

    const deliveryUpdate = extractDeliveryPreferenceUpdate({
      user: input.user,
      assistant: input.assistant,
      openQuestions: priorOpen
    });
    let threadDeliveryPreferences = parseDeliveryPreferences(input.threadDeliveryPreferences);
    let projectDeliveryPreferences = await this.readDeliveryPreferences();
    if (deliveryUpdate?.clear) {
      if (deliveryUpdate.promoteToProject || deliveryUpdate.scope === "project") {
        projectDeliveryPreferences = clearDocumentStyleDomain(projectDeliveryPreferences);
        await this.writeDeliveryPreferences(projectDeliveryPreferences);
        changed.push("delivery-preferences");
      }
      threadDeliveryPreferences = clearDocumentStyleDomain(threadDeliveryPreferences);
      changed.push("thread-delivery-preferences");
      await upsertDeliveryRulesSummary(this.outputRulesPath(), "交付版式: （已清除）");
    } else if (deliveryUpdate && deliveryUpdate.scope !== "turn") {
      const domain = {
        scope: deliveryUpdate.promoteToProject ? "project" : "thread",
        values: deliveryUpdate.values,
        source: deliveryUpdate.source,
        confidence: deliveryUpdate.confidence,
        summary: deliveryUpdate.summary
      };
      threadDeliveryPreferences = applyDocumentStyleDomain(threadDeliveryPreferences, {
        ...domain,
        scope: "thread"
      });
      changed.push("thread-delivery-preferences");
      if (deliveryUpdate.promoteToProject || deliveryUpdate.scope === "project") {
        projectDeliveryPreferences = applyDocumentStyleDomain(projectDeliveryPreferences, {
          ...domain,
          scope: "project"
        });
        await this.writeDeliveryPreferences(projectDeliveryPreferences);
        changed.push("delivery-preferences");
      }
      if (await upsertDeliveryRulesSummary(this.outputRulesPath(), deliveryRulesSummaryLine(deliveryUpdate.values))) {
        changed.push("user-output-rules");
      }
    }

    await sanitizeOutputRules(this.outputRulesPath());
    const deliveryPreferencesText = formatDeliveryPreferencesPromptBlock({
      project: projectDeliveryPreferences,
      thread: threadDeliveryPreferences
    });
    return {
      skillName: this.skillName,
      skillPath: this.skillPath,
      changed,
      openQuestions: nextOpen,
      deliveryPreferenceUpdate: deliveryUpdate,
      threadDeliveryPreferences,
      projectDeliveryPreferences,
      deliveryPreferencesText,
      personalizationGuidance: buildPersonalizationGuidance({ openQuestions: nextOpen, deliveryPreferencesText })
    };
  }
}
