export type SessionStatus = "idle" | "planning" | "running" | "awaiting-approval" | "failed";
export type MessageRole = "user" | "assistant" | "system";
export type WorkspaceEntryKind = "file" | "directory";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface SessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  workspacePath: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  attachments?: Array<{
    name: string;
    path: string;
    url: string;
  }>;
}

export interface WorkspaceEntry {
  path: string;
  name: string;
  kind: WorkspaceEntryKind;
  depth: number;
}

export interface ToolRequest {
  id: string;
  kind: "shell" | "read" | "write" | "patch" | "git";
  reason: string;
  risk: "low" | "medium" | "high";
  command?: string;
  targetPath?: string;
}

export interface ApprovalRequest {
  id: string;
  toolRequestId: string;
  message: string;
  requiresConfirmation: boolean;
}

export interface PatchHunk {
  header: string;
  additions: number;
  deletions: number;
  preview: string[];
}

export interface PatchProposal {
  id: string;
  filePath: string;
  hunks: PatchHunk[];
  summary: string;
}

export interface CommandRun {
  id: string;
  label: string;
  command: string;
  status: RunStatus;
  startedAt: string;
  exitCode?: number;
}

export interface MemoryRecord {
  id: string;
  scope: "workspace" | "session" | "user";
  summary: string;
  createdAt: string;
}

export interface WorkspaceThreadRecord {
  id: string;
  title: string;
  summary: string;
  scope?: "project" | "chat";
  updatedAt: string;
  lastEventSummary?: string;
  status?: "idle" | "running" | "awaiting-approval" | "failed";
  statusLabel?: string;
  branch?: string;
}

export interface WorkspaceTimelineEvent {
  id: string;
  type: "message" | "approval" | "patch" | "run" | "thread";
  title: string;
  detail: string;
  createdAt: string;
}

export interface WorkspaceCondaConfig {
  source: "system" | "managed";
  condaPath: string;
  envPath: string;
  envName: string;
  pythonVersion: string;
  lastCheckedAt?: string;
  lastProvisionedAt?: string;
}

export interface WorkspaceCatalogItem {
  id: string;
  name: string;
  path: string;
  threads: WorkspaceThreadRecord[];
  conda?: WorkspaceCondaConfig;
}

export interface SkillSpec {
  id: string;
  name: string;
  summary: string;
  status: "enabled" | "planned" | "disabled";
  icon?: string;
  source?: string;
  scope?: string;
  path?: string;
}

export interface PluginSpec {
  id: string;
  name: string;
  summary: string;
  status: "connected" | "planned" | "enabled" | "disabled";
  version?: string;
  source?: string;
  manifestPath?: string;
  publisher?: string;
  capabilities?: string[];
  skillRoots?: string[];
  mcpServerIds?: string[];
  lastError?: string;
}

export interface AutomationSpec {
  id: string;
  title: string;
  status: "idle" | "scheduled" | "running" | "paused";
  trigger: string;
  prompt?: string;
  schedule?: string;
  runtime?: string;
  model?: string;
  reasoning?: string;
  rrule?: string;
  workspaceId?: string;
  threadId?: string;
  action?: "workspace_scan" | "git_status";
  intervalMinutes?: number;
  dailyTime?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  failureCount?: number;
  lastError?: string;
}

export interface SearchResultSpec {
  id: string;
  kind: "workspace" | "thread" | "timeline" | "message" | "memory" | "file";
  title: string;
  detail: string;
  workspaceId?: string;
  threadId?: string;
  filePath?: string;
  createdAt?: string;
}

export interface PhaseOneSnapshot {
  session: SessionSummary;
  messages: ChatMessage[];
  workspace: WorkspaceEntry[];
  pendingTool?: ToolRequest;
  approval?: ApprovalRequest;
  patch?: PatchProposal;
  runs: CommandRun[];
  memories?: MemoryRecord[];
  timeline?: WorkspaceTimelineEvent[];
  automations?: AutomationSpec[];
}
