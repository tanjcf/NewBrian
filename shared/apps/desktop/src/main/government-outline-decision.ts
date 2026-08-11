import type { PersistedGoalSnapshot } from "./codex-storage.js";
import { extractFirstJsonObject } from "./json-extraction.js";

export type GovernmentOutlineDecision = {
  questionId: string;
  outline: string;
  prompt: string;
  options: Array<{ label: string; description: string; recommended: boolean }>;
};

export function buildGovernmentOutlineSource(
  generatedContent: string,
  plan: Array<{ title: string; result: string }> = []
) {
  const durableContext = plan
    .map((step) => `${step.title}: ${step.result}`.trim())
    .filter((line) => !line.endsWith(":"))
    .join("\n")
    .slice(0, 8_000);
  return [
    String(generatedContent ?? "").trim(),
    durableContext ? `Verified workflow context:\n${durableContext}` : ""
  ].filter(Boolean).join("\n\n");
}

export function extractVisibleGovernmentOutline(content: string) {
  const source = String(content ?? "").trim();
  const markers = ["## 写作提纲", "写作提纲", "一、"];
  const starts = markers.map((marker) => source.lastIndexOf(marker)).filter((index) => index >= 0);
  const start = starts.length ? Math.max(...starts) : 0;
  return source.slice(start)
    .replace(/(?:提纲已生成，但原生确认选项生成失败|请重试当前步骤)[\s\S]*$/u, "")
    .trim();
}

/**
 * Renders the raw outline as styled markdown for the chat view: a versioned
 * title, horizontal rules, one paragraph per section, and a closing hint.
 * The raw outline (not this formatted text) stays in the durable plan.
 */
export function formatGovernmentOutlineMarkdown(outline: string, revised = false) {
  const source = String(outline ?? "")
    .replace(/(?:提纲已生成，但原生确认选项生成失败|请重试当前步骤)[\s\S]*$/u, "")
    .trim();
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return source;
  const headingMatch = lines[0].match(/^#{1,6}\s*(.+)$/u);
  const isSectionLine = (line: string) => /^(?:[一二三四五六七八九十]+[、.]|\d+[、.)])/u.test(line);
  const heading = headingMatch
    ? headingMatch[1].trim()
    : !isSectionLine(lines[0]) && /(?:提纲|大纲)/u.test(lines[0]) ? lines[0] : "";
  const body = heading ? lines.slice(1) : lines;
  return [
    `### 文档大纲 · ${revised ? "修订版" : "第1版"}`,
    heading && !/^文档大纲/u.test(heading) ? `**${heading}**` : "",
    "---",
    ...body,
    "---",
    "结构没有问题，可以直接选择下方「确认」选项；需要调整，请直接输入修改内容。"
  ].filter(Boolean).join("\n\n");
}

export function buildFallbackGovernmentOutlineDecision(outline: string): GovernmentOutlineDecision {
  const visibleOutline = extractVisibleGovernmentOutline(outline);
  if (!isCompleteGovernmentOutline(visibleOutline)) {
    throw new Error("Cannot build a fallback decision without a complete visible outline.");
  }
  return {
    questionId: "outline-confirmation",
    outline: visibleOutline,
    prompt: "请确认以上提纲，或选择需要调整的方向：",
    options: [
      { label: "确认提纲，继续撰写", description: "按当前提纲和事实边界形成正文。", recommended: true },
      { label: "调整部署重点", description: "保留整体结构，修改重点任务的侧重或顺序。", recommended: false },
      { label: "调整整体结构", description: "调整开场、部署和收束部分的结构与篇幅。", recommended: false }
    ]
  };
}

export function isCompleteGovernmentOutline(content: string) {
  const normalized = String(content ?? "").replace(/\s+/g, "").trim();
  if (normalized.length < 30) return false;
  const structuralMarkers = String(content ?? "").match(/(?:^|\n)\s*(?:[一二三四五六七八九十]+[、.]|\d+[、.)])/g) ?? [];
  const sections = extractGovernmentOutlineSections(content);
  const clarificationOnly = sections.length > 0 && sections.every((section) =>
    /(?:公司\/单位类型|公司名称|具体数据和成绩|是否有|请选择|缺失信息)/u.test(section)
  );
  return structuralMarkers.length >= 2 && !clarificationOnly;
}

