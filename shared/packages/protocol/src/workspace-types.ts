export const brainWorkspaceFamilies = [
  { familyKey: "quant", displayName: "量化交易", modeKeys: ["quant"] },
  { familyKey: "game", displayName: "游戏制作", modeKeys: ["game"] },
  { familyKey: "media", displayName: "音视频创作", modeKeys: ["video", "music"] },
  { familyKey: "data", displayName: "数据与决策", modeKeys: ["data"] },
  { familyKey: "software", displayName: "软件与自动化", modeKeys: ["software"] },
  { familyKey: "document", displayName: "文档创作", modeKeys: ["document"] },
  { familyKey: "explore", displayName: "场景学习探索", modeKeys: ["explore"] }
] as const;

export const brainWorkspaceModes = [
  { workspaceKey: "quant", familyKey: "quant", displayName: "量化交易", icon: "workspace-quant", sortOrder: 10 },
  { workspaceKey: "game", familyKey: "game", displayName: "游戏制作", icon: "workspace-game", sortOrder: 20 },
  { workspaceKey: "video", familyKey: "media", displayName: "视频制作", icon: "workspace-video", sortOrder: 30 },
  { workspaceKey: "music", familyKey: "media", displayName: "音乐创作", icon: "workspace-music", sortOrder: 40 },
  { workspaceKey: "data", familyKey: "data", displayName: "数据与决策", icon: "workspace-data", sortOrder: 50 },
  { workspaceKey: "software", familyKey: "software", displayName: "软件与自动化", icon: "workspace-software", sortOrder: 60 },
  { workspaceKey: "document", familyKey: "document", displayName: "文档创作", icon: "workspace-document", sortOrder: 70 },
  { workspaceKey: "explore", familyKey: "explore", displayName: "场景学习探索", icon: "workspace-explore", sortOrder: 80 }
] as const;

export type BrainWorkspaceFamilyKey = (typeof brainWorkspaceFamilies)[number]["familyKey"];
export type BrainWorkspaceKey = (typeof brainWorkspaceModes)[number]["workspaceKey"];

export const brainWorkspaceKeys: readonly BrainWorkspaceKey[] = brainWorkspaceModes.map(
  (workspace) => workspace.workspaceKey
);

export function isBrainWorkspaceKey(value: unknown): value is BrainWorkspaceKey {
  return typeof value === "string" && brainWorkspaceKeys.includes(value as BrainWorkspaceKey);
}

export function getBrainWorkspaceMode(workspaceKey: BrainWorkspaceKey) {
  return brainWorkspaceModes.find((workspace) => workspace.workspaceKey === workspaceKey)!;
}
