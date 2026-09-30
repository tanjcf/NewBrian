export interface ResearchIntakeAnswer {
  question: string;
  answer: string;
}

export interface ResearchIntakeOption {
  label: string;
  description: string;
  recommended?: boolean;
}

export interface ResearchIntakePlanStep {
  id: string;
  title: string;
  description: string;
  status: "pending" | "active" | "completed";
  result?: string;
}

export interface ResearchIntakeResult {
  status: "question" | "ready";
  analysis: string;
  plan: ResearchIntakePlanStep[];
  question?: {
    id: string;
    prompt: string;
    options: ResearchIntakeOption[];
    progress: { current: number; total: number };
  };
  targetContext?: string;
}

export interface ResearchIntakeAttachment {
  name: string;
  path: string;
  url: string;
}

export interface ResearchIntakeMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: ResearchIntakeAttachment[];
}

export interface ResearchIntakeServiceInput {
  userRequest?: string;
  conversationContext?: string;
  answers?: ResearchIntakeAnswer[];
  attachments?: Array<Partial<ResearchIntakeAttachment>>;
}

export const MAX_RESEARCH_INTAKE_ROUNDS = 6;
export const RESEARCH_WRITING_PROTOTYPE_FLOW = [
  "materials",
  "outline",
  "section-drafting",
  "style-unification",
  "fact-check",
  "export"
] as const;
export const MAX_RESEARCH_REQUEST_CHARS = 8_000;
export const MAX_RESEARCH_CONTEXT_CHARS = 2_000;
export const MAX_RESEARCH_QUESTION_CHARS = 240;
export const MAX_RESEARCH_ANSWER_CHARS = 600;
export const MAX_RESEARCH_ATTACHMENT_PATH_CHARS = 4_096;
export const MAX_RESEARCH_ATTACHMENT_URL_CHARS = 8_192;

export function selectResearchIntakeModel<
  TCurrent extends { model: string },
  TAvailable extends { model: string }
>(
  current: TCurrent,
  availableModels: TAvailable[] = []
): TCurrent | TAvailable {
  const candidates = [current, ...availableModels.filter((item) => item.model !== current.model)];
  return candidates.find((item) => /(?:flash|mini|haiku|lite)/i.test(item.model)) ?? current;
}

export function alignResearchIntakeProgress(result: ResearchIntakeResult, answeredCount: number): ResearchIntakeResult {
  if (result.status !== "question" || !result.question) return result;
  const current = Math.min(MAX_RESEARCH_INTAKE_ROUNDS, Math.max(1, answeredCount + 1));
  const total = Math.min(MAX_RESEARCH_INTAKE_ROUNDS, Math.max(current, result.question.progress.total));
  return { ...result, question: { ...result.question, progress: { current, total } } };
}

export function normalizeResearchIntakeAnswers(input: unknown): ResearchIntakeAnswer[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const question = String(entry.question || "").trim().slice(0, MAX_RESEARCH_QUESTION_CHARS);
    const answer = String(entry.answer || "").trim().slice(0, MAX_RESEARCH_ANSWER_CHARS);
    return question && answer ? [{ question, answer }] : [];
  }).slice(-MAX_RESEARCH_INTAKE_ROUNDS);
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate) throw new Error("模型没有返回政务写作询问结构。");
  return JSON.parse(candidate) as Record<string, unknown>;
}