export function expandDurableOutlineResult(result: string) {
  const source = String(result ?? "").trim();
  if (!source || isCompleteGovernmentOutline(source)) return source;
  const body = source.replace(/^.{0,12}(?:\u63d0\u7eb2|outline)[\uff1a:]\s*/iu, "");
  const parts = body
    .split(/(?:\u2192|->|\u21d2|\uff1b|;)/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return source;
  const numerals = ["\u4e00", "\u4e8c", "\u4e09", "\u56db", "\u4e94", "\u516d", "\u4e03", "\u516b"];
  return [
    "## \u5199\u4f5c\u63d0\u7eb2",
    ...parts.slice(0, numerals.length).map((part, index) => `${numerals[index]}\u3001${part}`)
  ].join("\n");
}
export function extractGovernmentOutlineSections(outline: string) {
  return String(outline ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(/^(?:[一二三四五六七八九十]+[、.]|\d+[、.)])\s*(.+)$/u)?.[1]?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 8);
}

export function expandGovernmentDraftPlanByOutline(
  plan: PersistedGoalSnapshot["plan"],
  outline: string
) {
  const sections = extractGovernmentOutlineSections(outline);
  if (sections.length < 2) return plan;
  const isDraftStep = (step: PersistedGoalSnapshot["plan"][number]) =>
    /^(?:draft(?:-section-)?)/i.test(step.stepId)
    || /\u8d77\u8349|\u6b63\u6587|\u64b0\u5199|\u521d\u7a3f/i.test(step.title);
  const draftIndex = plan.findIndex(isDraftStep);
  if (draftIndex < 0) return plan;
  const original = plan[draftIndex];
  let draftEnd = draftIndex + 1;
  while (draftEnd < plan.length && isDraftStep(plan[draftEnd])) draftEnd += 1;
  const sectionSteps = sections.map((title, index) => ({
    ...original,
    stepId: `draft-section-${index + 1}`,
    title: `分段撰写：${title.slice(0, 60)}`,
    description: `只依据已确认提纲和已提供素材生成第 ${index + 1} 部分；完成后记录该段结果，再继续下一部分。`,
    status: "pending" as const,
    result: ""
  }));
  return [...plan.slice(0, draftIndex), ...sectionSteps, ...plan.slice(draftEnd)];
}

export function buildGovernmentOutlineDecisionRequest(userRequest: string, outline: string) {
  return [
    "Generate the native outline-confirmation decision for a government-writing workflow.",
    "The options must be derived from the actual outline and materially change what will be drafted.",
    "Return JSON only: {\"questionId\":\"outline-confirmation\",\"outline\":\"...\",\"prompt\":\"...\",\"options\":[{\"label\":\"...\",\"description\":\"...\",\"recommended\":true}]}",
    "outline must be the complete visible writing outline, not a workflow summary or a claim that it was shown elsewhere.",
    "Treat the user request and verified workflow context as the complete fact boundary. Do not add percentages, rates, trends, operational achievements, deployments, targets, or causal claims that are not explicitly present.",
    "Preserve constrained wording exactly; never transform '无较大及以上安全事故' into any expression beginning with '零'.",
    "Use Chinese. Provide 2 or 3 mutually exclusive options and exactly one recommended option.",
    "Normally include confirm-and-continue plus one or two concrete adjustment directions. Do not list internal workflow steps.",
    "",
    `User request: ${userRequest}`,
    "",
    `Generated outline: ${outline}`
  ].join("\n");
}

export function parseGovernmentOutlineDecision(content: string): GovernmentOutlineDecision {
  const jsonText = extractFirstJsonObject(content);
  if (!jsonText) throw new Error("Outline decision model did not return JSON.");
  const parsed = JSON.parse(jsonText) as Partial<GovernmentOutlineDecision>;
  const outline = String(parsed.outline ?? "").trim();
  const prompt = String(parsed.prompt ?? "").trim();
  const options = Array.isArray(parsed.options)
    ? parsed.options.map((option) => ({
        label: String(option?.label ?? "").trim(),
        description: String(option?.description ?? "").trim(),
        recommended: option?.recommended === true
      })).filter((option) => option.label && option.description)
    : [];
  if (!isCompleteGovernmentOutline(outline) || !prompt || options.length < 2 || options.length > 3) {
    throw new Error("Outline decision requires a complete outline, a prompt, and two or three complete options.");
  }
  if (new Set(options.map((option) => option.label)).size !== options.length) {
    throw new Error("Outline decision option labels must be unique.");
  }
  if (options.filter((option) => option.recommended).length !== 1) {
    throw new Error("Outline decision requires exactly one recommended option.");
  }
  return { questionId: "outline-confirmation", outline, prompt, options };
}

export function isLegacyGovernmentOutlineStep(step: { stepId: string; title: string }) {
  const identity = `${step.stepId} ${step.title}`;
  return /outline|\u63d0\u7eb2|\u5927\u7eb2/i.test(identity)
    && !/specification|\u89c4\u683c/i.test(identity);
}

