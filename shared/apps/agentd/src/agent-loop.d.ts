export interface AgentLoopSnapshot {
  status: "idle" | "running" | "awaiting-approval" | "completed" | "failed";
  steps: number;
  messages: unknown[];
  pending: unknown;
  finalContent: string;
}

export interface AgentLoopToolDescriptor {
  name: string;
  title: string;
  description: string;
  kind: string;
  risk: string;
  requiresApproval?: boolean;
  inputSchema: Record<string, unknown>;
}

export interface AgentLoopToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export class AgentLoop {
  constructor(input: {
    toolRegistry: {
      get(name: string): AgentLoopToolDescriptor | undefined;
      list(): AgentLoopToolDescriptor[];
      invoke(name: string, input: Record<string, unknown>, context?: unknown): Promise<unknown>;
    };
    toolContext?: unknown;
    maxSteps?: number; // omit / <=0 / Infinity = unlimited
    allowedToolNames?: string[];
    authorize?: (
      descriptor: AgentLoopToolDescriptor,
      call: AgentLoopToolCall
    ) => unknown | Promise<unknown>;
    onEvent?: (event: unknown) => void;
    abortSignal?: AbortSignal | null;
  });
  start(messages: unknown[]): AgentLoopSnapshot;
  restore(snapshot: unknown): AgentLoopSnapshot;
  advance(callModel: (input: unknown) => Promise<unknown>): Promise<AgentLoopSnapshot>;
  resumeApproval(
    approved: boolean,
    callModel: (input: unknown) => Promise<unknown>
  ): Promise<AgentLoopSnapshot>;
  snapshot(): AgentLoopSnapshot;
  steer(message: string): AgentLoopSnapshot;
  cancel(reason?: string): AgentLoopSnapshot;
}
