export const EXPERT_WORKSPACE_LABELS: Record<string, string> = {
  quant: "量化交易", game: "游戏制作", video: "视频制作", music: "音乐创作",
  data: "数据与决策", software: "软件与自动化", document: "文档创作", explore: "场景学习探索"
};

const BUILTIN_WORKSPACES: Record<string, string[]> = {
  "software-delivery-team": ["software"],
  "senior-developer": ["software", "game"],
  "frontend-developer": ["software"],
  "wechat-miniprogram-developer": ["software"],
  "ui-designer": ["software", "game"],
  "data-analytics-reporter": ["data", "quant"],
  "content-creator": ["document", "video", "music"],
  "equity-research": ["quant", "data"],
  "ppt-creation-expert": ["document"],
  "long-document-writer": ["document"],
  "agency-engineering-code-reviewer": ["software", "game"],
  "agency-engineering-backend-architect": ["software"],
  "agency-testing-api-tester": ["software"],
  "agency-testing-reality-checker": ["software", "game", "video", "music", "data", "document"],
  "nuwa-andrej-karpathy-perspective": ["software", "data"],
  "nuwa-elon-musk-perspective": ["software", "data"],
  "nuwa-feynman-perspective": ["data", "document"],
  "nuwa-ilya-sutskever-perspective": ["software", "data"],
  "nuwa-mrbeast-perspective": ["video"],
  "nuwa-munger-perspective": ["quant", "data"],
  "nuwa-naval-perspective": ["data"],
  "nuwa-paul-graham-perspective": ["software", "data"],
  "nuwa-steve-jobs-perspective": ["software", "game", "video"],
  "nuwa-sun-yuchen-perspective": ["data", "document"],
  "nuwa-taleb-perspective": ["quant", "data"],
  "nuwa-trump-perspective": ["document"],
  "nuwa-x-mastery-mentor": ["document", "video"],
  "nuwa-zhang-yiming-perspective": ["software", "data"],
  "nuwa-zhangxuefeng-perspective": ["data", "document"],
  "nuwa-creator": [],
  "game-studios-delivery": ["game"],
  "ai-film-production": ["video"],
  "music-composer": ["music"],
  "quant-backtest": ["quant", "data"]
};

export function expertWorkspaceKeys(expert: { id?: string; name?: string; workspaceKeys?: string[]; preferredWorkspaceKey?: string }): string[] {
  const declared = expert.workspaceKeys ?? BUILTIN_WORKSPACES[expert.id || expert.name || ""]
    ?? (expert.preferredWorkspaceKey ? [expert.preferredWorkspaceKey] : []);
  return [...new Set(declared.filter(key => key !== "explore" && key in EXPERT_WORKSPACE_LABELS))];
}

export function isExpertAvailableInWorkspace(expert: Parameters<typeof expertWorkspaceKeys>[0], workspaceKey: string): boolean {
  return workspaceKey === "explore" || expertWorkspaceKeys(expert).includes(workspaceKey);
}
