import {
  AgentLoop
// @ts-expect-error Node's native TypeScript test runner requires the source extension.
} from "./agent-runtime-adapter.ts";

interface HostedToolDescriptor {
  name: string;
  title: string;
  description: string;
  kind: string;
  risk: string;
  requiresApproval?: boolean;
  inputSchema: Record<string, unknown>;
}
interface HostedLoopOptions {
  permissionMode?: "full" | "approval" | "agent";
  maxSteps?: number;
  allowedToolNames?: string[];
  toolDescriptors?: HostedToolDescriptor[];
}

interface HostedAgentLoopRuntimeOptions {
  runtimeId: string;
  onSessionEvent?(event: unknown): void;
  requestModel(input: unknown): Promise<unknown>;
  requestPolicy(input: {
    runtimeId: string;
    descriptor: HostedToolDescriptor;
    call: { id: string; name: string; arguments: Record<string, unknown> };
    permissionMode: "full" | "approval" | "agent";
  }): Promise<unknown>;
  requestTool(input: {
    runtimeId: string;
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
}

function createToolRegistry(
  runtimeId: string,
  descriptors: HostedToolDescriptor[],
  requestTool: HostedAgentLoopRuntimeOptions["requestTool"]
) {
  const tools = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
  return {
    get(name: string) {
      return tools.get(name);
    },
    list() {
      return [...tools.values()];
    },
    invoke(
      name: string,
      input: Record<string, unknown>
    ) {
      return requestTool({ runtimeId, name, arguments: input });
    }
  };
}

export class HostedAgentLoopRuntime {
  readonly sessionMachine = { events: [] as unknown[] };
  private readonly options: HostedAgentLoopRuntimeOptions;
  private loop: InstanceType<typeof AgentLoop> | null = null;
  private permissionMode: "full" | "approval" | "agent" = "agent";

  constructor(options: HostedAgentLoopRuntimeOptions) {
    this.options = options;
  }

  startAgentLoop(messages: unknown[], options: HostedLoopOptions = {}) {
    this.loop = this.createLoop(options);
    return this.loop.start(messages);
  }

  restoreAgentLoop(snapshot: unknown, options: HostedLoopOptions = {}) {
    this.loop = this.createLoop(options);
    return this.loop.restore(snapshot);
  }

  advanceAgentLoop() {
    return this.requireLoop().advance((input: unknown) =>
      this.options.requestModel(input)
    );
  }

  resumeAgentApproval(approved: boolean) {
    return this.requireLoop().resumeApproval(
      approved,
      (input: unknown) => this.options.requestModel(input)
    );
  }

  getAgentLoopSnapshot() {
    return this.loop?.snapshot() ?? null;
  }

  steerAgentLoop(message: string | {
    content?: string;
    message?: string;
    attachments?: Array<{ name?: string; path: string; url?: string }>;
  }) {
    return this.requireLoop().steer(message);
  }

  cancelAgentLoop(reason?: string) {
    return this.requireLoop().cancel(reason);
  }

  setPermissionMode(mode: "full" | "approval" | "agent") {
    this.permissionMode = mode === "full" ? "full" : mode === "approval" ? "approval" : "agent";
  }

  private createLoop(options: HostedLoopOptions) {
    this.setPermissionMode(
      options.permissionMode === "full" ? "full" : options.permissionMode === "approval" ? "approval" : "agent"
    );
    const toolRegistry = createToolRegistry(
      this.options.runtimeId,
      options.toolDescriptors ?? [],
      this.options.requestTool
    );
    return new AgentLoop({
      toolRegistry,
      maxSteps: options.maxSteps,
      allowedToolNames: options.allowedToolNames,
      authorize: (descriptor: HostedToolDescriptor, call: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }) => this.options.requestPolicy({
        runtimeId: this.options.runtimeId,
        descriptor,
        call,
        permissionMode: this.permissionMode
      }),
      onEvent: (event: unknown) => {
        this.sessionMachine.events.push(event);
        this.options.onSessionEvent?.(event);
      }
    });
  }

  private requireLoop() {
    if (!this.loop) {
      throw new Error("Agent loop has not been started.");
    }
    return this.loop;
  }
}

export function createHostedAgentLoopRuntime(
  options: HostedAgentLoopRuntimeOptions
) {
  return new HostedAgentLoopRuntime(options);
}
