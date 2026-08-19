import type { PhaseOneSnapshot } from "@codex-forge/protocol";

export class LocalAgentRuntime {
  runtimeId: string;
  workspacePath: string;
  platformLabel: string;
  shellLabel: string;
  shellEnv: Record<string, string>;
  toolRegistry: {
    get(name: string): ToolDescriptor | undefined;
    list(): ToolDescriptor[];
    invoke(name: string, input: Record<string, unknown>, context: Record<string, unknown>): Promise<ToolExecutionResult>;
  };
  policyEngine: {
    setRules(rules: PolicyRule[]): void;
    listRules(): PolicyRule[];
  };
  memoryIndex: {
    list(): MemoryRecord[];
    search(query: string, options?: { limit?: number }): Array<MemoryRecord & { score?: number }>;
  };
  skillRegistry: {
    list(): SkillDescriptor[];
    match(prompt: string): SkillDescriptor[];
    load(name: string): Promise<LoadedSkill>;
  };
  agentLoop: { snapshot(): AgentLoopSnapshot } | null;
  orchestrator: {
    list(parentThreadId?: string): DelegatedAgentTask[];
  };
  sessionMachine: {
    state: string;
    events: unknown[];
    snapshot: PhaseOneSnapshot;
  };

  constructor(input: {
    runtimeId: string;
    workspacePath: string;
    platformLabel: string;
    shellLabel: string;
    shellEnv?: Record<string, string>;
    skillRoots?: string[];
    maxAgentConcurrency?: number;
    policyRules?: PolicyRule[];
    maxMemoryRecords?: number;
  });

  initialize(): Promise<void>;
  getSnapshot(): PhaseOneSnapshot;
  getToolDescriptors(): ToolDescriptor[];
  registerExternalTool(definition: Partial<ToolDescriptor> & { name: string; namespace?: string }, execute: (
    input: Record<string, unknown>,
    context: Record<string, unknown>
  ) => Promise<Record<string, unknown>>): unknown;
  unregisterExternalTools(namespace?: string): string[];
  getSkillDescriptors(): SkillDescriptor[];
  matchSkills(prompt: string): SkillDescriptor[];
  loadSkill(name: string): Promise<LoadedSkill>;
  addSkillRoots(roots: string[]): Promise<SkillDescriptor[]>;
  removeSkillRoots(roots: string[]): Promise<SkillDescriptor[]>;
  startAgentLoop(messages: AgentLoopMessage[], options?: {
    permissionMode?: "full" | "approval" | "agent";
    maxSteps?: number;
    onEvent?: (event: { type: string; payload: any }) => void;
  }): AgentLoopSnapshot;
  advanceAgentLoop(callModel: AgentModelCallback): Promise<AgentLoopSnapshot>;
  resumeAgentApproval(approved: boolean, callModel: AgentModelCallback): Promise<AgentLoopSnapshot>;
  getAgentLoopSnapshot(): AgentLoopSnapshot | null;
  delegateAgentTask(input: {
    id?: string;
    parentThreadId: string;
    childThreadId: string;
    title: string;
    instruction: string;
    owner: DelegatedAgentTask["owner"];
  }): DelegatedAgentTask;
  runDelegatedTask(taskId: string, runner: DelegatedAgentRunner): Promise<DelegatedAgentTask>;
  runDelegatedTasks(parentThreadId: string, runner: DelegatedAgentRunner): Promise<DelegatedAgentTask[]>;
  mergeDelegatedResults<T>(parentThreadId: string, taskIds: string[], merger: (tasks: DelegatedAgentTask[]) => Promise<T>): Promise<T>;
  listDelegatedTasks(parentThreadId?: string): DelegatedAgentTask[];
  restoreDelegatedTasks(tasks: DelegatedAgentTask[]): DelegatedAgentTask[];
  invokeTool(name: string, input: Record<string, unknown>, options?: { permissionMode?: PermissionMode }): Promise<ToolExecutionResult>;
  setPolicyRules(rules: PolicyRule[]): PolicyRule[];
  getPolicyRules(): PolicyRule[];
  evaluateToolPolicy(descriptor: ToolDescriptor, argumentsValue: Record<string, unknown>, permissionMode?: PermissionMode): PolicyDecision;
  setThreadState(input: {
    messages?: PhaseOneSnapshot["messages"];
    memories?: PhaseOneSnapshot["memories"];
    runs?: PhaseOneSnapshot["runs"];
    timeline?: PhaseOneSnapshot["timeline"];
  }): void;
  searchMemories(query: string, options?: { limit?: number }): Array<MemoryRecord & { score?: number }>;
  rememberExchange(input: { user: string; assistant: string; scope?: "workspace" | "session" | "user" }): MemoryRecord | null;
  rememberExchangeWithShadow(input: { user: string; assistant: string; scope?: "workspace" | "session" | "user" }): Promise<{
    memory: MemoryRecord | null;
    shadow: { skillName: string; skillPath: string; changed: string[] };
  }>;
  getMemories(): MemoryRecord[];
  exportThreadState(): {
    messages: PhaseOneSnapshot["messages"];
    memories: NonNullable<PhaseOneSnapshot["memories"]>;
    runs: PhaseOneSnapshot["runs"];
    timeline: NonNullable<PhaseOneSnapshot["timeline"]>;
  };
  setShellEnv(nextEnv?: Record<string, string>): void;
  switchWorkspace(nextWorkspacePath: string): Promise<PhaseOneSnapshot>;
  queueTool(name: string, input?: Record<string, unknown>, options?: { permissionMode?: PermissionMode }): Promise<PhaseOneSnapshot>;
  queueWorkspaceScan(options?: { permissionMode?: PermissionMode }): Promise<PhaseOneSnapshot>;
  queueGitStatus(options?: { permissionMode?: PermissionMode }): Promise<PhaseOneSnapshot>;
  queueShellCommand(command: string, options?: { permissionMode?: PermissionMode }): Promise<PhaseOneSnapshot>;
  respondToApproval(approved: boolean): Promise<PhaseOneSnapshot>;
  generatePatch(input: {
    filePath: string;
    searchText: string;
    replaceText: string;
  }): Promise<PhaseOneSnapshot>;
  applyPatch(): Promise<PhaseOneSnapshot>;
}

