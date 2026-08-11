/** Government writing helpers when the exploratory tool loop hits the safety step limit. */

export function buildGovernmentMaxStepsProgressBrief(options) {
  const lines = [];
  const request = String(options?.latestUserRequest ?? "").trim();
  if (request) {
    lines.push("用户任务：");
    lines.push(request.length > 1200 ? `${request.slice(0, 1200)}…` : request);
  }
  const plan = options?.goalSnapshot?.plan ?? [];
  if (plan.length) {
    lines.push("");
    lines.push("计划进度：");
    for (const step of plan.slice(0, 16)) {
      const status =
        step.status === "completed"
          ? "已完成"
          : step.status === "in_progress"
            ? "进行中"
            : "待处理";
      const detail = String(step.result || step.description || step.title || step.stepId || "").trim();
      lines.push(`- [${status}] ${detail.slice(0, 320)}`);
    }
  }
  const progressSnippets = (options?.assistantMessages ?? [])
    .map((item) => String(item ?? "").trim())
    .filter((item) => item && !/已达安全步数上限/u.test(item))
    .slice(-4);
  if (progressSnippets.length) {
    lines.push("");
    lines.push("已产出材料/片段：");
    for (const snippet of progressSnippets) {
      lines.push(snippet.length > 2000 ? `${snippet.slice(0, 2000)}…` : snippet);
      lines.push("---");
    }
  }
  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n").trim();
}

export function governmentMaxStepsSynthesisInstruction(progressBrief) {
  return [
    "The exploratory tool loop hit the safety step limit. Do NOT call any tools.",
    "Using ONLY the progress brief and prior conversation, produce the best Chinese deliverable for the user now.",
    "If writing-specification / outline evidence is enough, output a complete staged article body (标记【待核验】 where facts are incomplete).",
    "If evidence is still thin, output a structured staged draft: 任务理解、已确认要点、建议提纲、可先落笔的正文初稿、待核验清单。",
    "Never invent official sources, URLs, document numbers, statistics, or leader names.",
    "Do not apologize with only a stop notice. The user needs a usable version based on current steps.",
    "Output Simplified Chinese only. No English self-talk, no validation tables, no confirmation gates.",
    "",
    "当前进度简报：",
    progressBrief || "（暂无结构化进度，请基于最近对话尽力成稿）"
  ].join("\n");
}

export function wrapGovernmentMaxStepsDraft(draft) {
  const body = String(draft ?? "").trim();
  if (!body) return "";
  return [
    "【阶段性成稿】本轮探索已达安全步数上限，已停止继续调用工具。以下基于当前已完成步骤生成，供你审阅后继续完善。",
    "",
    body
  ].join("\n");
}

export function governmentMaxStepsFallbackContent(options) {
  const brief = buildGovernmentMaxStepsProgressBrief(options);
  return [
    "本轮探索已达安全步数上限，已停止继续调用工具，避免不稳定循环。",
    "自动成稿暂未产出可用正文，以下是当前进度摘要；请补充要求后继续，或基于下列材料人工修订。",
    "",
    brief || "当前尚未沉淀可展示的正文片段；请查看写作规格或决策卡片中的已确认信息。"
  ].join("\n");
}