export function parseResearchIntakeResult(text: string): ResearchIntakeResult {
  const raw = extractJsonObject(text);
  if (raw.status !== "ready" && raw.status !== "question") {
    throw new Error("模型返回了不支持的政务写作询问状态。");
  }
  const status = raw.status;
  const analysis = String(raw.analysis || "").trim().slice(0, 1_000);
  const plan = Array.isArray(raw.plan) ? raw.plan.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const title = String(entry.title || "").trim().slice(0, 160);
    const description = String(entry.description || "").trim().slice(0, 500);
    if (!title || !description) return [];
    const rawStatus = String(entry.status || "pending");
    const stepStatus: ResearchIntakePlanStep["status"] = rawStatus === "completed"
      ? "completed"
      : rawStatus === "active" ? "active" : "pending";
    return [{
      id: String(entry.id || `step-${index + 1}`).trim().slice(0, 120).replace(/[^a-zA-Z0-9_-]+/g, "-") || `step-${index + 1}`,
      title,
      description,
      status: stepStatus,
      result: String(entry.result || "").trim().slice(0, 1_000) || undefined
    }];
  }).slice(0, 6) : [];
  const planIds = plan.map((step) => step.id);
  if (planIds.length !== RESEARCH_WRITING_PROTOTYPE_FLOW.length
    || planIds.some((id, index) => id !== RESEARCH_WRITING_PROTOTYPE_FLOW[index])) {
    throw new Error("模型返回的政务写作计划不符合固定六阶段原型流程。");
  }
  if (status === "ready") {
    const targetContext = String(raw.targetContext || "").trim().slice(0, 12_000);
    if (!targetContext) throw new Error("模型尚未生成可执行的政务写作目标约束。");
    return { status, analysis, plan, targetContext };
  }
  const question = raw.question && typeof raw.question === "object"
    ? raw.question as Record<string, unknown>
    : {};
  const rawOptions = Array.isArray(question.options)
    ? question.options.flatMap((option) => {
        if (!option || typeof option !== "object") return [];
        const entry = option as Record<string, unknown>;
        const label = String(entry.label || "").trim().slice(0, 120);
        const description = String(entry.description || "").trim().slice(0, 300);
        if (!label || !description) return [];
        return [{
          label,
          description,
          recommended: entry.recommended === true
        }];
      })
    : [];
  const uniqueOptions = [...new Map(rawOptions.map((option) => [option.label, option])).values()].slice(0, 4);
  let recommendationSeen = false;
  const options = uniqueOptions.map((option) => {
    const recommended = option.recommended === true && !recommendationSeen;
    if (recommended) recommendationSeen = true;
    return { ...option, recommended };
  });
  const prompt = String(question.prompt || "").trim().slice(0, 500);
  if (!prompt || options.length < 2) throw new Error("模型返回的询问问题或选项不完整。");
  const progress = question.progress && typeof question.progress === "object"
    ? question.progress as Record<string, unknown>
    : {};
  const current = Math.max(1, Math.min(MAX_RESEARCH_INTAKE_ROUNDS, Number(progress.current) || 1));
  const total = Math.max(current, Math.min(MAX_RESEARCH_INTAKE_ROUNDS, Number(progress.total) || Math.max(3, current)));
  const rawId = String(question.id || "").trim().slice(0, 120).replace(/[^a-zA-Z0-9_-]+/g, "-");
  return {
    status,
    analysis,
    plan,
    question: {
      id: rawId || `question-${current}`,
      prompt,
      options,
      progress: { current, total }
    }
  };
}

export function buildResearchIntakeModelPrompt(input: {
  userRequest: string;
  conversationContext?: string;
  answers: ResearchIntakeAnswer[];
}) {
  return [
    "你是政务研究写作的计划执行器。先像 Codex update_plan 一样拆解目标，再按步骤推进；此阶段不写最终正文。",
    "必须严格沿用产品原型的六阶段 plan，id 和顺序不得改变：materials（主题与素材输入）→ outline（提纲提炼及人工确认）→ section-drafting（按确认提纲分段生成）→ style-unification（文风统一）→ fact-check（基础事实校验）→ export（WPS/Word/校验版导出）。不得另造流程、合并阶段或跳阶段。",
    "每轮都返回完整六阶段 plan，并更新步骤的 pending/active/completed 状态；完成步骤必须在 result 中输出该动作的真实阶段结果。模型可以动态拆解当前阶段内部动作，但不能改变原型主流程；禁止固定题库。",
    "逐步判断当前动作是否存在会实质改变结果的用户决策。需要决策时像 request_user_input 一样返回 question 并暂停；不需要时可直接完成该动作并继续分析下一动作，直到 ready。禁止重复已回答的问题。",
    "ready 只表示当前阶段信息足以产出下一个阶段成果，不表示整套流程全部完成。首次 ready 的目标成果只能是提纲；没有用户明确确认或修改提纲前，禁止进入 section-drafting。分段生成必须一次只生成当前段。文风统一、事实校验和导出必须保持为独立后续阶段。",
    "只询问影响文种、受众、使用场景、事实材料边界、政策口径、篇幅结构或本轮交付目标的关键问题。通常询问 2-5 轮，最多 6 轮。",
    "选项应针对当前任务具体生成，提供 2-4 个互斥选项；可标记一个 recommended=true。用户始终可以在界面中自定义填写。",
    `当信息足以产出结果时返回 ready，并生成完整 targetContext，明确目标成果、受众、文种、结构、篇幅、素材使用边界、核验要求和禁止臆造要求。最多询问 ${MAX_RESEARCH_INTAKE_ROUNDS} 轮；已有 ${input.answers.length} 轮答案。达到上限时必须返回 ready。`,
    "严格只返回 JSON，不要 Markdown。plan 中每个动作必须包含 id、title、description、status，completed 动作还必须包含 result。question 格式：",
    '{"status":"question","analysis":"当前阶段为何需要用户决策","plan":[{"id":"materials","title":"主题与素材输入","description":"建立主题、素材和来源边界","status":"active"},{"id":"outline","title":"提纲提炼与确认","description":"生成并由用户修改确认提纲","status":"pending"},{"id":"section-drafting","title":"按提纲分段生成","description":"一次生成或调整一个段落","status":"pending"},{"id":"style-unification","title":"文风统一","description":"统一为克制的政务研究型文风","status":"pending"},{"id":"fact-check","title":"基础事实校验","description":"检查数据、政策、时间、做法和行政层级","status":"pending"},{"id":"export","title":"导出","description":"导出 WPS/Word、校验版或纯文本","status":"pending"}],"question":{"id":"audience","prompt":"问题","progress":{"current":1,"total":3},"options":[{"label":"选项","description":"选择影响","recommended":true}]}}',
    "ready 格式：",
    '{"status":"ready","analysis":"当前阶段已具备产出条件","plan":[{"id":"materials","title":"主题与素材输入","description":"建立素材台账","status":"completed","result":"已确认主题、素材与来源边界"},{"id":"outline","title":"提纲提炼与确认","description":"先生成提纲并等待人工确认","status":"active"},{"id":"section-drafting","title":"按提纲分段生成","description":"一次生成一个段落","status":"pending"},{"id":"style-unification","title":"文风统一","description":"独立统一文风","status":"pending"},{"id":"fact-check","title":"基础事实校验","description":"独立检查事实风险","status":"pending"},{"id":"export","title":"导出","description":"最后导出 WPS/Word","status":"pending"}],"targetContext":"本轮只生成地方实践文章标题建议、一级标题、二级标题和每部分提炼说明；生成后必须等待用户人工修改或确认，不得生成正文"}',
    `用户当前任务：${input.userRequest.trim() || "用户尚未写明具体题目，请先询问目标成果。"}`,
    input.conversationContext?.trim() ? `当前对话摘要：${input.conversationContext.trim()}` : "",
    input.answers.length
      ? `此前问答：\n${input.answers.map((item, index) => `${index + 1}. 问：${item.question}\n答：${item.answer}`).join("\n")}`
      : "此前问答：无"
  ].filter(Boolean).join("\n\n");
}