export interface ToolDescriptor {
  name: string;
  title: string;
  description: string;
  kind: "shell" | "read" | "write" | "patch" | "git";
  risk: "low" | "medium" | "high";
  requiresApproval: boolean;
  inputSchema: Record<string, unknown>;
}

export interface ToolExecutionResult {
  ok: boolean;
  toolName: string;
  durationMs: number;
  exitCode?: number;
  output?: string;
  command?: string;
  workspace?: PhaseOneSnapshot["workspace"];
  policy?: PolicyDecision;
}

export type PermissionMode = "full" | "approval" | "agent";

export interface PolicyRule {
  id?: string;
  toolName?: string;
  commandPrefix?: string;
  decision: "allow" | "ask" | "deny";
  enabled?: boolean;
  reason?: string;
}

export interface PolicyDecision {
  decision: "allow" | "ask" | "deny";
  source: "builtin" | "rule" | "permission" | "default";
  ruleId: string;
  reason: string;
}

export interface MemoryRecord {
  id: string;
  scope: "workspace" | "session" | "user";
  summary: string;
  createdAt: string;
  usageCount: number;
  lastUsedAt: string | null;
}

export interface SkillDescriptor {
  name: string;
  description: string;
  path: string;
  instructionPath: string;
  system: boolean;
}

export interface LoadedSkill extends SkillDescriptor {
  instructions: string;
  resources: Record<string, string[]>;
}

export interface AgentLoopMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** User-visible progress summary. It is safe to persist but is never sent as provider thinking context. */
  reasoningSummary?: string;
  /** Opaque provider thinking trace for the active in-memory tool continuation only. */
  providerReasoningContent?: string;
  toolCallId?: string;
  name?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string | Record<string, unknown> }>;
}

export interface AgentLoopSnapshot {
  status: "idle" | "running" | "awaiting-approval" | "completed" | "failed";
  steps: number;
  messages: AgentLoopMessage[];
  pending: null | { descriptor: ToolDescriptor; call: { id: string; name: string; arguments: Record<string, unknown> } };
  finalContent: string;
}

export type AgentModelCallback = (input: {
  messages: AgentLoopMessage[];
  tools: Array<{ type: "function"; name: string; description: string; parameters: Record<string, unknown>; strict: boolean }>;
  step: number;
}) => Promise<{
  content?: string;
  reasoningSummary?: string;
  providerReasoningContent?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string | Record<string, unknown> }>;
}>;

export interface DelegatedAgentTask {
  id: string;
  parentThreadId: string;
  childThreadId: string;
  title: string;
  instruction: string;
  owner: "planner" | "researcher" | "verifier" | "editor";
  status: "queued" | "running" | "completed" | "failed";
  summary: string;
  result: unknown;
  error: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export type DelegatedAgentRunner = (task: DelegatedAgentTask) => Promise<{ summary?: string; content?: string; [key: string]: unknown }>;

export function createLocalRuntime(input: {
  runtimeId: string;
  workspacePath: string;
  platformLabel: string;
  shellLabel: string;
  shellEnv?: Record<string, string>;
  skillRoots?: string[];
  maxAgentConcurrency?: number;
  policyRules?: PolicyRule[];
  maxMemoryRecords?: number;
}): Promise<LocalAgentRuntime>;
