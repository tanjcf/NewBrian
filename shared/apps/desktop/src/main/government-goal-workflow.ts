export function buildGovernmentWritingInitialPlan() {
  return [
    {
      stepId: "material-assessment",
      title: "材料评估与需求识别",
      description: "识别文种、受众、场景、篇幅、事实材料和禁止虚构边界。",
      status: "in_progress" as const,
      result: ""
    },
    {
      stepId: "requirement-clarification",
      title: "必要时澄清关键需求",
      description: "仅在会实质改变成稿的关键信息缺失时请求用户选择，否则直接完成。",
      status: "pending" as const,
      result: ""
    },
    {
      stepId: "official-evidence-research",
      title: "检索并阅读官方证据",
      description: "仅使用政府官网检索与原文阅读，建立当前任务的证据边界。",
      status: "pending" as const,
      result: ""
    },
    {
      stepId: "writing-specification",
      title: "生成写作规格",
      description: "输出写作任务、核心要求、案例与官方证据、结构模板四部分规格。",
      status: "pending" as const,
      result: ""
    },
    {
      stepId: "specification-confirmation",
      title: "确认写作规格",
      description: "由用户确认或修改当前写作规格后，才能进入正文起草。",
      status: "pending" as const,
      result: ""
    },
    {
      stepId: "draft",
      title: "按确认规格撰写初稿",
      description: "严格依据确认后的规格、篇幅和事实边界分段形成正文。",
      status: "pending" as const,
      result: ""
    },
    {
      stepId: "style-unification",
      title: "统一政务文风与结构",
      description: "统一语气、逻辑、段落衔接和正式表达。",
      status: "pending" as const,
      result: ""
    },
    {
      stepId: "fact-check",
      title: "事实边界核验",
      description: "检查政策、部门、数据、日期、成绩和本地事实，标记所有待核验内容。",
      status: "pending" as const,
      result: ""
    },
    {
      stepId: "delivery",
      title: "交付正文与所需文件",
      description: "交付最终正文；用户明确要求文件时生成、核验并列出可打开的文件。",
      status: "pending" as const,
      result: ""
    }
  ];
}
