export type GovernmentEvidenceStatus = "verified" | "partial" | "missing" | "replace";

export interface GovernmentEvidenceItem {
  evidenceId: string;
  title: string;
  authority: string;
  publishedAt: string;
  url: string;
  supportedClaims: string[];
  unsupportedClaims: string[];
  readFromOfficialPage: boolean;
  status: GovernmentEvidenceStatus;
}

export interface GovernmentWritingRequirement {
  key: string;
  label: string;
  value: string;
  status: "confirmed" | "pending";
}

export interface GovernmentWritingCase {
  caseId: string;
  name: string;
  plannedUse: string;
  status: GovernmentEvidenceStatus;
  evidence: GovernmentEvidenceItem[];
}

export interface GovernmentWritingStructureSection {
  sectionId: string;
  level: 1 | 2;
  title: string;
  points: string;
  evidenceIds: string[];
  targetCharacters: number | null;
  verification: string;
}

export interface GovernmentWritingSpecificationContent {
  task: string;
  requirements: GovernmentWritingRequirement[];
  cases: GovernmentWritingCase[];
  structure: GovernmentWritingStructureSection[];
}

/** Generic analysis dimensions every writing specification must cover. Scene-specific content is never hard-coded here. */
export const GOVERNMENT_SPEC_ANALYSIS_DIMENSIONS = [
  { id: "theme", label: "主题定位", patterns: [/主题|定位|核心问题|为什么|怎样/u] },
  { id: "caseSelection", label: "案例选取", patterns: [/案例选取|案例范围|地方案例|选用案例/u], allowCasesArray: true },
  { id: "caseLogic", label: "案例展开逻辑", patterns: [/展开|禀赋|困境|起点|做法|成效|路径逻辑/u] },
  { id: "genre", label: "文体", patterns: [/文体|文种|体裁|调研报告|理论案例|讲话|发言/u] },
  { id: "language", label: "语言", patterns: [/语言|文风|语气|修辞|比喻|标题句式|对仗/u] },
  { id: "data", label: "数据使用", patterns: [/数据|可考|不编造|事实边界|禁止虚构/u] },
  { id: "citation", label: "引用规范", patterns: [/引用|原话|文献|讲话摘录|权威/u] },
  { id: "length", label: "篇幅", patterns: [/篇幅|字数|[0-9０-９].{0,8}字/u] }
] as const;

export type GovernmentSpecAnalysisDimensionId = (typeof GOVERNMENT_SPEC_ANALYSIS_DIMENSIONS)[number]["id"];

export function matchGovernmentSpecAnalysisDimension(
  requirement: Pick<GovernmentWritingRequirement, "key" | "label" | "value">,
  dimension: (typeof GOVERNMENT_SPEC_ANALYSIS_DIMENSIONS)[number]
) {
  const haystack = `${requirement.key}\n${requirement.label}\n${requirement.value}`;
  return dimension.patterns.some((pattern) => pattern.test(haystack));
}

export function analyzeGovernmentSpecificationCompleteness(content: GovernmentWritingSpecificationContent) {
  const validated = validateGovernmentWritingSpecification(content);
  const missing: Array<{ id: GovernmentSpecAnalysisDimensionId; label: string }> = [];
  for (const dimension of GOVERNMENT_SPEC_ANALYSIS_DIMENSIONS) {
    const coveredByRequirement = validated.requirements.some((requirement) =>
      matchGovernmentSpecAnalysisDimension(requirement, dimension)
    );
    const coveredByCases = "allowCasesArray" in dimension && dimension.allowCasesArray && validated.cases.length > 0;
    if (!coveredByRequirement && !coveredByCases) missing.push({ id: dimension.id, label: dimension.label });
  }
  return {
    complete: missing.length === 0 && validated.structure.length > 0 && Boolean(validated.task.trim()),
    missing,
    hasStructure: validated.structure.length > 0,
    caseCount: validated.cases.length
  };
}

