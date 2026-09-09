export type ResearchWritingStage = "materials" | "outline" | "draft" | "style" | "verify";

export interface ResearchWritingSession {
  enabled: boolean;
  stage: ResearchWritingStage;
  topic: string;
  targetWords: number;
  confirmedOutline: string;
  intakeAnswers: Record<string, string>;
  intakeComplete: boolean;
  intakeHistory: Array<{ question: string; answer: string }>;
  requestText: string;
}

export interface DynamicResearchIntakeQuestion {
  id: string;
  prompt: string;
  options: Array<{ label: string; description: string; recommended?: boolean }>;
  progress: { current: number; total: number };
}

export interface DynamicResearchPlanStep {
  id: string;
  title: string;
  description: string;
  status: "pending" | "active" | "completed";
  result?: string;
}

export interface FactRisk {
  category: "data" | "policy" | "time" | "administrative-level" | "unverified";
  label: string;
  matches: string[];
  severity: "warning" | "high";
}

export interface ResearchWritingSource {
  title: string;
  sourceType: "政府官网" | "中央媒体" | "地方媒体" | "普通链接" | "用户附件" | "用户输入";
  url?: string;
  content: string;
}

type ResearchSourceTurn = {
  user?: {
    content?: string;
    attachments?: Array<{ name?: string; path?: string; url?: string }>;
  };
};

const CENTRAL_MEDIA_HOSTS = ["people.com.cn", "xinhuanet.com", "cctv.com", "cnr.cn", "ce.cn", "chinadaily.com.cn"];
const LOCAL_MEDIA_HOST_PATTERN = /(?:daily|news|media|tv|rb|wb)\./i;

export function classifyResearchSource(url = ""): ResearchWritingSource["sourceType"] {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "gov.cn" || host.endsWith(".gov.cn")) return "政府官网";
    if (CENTRAL_MEDIA_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "中央媒体";
    if (LOCAL_MEDIA_HOST_PATTERN.test(host)) return "地方媒体";
    return "普通链接";
  } catch {
    return "用户输入";
  }
}

export function buildResearchWritingSources(turns: ResearchSourceTurn[]): ResearchWritingSource[] {
  const sources: ResearchWritingSource[] = [];
  turns.forEach((turn, index) => {
    const content = String(turn.user?.content ?? "").trim();
    const syntheticDecision = /^目标决策：[\s\S]*\n用户选择：/u.test(content);
    if (content && !syntheticDecision) {
      const urls = [...new Set(content.match(/https?:\/\/[^\s)\]}>，。；]+/gi) ?? [])];
      const primaryUrl = urls[0];
      sources.push({
        title: primaryUrl ? `链接素材 ${index + 1}` : `用户素材 ${index + 1}`,
        sourceType: primaryUrl ? classifyResearchSource(primaryUrl) : "用户输入",
        ...(primaryUrl ? { url: primaryUrl } : {}),
        content
      });
    }
    for (const attachment of turn.user?.attachments ?? []) {
      const name = String(attachment.name || attachment.path || "用户附件").trim();
      if (!name) continue;
      sources.push({
        title: name,
        sourceType: "用户附件",
        ...(attachment.url ? { url: attachment.url } : {}),
        content: `附件：${name}`
      });
    }
  });
  return sources.filter((source, index) => sources.findIndex((candidate) =>
    candidate.sourceType === source.sourceType && candidate.url === source.url && candidate.content === source.content
  ) === index);
}

export function defaultResearchWritingSession(): ResearchWritingSession {
  return { enabled: false, stage: "materials", topic: "", targetWords: 3000, confirmedOutline: "", intakeAnswers: {}, intakeComplete: false, intakeHistory: [], requestText: "" };
}

export function researchWritingStorageKey(workspaceId?: string, threadId?: string): string {
  return `newbrain.research-writing.v2:${workspaceId || "global"}:${threadId || "draft"}`;
}

export function buildResearchWritingSkillInvocation(session: ResearchWritingSession, userText = ""): string {
  const task = userText.trim() || "请读取当前对话与附件中的素材，先建立素材台账并确认选题和结构约束；不要直接生成全文。";
  const knownContext = [
    session.topic ? `选题：${session.topic}` : "",
    session.targetWords ? `目标篇幅：${Math.max(800, session.targetWords)}字` : "",
    session.confirmedOutline ? `已确认提纲：\n${session.confirmedOutline}` : ""
  ].filter(Boolean).join("\n");
  return [`使用 $government-research-writing。`, knownContext, task].filter(Boolean).join("\n\n");
}

export function scanFactRisks(text: string): FactRisk[] {
  const definitions: Array<[FactRisk["category"], string, RegExp, FactRisk["severity"]]> = [
    ["data", "数据", /(?:\d+(?:\.\d+)?%|\d+(?:\.\d+)?(?:亿元|万元|万人|万亩|平方公里|个项目))/g, "warning"],
    ["policy", "政策文件名", /《[^》]{2,80}》/g, "warning"],
    ["time", "时间节点", /(?:20\d{2}年(?:\d{1,2}月(?:\d{1,2}日)?)?)/g, "warning"],
    ["administrative-level", "行政层级", /(?:县级市|地级市|副省级市|自治州|县|区)/g, "high"],
    ["unverified", "待核验内容", /【待核验】[^\n。；]*/g, "high"]
  ];
  return definitions.flatMap(([category, label, pattern, severity]) => {
    const matches = [...new Set(text.match(pattern) || [])];
    return matches.length ? [{ category, label, matches, severity }] : [];
  });
}

export function buildPlainTextExport(title: string, body: string, risks: FactRisk[] = []): string {
  const cleanTitle = title.trim() || "地方实践文章";
  const appendix = risks.length
    ? `\n\n事实校验附录\n${risks.map((risk) => `- [${risk.label}/${risk.severity}] ${risk.matches.join("、")}`).join("\n")}`
    : "";
  return `${cleanTitle}\n\n${body.trim()}${appendix}\n`;
}
