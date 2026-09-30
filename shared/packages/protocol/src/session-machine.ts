import type { AgentEvent, PhaseOneSnapshot, SessionStatus } from "./index";

export interface SessionMachine {
  runtimeId: string;
  state: SessionStatus;
  events: AgentEvent[];
  snapshot: PhaseOneSnapshot;
}

export function createSessionMachine(input: { runtimeId: string }): SessionMachine {
  return {
    runtimeId: input.runtimeId,
    state: "idle",
    events: [
      {
        id: "boot",
        type: "runtime.boot",
        timestamp: new Date(0).toISOString(),
        payload: {
          runtimeId: input.runtimeId
        }
      }
    ],
    snapshot: {
      session: {
        id: input.runtimeId,
        title: "Local coding agent",
        status: "idle",
        workspacePath: ""
      },
      messages: [
        {
          id: "m1",
          role: "system",
          content: "Runtime booted and waiting for a workspace-bound task.",
          createdAt: new Date(0).toISOString()
        }
      ],
      workspace: [
        {
          path: "src",
          name: "src",
          kind: "directory",
          depth: 0
        },
        {
          path: "src/main.ts",
          name: "main.ts",
          kind: "file",
          depth: 1
        }
      ],
      runs: [],
      delegatedTasks: [],
      modelRoutes: [],
      memories: [],
      automations: []
    }
  };
}