function isStyleConstraintRequirement(requirement: GovernmentWritingRequirement) {
  return ["genre", "language", "data", "citation", "length"].some((id) => {
    const dimension = GOVERNMENT_SPEC_ANALYSIS_DIMENSIONS.find((item) => item.id === id);
    return dimension ? matchGovernmentSpecAnalysisDimension(requirement, dimension) : false;
  });
}

export function serializeGovernmentWritingSpecificationMarkdown(content: GovernmentWritingSpecificationContent) {
  const validated = validateGovernmentWritingSpecification(content);
  const coreRequirements = validated.requirements.filter((item) => !isStyleConstraintRequirement(item));
  const styleRequirements = validated.requirements.filter((item) => isStyleConstraintRequirement(item));
  const lines = [
    "# 写作任务",
    "",
    validated.task,
    "",
    "# 核心要求",
    ""
  ];
  for (const item of coreRequirements) {
    lines.push(`${item.label}：${item.value}${item.status === "pending" ? "（待确认）" : ""}`, "");
  }
  if (validated.cases.length) {
    lines.push("案例选取：", "");
    for (const item of validated.cases) {
      lines.push(`- ${item.name}：${item.plannedUse}（核验：${item.status}）`);
    }
    lines.push("");
  }
  lines.push("# 案例与官方证据", "");
  for (const item of validated.cases) {
    lines.push(`## ${item.name}`, "", item.plannedUse, "");
    for (const evidence of item.evidence) {
      lines.push(`- ${evidence.title}｜${evidence.authority}｜${evidence.url}｜状态:${evidence.status}`);
    }
    lines.push("");
  }
  lines.push("# 结构模板", "");
  for (const section of validated.structure) {
    const length = section.targetCharacters == null ? "未指定" : `${section.targetCharacters}字`;
    lines.push(`- ${section.title}：${section.points}｜建议篇幅:${length}｜核验:${section.verification}`);
  }
  lines.push("", "# 写作风格约束", "");
  if (styleRequirements.length === 0) {
    lines.push("（请在核心要求中补充文体、语言、数据使用、引用规范和篇幅。）", "");
  } else {
    for (const item of styleRequirements) {
      lines.push(`${item.label}：${item.value}${item.status === "pending" ? "（待确认）" : ""}`, "");
    }
  }
  lines.push("```json", JSON.stringify(validated, null, 2), "```");
  return lines.join("\n");
}

export interface GovernmentWritingSuggestion {
  suggestionId: string;
  target:
    | { kind: "task" }
    | { kind: "requirement"; key: string }
    | { kind: "section-points"; sectionId: string };
  reason: string;
  proposedValue: string;
}

const evidenceStatuses = new Set<GovernmentEvidenceStatus>(["verified", "partial", "missing", "replace"]);