export async function runResearchIntakeService(options: {
  input: ResearchIntakeServiceInput;
  callModel: (messages: ResearchIntakeMessage[]) => Promise<{ content: string }>;
  onRepair?: (error: unknown) => void | Promise<void>;
  onTransientRetry?: (error: unknown) => void | Promise<void>;
}): Promise<ResearchIntakeResult> {
  const answers = normalizeResearchIntakeAnswers(options.input.answers);
  const prompt = buildResearchIntakeModelPrompt({
    userRequest: String(options.input.userRequest || "").slice(0, MAX_RESEARCH_REQUEST_CHARS),
    conversationContext: String(options.input.conversationContext || "").slice(0, MAX_RESEARCH_CONTEXT_CHARS),
    answers
  });
  const attachments = Array.isArray(options.input.attachments)
    ? options.input.attachments.flatMap((item) => {
        const name = String(item?.name || "").trim().slice(0, 260);
        const path = String(item?.path || "").trim().slice(0, MAX_RESEARCH_ATTACHMENT_PATH_CHARS);
        const url = String(item?.url || "").trim().slice(0, MAX_RESEARCH_ATTACHMENT_URL_CHARS);
        return name && path ? [{ name, path, url }] : [];
      }).slice(0, 8)
    : [];
  const callModelWithTransientRetry = async (messages: ResearchIntakeMessage[]) => {
    try {
      return await options.callModel(messages);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      if (!/timeout|timed out|aborted|aborterror|http 5\d\d|econnreset|econnrefused|fetch failed/i.test(message)) {
        throw error;
      }
      await options.onTransientRetry?.(error);
      return options.callModel(messages);
    }
  };
  const firstResult = await callModelWithTransientRetry([{ role: "user", content: prompt, attachments }]);
  try {
    const parsed = parseResearchIntakeResult(firstResult.content);
    if (answers.length >= MAX_RESEARCH_INTAKE_ROUNDS && parsed.status !== "ready") {
      throw new Error("达到询问轮数上限后模型仍试图继续提问。");
    }
    return alignResearchIntakeProgress(parsed, answers.length);
  } catch (firstError) {
    await options.onRepair?.(firstError);
    const repairResult = await callModelWithTransientRetry([
      { role: "user", content: prompt },
      { role: "assistant", content: firstResult.content.slice(0, 12_000) },
      {
        role: "user",
        content: answers.length >= MAX_RESEARCH_INTAKE_ROUNDS
          ? "上一个响应不符合协议，且已达到最多询问轮数。请只返回 status=ready 的合法 JSON，并生成完整 targetContext。"
          : "上一个响应不符合约定的 JSON 协议。请修正后只返回一个合法 JSON 对象，不要添加 Markdown。"
      }
    ]);
    const parsed = parseResearchIntakeResult(repairResult.content);
    if (answers.length >= MAX_RESEARCH_INTAKE_ROUNDS && parsed.status !== "ready") {
      throw new Error("政务写作需求分析达到询问上限，但模型未生成目标约束。");
    }
    return alignResearchIntakeProgress(parsed, answers.length);
  }
}
