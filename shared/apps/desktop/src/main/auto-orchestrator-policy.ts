import { GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED } from "../shared/product-flags.js";
import type { AutoTaskClass } from "./model-auto-router.ts";
import {
  looksLikeImageGenerationRequest,
  looksLikeMusicGenerationRequest,
  looksLikeVideoGenerationRequest
} from "./model-auto-router.ts";
import { isGreetingText } from "./agent-orchestrator-policy.ts";
import {
  buildResearchDelegateTurnConstraint,
  buildResearchLeadInstruction,
  buildResearchPlan
} from "./research-plan-policy.ts";

/** Auto parent should delegate multi-step / specialist work instead of executing it inline. */
export function shouldAutoDelegateHeavyWork(input: {
  taskClass?: AutoTaskClass | string;
  latestUserText?: string;
  /** When an Expert Marketplace expert is summoned, suppress generic Auto strong-delegate. */
  expertSummonActive?: boolean;
}): boolean {
  if (input.expertSummonActive) return false;
  const taskClass = String(input.taskClass || "general") as AutoTaskClass;
  const text = String(input.latestUserText || "").trim();
  if (!text) return false;
  if (isGreetingText(text)) return false;
  if (taskClass === "chat") return false;
  if (looksLikeImageGenerationRequest(text) || looksLikeVideoGenerationRequest(text) || looksLikeMusicGenerationRequest(text)) {
    return false;
  }
  if (taskClass === "code" || taskClass === "research") return true;
  if (GOVERNMENT_RESEARCH_WRITING_PRODUCT_ENABLED && taskClass === "gov_write") return true;
  if (text.length <= 40) return false;
  return taskClass === "general";
}

/** Lightweight companion path for greetings and short Auto chat. */
export function buildAutoModeLightCompanionInstruction(): string {
  return [
    "Auto mode (companion): handle this turn directly in concise Chinese.",
    "Do not delegate to child agents, do not spawn tools, and do not run project learning writes for greetings or short casual chat.",
    "Never call news_search_free, web.search_paid, or web.fetch_page for greetings or thanks.",
    "NewBrain knowledge learning runs separately via project-manager shadow on substantive tasks."
  ].join(" ");
}

/** Parent Auto orchestrator must schedule child agents for main delivery work. */
export function buildAutoModeOrchestratorInstruction(input?: {
  taskClass?: AutoTaskClass | string;
  latestUserText?: string;
}): string {
  const taskClass = String(input?.taskClass || "general");
  const researchBlock = taskClass === "research"
    ? buildResearchLeadInstruction(buildResearchPlan({ request: String(input?.latestUserText || "") }))
    : "For research turns, prefer researcher with Search→Fetch (news_search_free then web.fetch_page) and cite URLs.";
  return [
    "Auto mode (orchestrator): you are the lightweight parent coordinator, not the primary worker.",
    "Main tasks (coding, research, multi-step delivery, long-form writing, file changes) MUST be started with agent.delegate to a suitable child role (planner/researcher/editor/verifier) before you do the work yourself.",
    "Use agent.wait to collect child results, resolve conflicts, and produce the final unified Chinese answer for the user.",
    "Handle directly without delegation only when: greetings/thanks/short Q&A, capability questions, image_generate/video_generate/music_generate or scene music.song.generate/video.shot.generate tool calls, or a trivial one-step action under ~40 Chinese characters.",
    "Do not personally run long shell/file edit loops, deep research, or full document implementation when agent.delegate is available.",
    "Preference and project knowledge learning still happen via project-manager shadow; your job is to coordinate execution, not hoard every tool call.",
    "Start independent children before agent.wait. If a child fails, merge evidence and finish; do not empty-loop re-delegate.",
    researchBlock
  ].join(" ");
}

export function buildAutoModeRoleInstruction(input: {
  taskClass?: AutoTaskClass | string;
  latestUserText?: string;
  expertSummonActive?: boolean;
}): string {
  if (input.expertSummonActive) {
    return [
      "Auto mode (expert summoned): you are the summoned expert lead, not the generic Auto orchestrator.",
      "Follow the expert SOP for whether and when to agent.delegate to named member roles.",
      "Do not force planner/researcher/editor/verifier strong-delegate unless the expert SOP requires it."
    ].join(" ");
  }
  return shouldAutoDelegateHeavyWork(input)
    ? buildAutoModeOrchestratorInstruction(input)
    : buildAutoModeLightCompanionInstruction();
}

/** Turn-level constraint appended to the latest user message when Auto must delegate first. */
export function buildAutoDelegateTurnConstraint(input: {
  taskClass?: AutoTaskClass | string;
  latestUserText?: string;
  expertSummonActive?: boolean;
}): string {
  if (!shouldAutoDelegateHeavyWork(input)) return "";
  const request = String(input.latestUserText || "").trim();
  const taskClass = String(input.taskClass || "general");
  if (taskClass === "research") {
    return buildResearchDelegateTurnConstraint(request);
  }
  return [
    "【Auto 编排约束】本回合属于主任务交付。你必须先调用 agent.delegate 将下方完整用户请求委派给合适子 Agent（planner/researcher/editor/verifier），再用 agent.wait 收敛结果后统一答复。",
    "禁止由当前父会话直接执行长链路 shell、批量文件修改、深度调研或完整文稿实现。",
    request ? `原始用户请求：${request}` : ""
  ].filter(Boolean).join("\n");
}

export function appendAutoDelegateTurnConstraint<T extends { role: string; content?: string }>(
  messages: T[],
  input: { taskClass?: AutoTaskClass | string; latestUserText?: string; expertSummonActive?: boolean }
): T[] {
  const constraint = buildAutoDelegateTurnConstraint(input);
  if (!constraint) return messages;
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return messages;
  const content = String(messages[lastUserIndex].content || "").trim();
  if (content.includes("【Auto 编排约束】") || content.includes("【Research 编排约束】")) return messages;
  return messages.map((message, index) =>
    index === lastUserIndex ? { ...message, content: `${constraint}\n\n${content}` } : message
  );
}