function requiredText(value: unknown, label: string, max = 20_000) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}不能为空。`);
  if (text.length > max) throw new Error(`${label}超过长度限制。`);
  return text;
}

function uniqueId(value: unknown, label: string, seen: Set<string>) {
  const id = requiredText(value, label, 160);
  if (seen.has(id)) throw new Error(`${label}重复：${id}`);
  seen.add(id);
  return id;
}

export function isOfficialGovernmentUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (url.protocol === "https:" || url.protocol === "http:")
      && (host === "gov.cn" || host.endsWith(".gov.cn"));
  } catch {
    return false;
  }
}

export function validateGovernmentWritingSpecification(input: unknown): GovernmentWritingSpecificationContent {
  if (!input || typeof input !== "object") throw new Error("写作规格必须是对象。");
  const raw = input as Record<string, unknown>;
  const requirementsRaw = Array.isArray(raw.requirements) ? raw.requirements : [];
  const casesRaw = Array.isArray(raw.cases) ? raw.cases : [];
  const structureRaw = Array.isArray(raw.structure) ? raw.structure : [];
  if (requirementsRaw.length === 0) throw new Error("核心要求不能为空。");
  if (structureRaw.length === 0) throw new Error("结构模板不能为空。");

  const requirementIds = new Set<string>();
  const requirements = requirementsRaw.map((item) => {
    const entry = item as Record<string, unknown>;
    const key = uniqueId(entry.key, "核心要求标识", requirementIds);
    const status = entry.status === "pending" ? "pending" as const : "confirmed" as const;
    return { key, label: requiredText(entry.label, "核心要求名称", 200), value: requiredText(entry.value, "核心要求内容"), status };
  });

  const caseIds = new Set<string>();
  const evidenceIds = new Set<string>();
  const cases = casesRaw.map((item) => {
    const entry = item as Record<string, unknown>;
    const status = String(entry.status ?? "missing") as GovernmentEvidenceStatus;
    if (!evidenceStatuses.has(status)) throw new Error("案例核验状态无效。");
    const evidenceRaw = Array.isArray(entry.evidence) ? entry.evidence : [];
    const evidence = evidenceRaw.map((evidenceItem) => {
      const evidenceEntry = evidenceItem as Record<string, unknown>;
      const evidenceStatus = String(evidenceEntry.status ?? "missing") as GovernmentEvidenceStatus;
      if (!evidenceStatuses.has(evidenceStatus)) throw new Error("证据核验状态无效。");
      const url = requiredText(evidenceEntry.url, "官方来源链接", 8_192);
      if (!isOfficialGovernmentUrl(url)) throw new Error(`官方来源必须是政府网站：${url}`);
      if (evidenceStatus === "verified" && evidenceEntry.readFromOfficialPage !== true) {
        throw new Error("已核验证据必须读取政府网页原文，不能只使用搜索摘要。");
      }
      return {
        evidenceId: uniqueId(evidenceEntry.evidenceId, "证据标识", evidenceIds),
        title: requiredText(evidenceEntry.title, "来源标题", 500),
        authority: requiredText(evidenceEntry.authority, "发布机关", 300),
        publishedAt: String(evidenceEntry.publishedAt ?? "").trim(),
        url,
        supportedClaims: Array.isArray(evidenceEntry.supportedClaims) ? evidenceEntry.supportedClaims.map(String).map((value) => value.trim()).filter(Boolean) : [],
        unsupportedClaims: Array.isArray(evidenceEntry.unsupportedClaims) ? evidenceEntry.unsupportedClaims.map(String).map((value) => value.trim()).filter(Boolean) : [],
        readFromOfficialPage: evidenceEntry.readFromOfficialPage === true,
        status: evidenceStatus
      };
    });
    return {
      caseId: uniqueId(entry.caseId, "案例标识", caseIds),
      name: requiredText(entry.name, "案例名称", 500),
      plannedUse: requiredText(entry.plannedUse, "案例用途"),
      status,
      evidence
    };
  });

  const sectionIds = new Set<string>();
  const structure = structureRaw.map((item) => {
    const entry = item as Record<string, unknown>;
    const level = Number(entry.level);
    if (level !== 1 && level !== 2) throw new Error("章节层级只能是1或2。");
    const references = Array.isArray(entry.evidenceIds) ? entry.evidenceIds.map(String) : [];
    for (const evidenceId of references) {
      if (!evidenceIds.has(evidenceId)) throw new Error(`结构模板引用了不存在的证据：${evidenceId}`);
    }
    const targetCharacters = entry.targetCharacters == null ? null : Number(entry.targetCharacters);
    if (targetCharacters != null && (!Number.isInteger(targetCharacters) || targetCharacters <= 0)) {
      throw new Error("建议篇幅必须是正整数或空值。");
    }
    return {
      sectionId: uniqueId(entry.sectionId, "章节标识", sectionIds),
      level: level as 1 | 2,
      title: requiredText(entry.title, "章节标题", 500),
      points: requiredText(entry.points, "内容要点"),
      evidenceIds: references,
      targetCharacters,
      verification: requiredText(entry.verification, "核验要求")
    };
  });

  return { task: requiredText(raw.task, "写作任务"), requirements, cases, structure };
}

export function buildSpecificationGenerationInput(input: {
  currentGoal: string;
  currentAttachments: unknown[];
  currentEvidence: unknown[];
  historicalMessages?: string[];
}) {
  return {
    currentGoal: requiredText(input.currentGoal, "当前写作目标"),
    currentAttachments: structuredClone(input.currentAttachments),
    currentEvidence: structuredClone(input.currentEvidence)
  };
}

export function canStartGovernmentDraft(snapshot: {
  currentVersionId?: string;
  confirmedVersionId?: string;
} | null | undefined) {
  return Boolean(snapshot?.currentVersionId)
    && snapshot?.currentVersionId === snapshot?.confirmedVersionId;
}

export function parseGovernmentWritingSpecificationMarkdown(markdown: string) {
  for (const section of ["写作任务", "核心要求", "案例与官方证据", "结构模板"]) {
    if (!new RegExp(`^#\\s+${section}$`, "mu").test(markdown)) throw new Error(`Markdown缺少“${section}”部分。`);
  }
  const json = markdown.match(/```json\s*([\s\S]*?)```/iu)?.[1];
  if (!json) throw new Error("Markdown缺少可编辑的JSON规格正文。");
  try {
    return validateGovernmentWritingSpecification(JSON.parse(json));
  } catch (error) {
    throw new Error(`Markdown规格解析失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Best-effort parse of assistant/goal text into a durable writing specification. */
export function tryParseGovernmentWritingSpecificationContent(text: string) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (/^#\s+写作任务/mu.test(raw) && /```json/i.test(raw)) {
    try {
      return parseGovernmentWritingSpecificationMarkdown(raw);
    } catch {
      // Fall through to bare JSON fences when headings are incomplete.
    }
  }
  const fences = [...raw.matchAll(/```json\s*([\s\S]*?)```/giu)].map((match) => match[1]);
  for (const json of [...fences].reverse()) {
    try {
      return validateGovernmentWritingSpecification(JSON.parse(json));
    } catch {
      // Keep scanning older fences.
    }
  }
  if (raw.startsWith("{")) {
    try {
      return validateGovernmentWritingSpecification(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  return null;
}

/** Scan newest-first candidate texts until a valid writing specification is found. */
export function extractGovernmentWritingSpecificationFromTexts(
  texts: Array<string | null | undefined>
) {
  for (const text of texts) {
    const parsed = tryParseGovernmentWritingSpecificationContent(String(text ?? ""));
    if (parsed) return parsed;
  }
  return null;
}

export function applyGovernmentWritingSuggestions(
  content: GovernmentWritingSpecificationContent,
  suggestions: GovernmentWritingSuggestion[],
  selectedSuggestionIds: string[]
) {
  const selected = new Set(selectedSuggestionIds);
  const next = structuredClone(validateGovernmentWritingSpecification(content));
  for (const suggestion of suggestions) {
    if (!selected.has(suggestion.suggestionId)) continue;
    const value = requiredText(suggestion.proposedValue, "建议内容");
    if (suggestion.target.kind === "task") next.task = value;
    if (suggestion.target.kind === "requirement") {
      const key = suggestion.target.key;
      const requirement = next.requirements.find((item) => item.key === key);
      if (!requirement) throw new Error(`找不到建议对应的核心要求：${key}`);
      requirement.value = value;
    }
    if (suggestion.target.kind === "section-points") {
      const sectionId = suggestion.target.sectionId;
      const section = next.structure.find((item) => item.sectionId === sectionId);
      if (!section) throw new Error(`找不到建议对应的章节：${sectionId}`);
      section.points = value;
    }
  }
  return validateGovernmentWritingSpecification(next);
}

type MutableGovernmentPlanStep = {
  stepId: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  result: string;
};

const PRE_CONFIRM_STEP_IDS = new Set([
  "material-assessment",
  "requirement-clarification",
  "official-evidence-research",
  "writing-specification"
]);

export function advanceGovernmentPlanAfterSpecificationSaved<T extends MutableGovernmentPlanStep>(plan: T[]): T[] {
  const confirmationIndex = plan.findIndex((step) => step.stepId === "specification-confirmation");
  if (confirmationIndex < 0) return plan;
  return plan.map((step, index) => {
    if (PRE_CONFIRM_STEP_IDS.has(step.stepId) || index < confirmationIndex) {
      return {
        ...step,
        status: "completed" as const,
        result: step.result || (step.stepId === "writing-specification" ? "已生成当前写作规格。" : "已完成当前写作阶段。")
      };
    }
    if (step.stepId === "specification-confirmation") {
      return { ...step, status: "in_progress" as const, result: "" };
    }
    if (/^(?:draft|draft-section-|style-unification|fact-check|delivery)/.test(step.stepId)) {
      return { ...step, status: "pending" as const, result: "" };
    }
    return step;
  });
}

export function advanceGovernmentPlanAfterSpecificationConfirm<T extends MutableGovernmentPlanStep>(
  plan: T[],
  structure: Array<{ title: string }>
): T[] {
  const numerals = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const sections = structure.map((item) => String(item.title || "").trim()).filter(Boolean).slice(0, numerals.length);
  const withConfirmation = plan.map((step) => {
    if (PRE_CONFIRM_STEP_IDS.has(step.stepId)) {
      return {
        ...step,
        status: "completed" as const,
        result: step.result || "已完成当前写作阶段。"
      };
    }
    if (step.stepId === "specification-confirmation") {
      return { ...step, status: "completed" as const, result: "用户已确认当前写作规格。" };
    }
    return step;
  });
  if (sections.length < 2) {
    return withConfirmation.map((step) => {
      if (step.stepId === "draft") return { ...step, status: "in_progress" as const, result: "" };
      if (/^(?:draft-section-|style-unification|fact-check|delivery)/.test(step.stepId)) {
        return { ...step, status: "pending" as const, result: step.stepId.startsWith("draft-section-") ? "" : step.result };
      }
      return step;
    });
  }
  const draftIndex = withConfirmation.findIndex((step) =>
    step.stepId === "draft" || /^draft-section-/.test(step.stepId) || /起草|正文|撰写|初稿/i.test(step.title)
  );
  if (draftIndex < 0) return withConfirmation;
  let draftEnd = draftIndex + 1;
  while (draftEnd < withConfirmation.length && (
    withConfirmation[draftEnd].stepId === "draft"
    || /^draft-section-/.test(withConfirmation[draftEnd].stepId)
    || /起草|正文|撰写|初稿/i.test(withConfirmation[draftEnd].title)
  )) draftEnd += 1;
  const original = withConfirmation[draftIndex];
  const sectionSteps = sections.map((title, index) => ({
    ...original,
    stepId: `draft-section-${index + 1}`,
    title: `分段撰写：${title.slice(0, 60)}`,
    description: `只依据已确认写作规格生成第 ${index + 1} 部分；完成后记录该段结果，再继续下一部分。`,
    status: (index === 0 ? "in_progress" : "pending") as MutableGovernmentPlanStep["status"],
    result: ""
  })) as T[];
  return [
    ...withConfirmation.slice(0, draftIndex),
    ...sectionSteps,
    ...withConfirmation.slice(draftEnd).map((step) => (
      /^(?:style-unification|fact-check|delivery)/.test(step.stepId)
        ? { ...step, status: "pending" as const, result: "" }
        : step
    ))
  ];
}
