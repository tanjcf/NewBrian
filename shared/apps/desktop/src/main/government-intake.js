export const GOVERNMENT_INTAKE_QUESTION_ID = "requirement-clarification";

const SCENARIO_PATTERN = /(?:会议|发言|讲话|汇报|报告|宣讲|培训|演讲|致辞|简报|总结会|座谈|党课|读者|受众|刊物|公众号|网站|内参|研讨|交流材料|发布会|用于|场合|场景)/u;
const LENGTH_PATTERN = /(?:[0-9０-９][0-9０-９,，.\s]*\s*(?:字|千字|万字)|字数|篇幅|(?:一|二|两|三|四|五|六|七|八|九|十)+\s*(?:千|万)\s*字)/u;
const RESEARCH_ARTICLE_PATTERN = /(?:典型案例|案例研究|调研报告|研究文章|政策研究|实践探索|经验研究)/u;

/**
 * Deterministically identifies which key facts are missing from a government
 * writing request so the workflow can ask the user before building a specification.
 * @param {{ userRequest: string, hasAttachments: boolean }} input
 * @returns {string[]}
 */
export function analyzeGovernmentMissingInformation(input) {
  const request = String(input.userRequest ?? "").trim();
  // A clearly scoped research/case-study genre can carry conservative defaults
  // into the confirmable specification. It does not require a local attachment:
  // cases can be selected from official sources and every unsupported fact stays
  // explicitly unverified until evidence is available.
  if (RESEARCH_ARTICLE_PATTERN.test(request)) return [];
  const missing = [];
  if (!SCENARIO_PATTERN.test(request)) missing.push("文章使用场景");
  if (!LENGTH_PATTERN.test(request)) missing.push("目标字数");
  if (!input.hasAttachments && !/(?:材料|附件|纪要|数据|素材|已上传|如下资料)/u.test(request)) {
    missing.push("至少一份可引用的本地材料");
  }
  return missing;
}

/**
 * @param {string[]} missing
 * @returns {{ questionId: string, prompt: string, options: Array<{ label: string, description: string, recommended: boolean }> }}
 */
export function buildGovernmentIntakeQuestion(missing) {
  return {
    questionId: GOVERNMENT_INTAKE_QUESTION_ID,
    prompt: `请补充缺失信息（${missing.join("、")}），或选择继续方式：`,
    options: [
      { label: "我先补充信息", description: "在下方输入框补充说明，或点击 + 上传材料后发送。", recommended: true },
      { label: "跳过补充，使用保守假设生成写作规格", description: "缺失信息采用通用表述，需核验事实将标记为【待核验】。", recommended: false }
    ]
  };
}

/**
 * @param {string[]} missing
 */
export function buildGovernmentIntakeNotice(missing) {
  return [
    "还需要补充以下信息，才能生成可靠的写作规格：",
    ...missing.map((item) => `- ${item}`),
    "",
    "请直接在对话框补充，也可以点击 + 上传材料。"
  ].join("\n");
}

/**
 * Recovers the identified missing-information list from the persisted plan.
 * @param {Array<{ stepId: string, result: string }>} plan
 * @returns {string[]}
 */
export function extractMissingInformationFromPlan(plan) {
  const result = plan.find((step) => step.stepId === "material-assessment")?.result ?? "";
  const match = result.match(/已识别缺失信息：(.+)$/u);
  return match ? match[1].split("、").map((item) => item.trim()).filter(Boolean) : [];
}

/**
 * Marks the clarification plan step and completes material assessment with findings.
 * @template {{ stepId: string, status: string, result: string }} T
 * @param {T[]} plan
 * @param {string[]} missing
 * @returns {T[]}
 */
export function applyGovernmentIntakeToPlan(plan, missing) {
  return plan.map((step) => {
    if (step.stepId === "material-assessment") {
      return { ...step, status: "completed", result: `已识别缺失信息：${missing.join("、")}` };
    }
    if (step.stepId === "requirement-clarification") {
      return { ...step, status: "in_progress", result: "" };
    }
    return step;
  });
}

/**
 * Completes the clarification step once the user has answered or skipped.
 * @template {{ stepId: string, status: string, result: string }} T
 * @param {T[]} plan
 * @param {string} answer
 * @returns {T[]}
 */
export function completeGovernmentIntakeInPlan(plan, answer) {
  return plan.map((step) =>
    step.stepId === "requirement-clarification"
      ? { ...step, status: "completed", result: `用户补充/决定：${answer.slice(0, 300)}` }
      : step
  );
}