export function isLegacyGovernmentOutlineConfirmationStep(step: { stepId: string; title: string }) {
  const identity = `${step.stepId} ${step.title}`;
  return isLegacyGovernmentOutlineStep(step)
    && /confirm|\u786e\u8ba4|outline-confirmation/i.test(identity);
}

/** Modern specification-first plans must never enter the legacy outline decision path. */
export function planHasLegacyGovernmentOutlineSteps(
  plan: Array<{ stepId: string; title: string }> | null | undefined
) {
  return Array.isArray(plan) && plan.some((step) => isLegacyGovernmentOutlineStep(step));
}

export function shouldRunGovernmentOutlineService(
  snapshot: PersistedGoalSnapshot | null,
  generatedContent = ""
) {
  if (!snapshot || snapshot.goal.status !== "active") return false;
  if (!planHasLegacyGovernmentOutlineSteps(snapshot.plan)) return false;
  if (isGovernmentOutlineConfirmationPending(snapshot)) return true;
  if (isGovernmentOutlinePreparationRequired(snapshot)) return true;
  const questionId = snapshot.pendingQuestion?.questionId ?? "";
  return Boolean(
    questionId
    && questionId !== "requirement-clarification"
    && /outline|\u63d0\u7eb2|\u5927\u7eb2/i.test(questionId)
    && !isCompleteGovernmentOutline(generatedContent)
  );
}

export function isGovernmentOutlineConfirmationPending(snapshot: PersistedGoalSnapshot | null) {
  if (!snapshot || snapshot.goal.status !== "active" || snapshot.pendingQuestion) return false;
  if (!snapshot.plan.some((step) => isLegacyGovernmentOutlineStep(step))) return false;
  const hasOutline = snapshot.plan.some((step) => {
    const identity = `${step.stepId} ${step.title}`;
    return isLegacyGovernmentOutlineStep(step)
      && !/confirm|\u786e\u8ba4/i.test(identity)
      && step.status === "completed"
      && Boolean(step.result.trim());
  });
  const confirmationIncomplete = snapshot.plan.some((step) =>
    isLegacyGovernmentOutlineConfirmationStep(step) && step.status !== "completed"
  );
  const draftStarted = snapshot.plan.some((step) =>
    /draft|\u8d77\u8349|\u6b63\u6587|\u64b0\u5199|\u521d\u7a3f/i.test(`${step.stepId} ${step.title}`) && step.status !== "pending"
  );
  return hasOutline && confirmationIncomplete && !draftStarted;
}

export function isGovernmentOutlinePreparationRequired(snapshot: PersistedGoalSnapshot | null) {
  if (!snapshot || snapshot.goal.status !== "active" || snapshot.pendingQuestion) return false;
  if (!snapshot.plan.some((step) => isLegacyGovernmentOutlineStep(step))) return false;
  const confirmationIncomplete = snapshot.plan.some((step) =>
    isLegacyGovernmentOutlineConfirmationStep(step) && step.status !== "completed"
  );
  const draftStarted = snapshot.plan.some((step) =>
    /draft|\u8d77\u8349|\u6b63\u6587|\u64b0\u5199|\u521d\u7a3f/i.test(`${step.stepId} ${step.title}`) && step.status !== "pending"
  );
  return confirmationIncomplete && !draftStarted;
}

export function shouldEnforceGovernmentDraftLength(snapshot: PersistedGoalSnapshot | null) {
  if (!snapshot) return true;
  if (snapshot.goal.status === "complete") return true;
  return snapshot.plan.some((step) =>
    /draft|delivery|\u8d77\u8349|\u6b63\u6587|\u64b0\u5199|\u521d\u7a3f|\u4ea4\u4ed8/i.test(`${step.stepId} ${step.title}`) && step.status !== "pending"
  );
}

