export type ResearchQueryShape = "straight" | "depth" | "breadth";

export interface ResearchPlanStep {
  id: string;
  title: string;
  role: "planner" | "researcher" | "verifier" | "editor";
  objective: string;
  tools: string[];
  status: "pending" | "active" | "completed";
}

export interface ResearchPlan {
  shape: ResearchQueryShape;
  title: string;
  leadRule: string;
  maxChildren: number;
  steps: ResearchPlanStep[];
  searchBudget: {
    maxSearches: number;
    maxFetches: number;
    requireFetchBeforeClaim: boolean;
  };
}

const DEPTH_HINT = /深入|详细|完整|全面分析|机理|因果|为什么|how does|deep dive|in[- ]depth/iu;
const BREADTH_HINT = /对比|比较|多方|竞品|行业|综述|survey|compare|versus|vs\.?/iu;
const STRAIGHT_HINT = /最新|今天|今日|股价|公告|行情|多少钱|是什么|定义|latest|price|what is/iu;

/** Classify research shape for Auto Lead planning (does not change spawn depth). */
export function classifyResearchQueryShape(text: string): ResearchQueryShape {
  const value = String(text || "").trim();
  if (!value) return "straight";
  if (BREADTH_HINT.test(value)) return "breadth";
  if (DEPTH_HINT.test(value)) return "depth";
  if (STRAIGHT_HINT.test(value)) return "straight";
  if (value.length >= 80) return "depth";
  return "straight";
}

/** Build a bounded research_plan for Lead→researcher Search→Fetch SOP. */
export function buildResearchPlan(input: {
  request: string;
  maxChildren?: number;
}): ResearchPlan {
  const request = String(input.request || "").trim();
  const shape = classifyResearchQueryShape(request);
  const maxChildren = Math.max(1, Math.min(3, Math.trunc(input.maxChildren ?? 3)));

  if (shape === "breadth") {
    return {
      shape,
      title: "广度调研",
      leadRule: "Lead 只规划与综合；子 Agent 并行检索不同角度，Lead 用 agent.wait 收敛后统一答复。",
      maxChildren,
      searchBudget: { maxSearches: 4, maxFetches: 6, requireFetchBeforeClaim: true },
      steps: [
        {
          id: "plan",
          title: "拆分调研角度",
          role: "planner",
          objective: "列出最多 3 个互不重叠的调研角度与验收标准",
          tools: [],
          status: "pending"
        },
        {
          id: "research-a",
          title: "角度 A 检索",
          role: "researcher",
          objective: "Search→Fetch 覆盖角度 A，产出带 URL 的证据摘录",
          tools: ["news_search_free", "web.search_paid", "web.fetch_page"],
          status: "pending"
        },
        {
          id: "research-b",
          title: "角度 B 检索",
          role: "researcher",
          objective: "Search→Fetch 覆盖角度 B，产出带 URL 的证据摘录",
          tools: ["news_search_free", "web.search_paid", "web.fetch_page"],
          status: "pending"
        },
        {
          id: "verify",
          title: "交叉核验",
          role: "verifier",
          objective: "核对冲突事实、时效与引用是否落在证据包内",
          tools: ["web.fetch_page"],
          status: "pending"
        }
      ].slice(0, maxChildren + 1)
    };
  }

  if (shape === "depth") {
    return {
      shape,
      title: "深度调研",
      leadRule: "Lead 只规划与综合；researcher 串行加深 Search→Fetch，不由 Lead 亲自长跑工具。",
      maxChildren: Math.min(2, maxChildren),
      searchBudget: { maxSearches: 3, maxFetches: 5, requireFetchBeforeClaim: true },
      steps: [
        {
          id: "plan",
          title: "问题拆解",
          role: "planner",
          objective: "明确待证事实、未知点与证据门槛",
          tools: [],
          status: "pending"
        },
        {
          id: "research",
          title: "检索与全文抓取",
          role: "researcher",
          objective: "news_search_free →（必要时）web.search_paid → web.fetch_page TopK；写出 References",
          tools: ["news_search_free", "web.search_paid", "web.fetch_page"],
          status: "pending"
        },
        {
          id: "verify",
          title: "证据核验",
          role: "verifier",
          objective: "确认关键主张均有 URL/正文支撑，标记【待核验】缺口",
          tools: [],
          status: "pending"
        }
      ]
    };
  }

  return {
    shape: "straight",
    title: "直达检索",
    leadRule: "短问直达：可委派单个 researcher 完成 Search→Fetch；Lead 综合引用后答复。",
    maxChildren: 1,
    searchBudget: { maxSearches: 2, maxFetches: 3, requireFetchBeforeClaim: true },
    steps: [
      {
        id: "research",
        title: "检索并抓取",
        role: "researcher",
        objective: "用最少工具拿到可引用正文，附 searchedAt 与 URL",
        tools: ["news_search_free", "web.fetch_page"],
        status: "pending"
      }
    ]
  };
}

/** Compact instruction block for Auto Lead / researcher SOP. */
export function buildResearchLeadInstruction(plan: ResearchPlan): string {
  const steps = plan.steps
    .map((step, index) => `${index + 1}. [${step.role}] ${step.title}: ${step.objective}`)
    .join(" ");
  return [
    `Research plan (${plan.shape}): ${plan.title}.`,
    plan.leadRule,
    `Max children=${plan.maxChildren}. Search budget: searches≤${plan.searchBudget.maxSearches}, fetches≤${plan.searchBudget.maxFetches}.`,
    "SOP: discovery search snippets are not full evidence; call web.fetch_page (or use orchestrator fetches) before factual claims.",
    "Always cite URLs and searchedAt. Prefer news_search_free before web.search_paid.",
    `Steps: ${steps}`
  ].join(" ");
}

/** Turn constraint appended for research-class Auto turns. */
export function buildResearchDelegateTurnConstraint(request: string): string {
  const plan = buildResearchPlan({ request });
  return [
    "【Research 编排约束】本回合为调研交付。Lead 先按 research_plan 委派，禁止父会话亲自长跑搜索。",
    buildResearchLeadInstruction(plan),
    request ? `原始用户请求：${request.trim()}` : ""
  ].filter(Boolean).join("\n");
}