export function markGovernmentOutlineReady(
  plan: PersistedGoalSnapshot["plan"],
  outline: string
) {
  const expandedPlan = expandGovernmentDraftPlanByOutline(plan, outline);
  // Only the outline confirmation gate may open here. Never treat
  // specification-confirmation as the outline handoff target.
  const confirmationIndex = expandedPlan.findIndex((step) =>
    isLegacyGovernmentOutlineConfirmationStep(step)
  );
  if (confirmationIndex < 0) {
    // Specification-first plans intentionally omit outline-confirmation. Never crash those runs.
    if (!planHasLegacyGovernmentOutlineSteps(expandedPlan)) return expandedPlan;
    throw new Error("Government writing plan has no outline-confirmation step.");
  }
  return expandedPlan.map((step, index) => {
    const identity = `${step.stepId} ${step.title}`;
    if (index < confirmationIndex) {
      // Leave the writing-specification confirmation gate alone when a mixed
      // plan still carries both modern specification and legacy outline steps.
      if (
        step.stepId === "specification-confirmation"
        || (/specification|\u89c4\u683c/i.test(identity) && /confirm|\u786e\u8ba4/i.test(identity))
      ) {
        return step;
      }
      return {
        ...step,
        status: "completed" as const,
        result: /outline|\u63d0\u7eb2|\u5927\u7eb2/i.test(identity)
          ? outline.replace(/\s+/g, " ").slice(0, 500)
          : step.result || "已完成当前写作阶段。"
      };
    }
    if (index === confirmationIndex) {
      return { ...step, status: "in_progress" as const, result: "" };
    }
    return { ...step, status: "pending" as const, result: "" };
  });
}

export function advanceGovernmentPlanAfterOutlineAnswer(
  snapshot: PersistedGoalSnapshot,
  questionId: string,
  answer: string
) {
  if (!/outline|\u63d0\u7eb2|\u5927\u7eb2/i.test(questionId)) return snapshot.plan;
  const requestsAdjustment = /(?:调整|修改|重写|重新|删除|删去|增加|新增|补充|移动|提前|置后|合并|拆分|不要|改成)/u.test(answer);
  if (requestsAdjustment) {
    const adjusted = snapshot.plan.map((step) => {
      const identity = `${step.stepId} ${step.title}`;
      if (/outline|\u63d0\u7eb2|\u5927\u7eb2/i.test(identity) && !/confirm|\u786e\u8ba4/i.test(identity)) {
        return { ...step, status: "in_progress" as const, result: `用户要求调整提纲：${answer}` };
      }
      if (isLegacyGovernmentOutlineConfirmationStep(step)) {
        return { ...step, status: "pending" as const, result: "" };
      }
      if (/^draft-section-|draft|\u8d77\u8349|\u6b63\u6587|\u64b0\u5199|\u521d\u7a3f/i.test(identity)) {
        return { ...step, status: "pending" as const, result: "" };
      }
      return step;
    });
    const activeIndex = adjusted.findIndex((step) =>
      step.status === "in_progress"
      && /outline|\u63d0\u7eb2|\u5927\u7eb2/i.test(`${step.stepId} ${step.title}`)
    );
    return adjusted.map((step, index) => {
      if (step.status !== "in_progress" || index === activeIndex) return step;
      const identity = `${step.stepId} ${step.title}`;
      if (
        step.stepId === "specification-confirmation"
        || (/specification|\u89c4\u683c/i.test(identity) && /confirm|\u786e\u8ba4/i.test(identity))
      ) {
        return step;
      }
      return { ...step, status: index < activeIndex ? "completed" as const : "pending" as const };
    });
  }
  let draftStarted = false;
  const advanced = snapshot.plan.map((step) => {
    const identity = `${step.stepId} ${step.title}`;
    if (/outline|\u63d0\u7eb2|\u5927\u7eb2/i.test(identity) && !/confirm|\u786e\u8ba4/i.test(identity)) {
      return {
        ...step,
        status: "completed" as const,
        result: step.result || "Outline presented to the user and confirmed."
      };
    }
    // Complete only the outline confirmation step. Leave writing-specification
    // confirmation untouched so a bare「确认」after大纲 cannot fake-spec-confirm.
    if (isLegacyGovernmentOutlineConfirmationStep(step)) {
      return { ...step, status: "completed" as const, result: `User selected: ${answer}` };
    }
    if (!draftStarted && /draft|\u8d77\u8349|\u6b63\u6587|\u64b0\u5199|\u521d\u7a3f/i.test(identity) && step.status === "pending") {
      draftStarted = true;
      return { ...step, status: "in_progress" as const };
    }
    return step;
  });
  const activeIndex = advanced.findIndex((step) =>
    step.status === "in_progress"
    && /draft|\u8d77\u8349|\u6b63\u6587|\u64b0\u5199|\u521d\u7a3f/i.test(`${step.stepId} ${step.title}`)
  );
  return advanced.map((step, index) => {
    if (step.status !== "in_progress" || index === activeIndex) return step;
    const identity = `${step.stepId} ${step.title}`;
    // Keep writing-specification confirmation open; outline confirm must not close it.
    if (
      step.stepId === "specification-confirmation"
      || (/specification|\u89c4\u683c/i.test(identity) && /confirm|\u786e\u8ba4/i.test(identity))
    ) {
      return step;
    }
    return { ...step, status: index < activeIndex ? "completed" as const : "pending" as const };
  });
}
