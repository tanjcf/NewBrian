interface DelegatedLoopSnapshot {
  status: string;
  messages: Array<{ role: string; content: string }>;
  pending?: { call: { name: string } } | null;
  steps: number;
  finalContent?: string;
}

interface DelegatedLoopRuntime {
  startAgentLoop(messages: unknown[], options: Record<string, unknown>): unknown;
  restoreAgentLoop(snapshot: unknown, options: Record<string, unknown>): unknown;
  advanceAgentLoop(callback: (input: any) => Promise<any>): Promise<DelegatedLoopSnapshot>;
  resumeAgentApproval(
    approved: boolean,
    callback: (input: any) => Promise<any>
  ): Promise<DelegatedLoopSnapshot>;
  getAgentLoopSnapshot(): DelegatedLoopSnapshot | null;
}

interface DelegatedAgentLoopServiceOptions {
  runtime: DelegatedLoopRuntime;
  initialCheckpoint?: unknown;
  messages: unknown[];
  loopOptions: Record<string, unknown>;
  modelCallback: (input: any) => Promise<any>;
  persistCheckpoint: (snapshot: any) => Promise<unknown>;
  onAwaitingApproval: (snapshot: DelegatedLoopSnapshot) => Promise<unknown>;
  waitForApproval: () => Promise<boolean>;
  /** When true, delegated child tool gates auto-continue without blocking on UI approval. */
  autoApprove?: boolean;
}

const checkpointEventTypes = new Set([
  "model_response",
  "tool_result",
  "approval_requested",
  "agent_loop_completed",
  "agent_loop_failed"
]);

/** Runs a delegated loop through the runtime contract and serializes checkpoint writes. */
export async function runDelegatedAgentLoop(options: DelegatedAgentLoopServiceOptions) {
  let checkpointWrites = Promise.resolve();
  const persistCurrentCheckpoint = () => {
    const snapshot = options.runtime.getAgentLoopSnapshot();
    if (!snapshot) return;
    const checkpoint = structuredClone(snapshot);
    checkpointWrites = checkpointWrites.then(async () => {
      await options.persistCheckpoint(checkpoint);
    });
  };
  const loopOptions = {
    ...options.loopOptions,
    onEvent: (event: { type?: unknown }) => {
      if (typeof event.type === "string" && checkpointEventTypes.has(event.type)) {
        persistCurrentCheckpoint();
      }
    }
  };

  if (
    options.initialCheckpoint
    && typeof options.initialCheckpoint === "object"
    && ["running", "awaiting-approval"].includes(
      String((options.initialCheckpoint as { status?: unknown }).status ?? "")
    )
  ) {
    options.runtime.restoreAgentLoop(options.initialCheckpoint, loopOptions);
  } else {
    options.runtime.startAgentLoop(options.messages, loopOptions);
  }
  persistCurrentCheckpoint();

  let loop: DelegatedLoopSnapshot;
  try {
    const restored = options.runtime.getAgentLoopSnapshot();
    loop = restored?.status === "awaiting-approval"
      ? restored
      : await options.runtime.advanceAgentLoop(options.modelCallback);
  } finally {
    persistCurrentCheckpoint();
    await checkpointWrites;
  }

  while (loop.status === "awaiting-approval") {
    persistCurrentCheckpoint();
    await checkpointWrites;
    await options.onAwaitingApproval(loop);
    const approved = options.autoApprove ? true : await options.waitForApproval();
    loop = await options.runtime.resumeAgentApproval(approved, options.modelCallback);
  }
  persistCurrentCheckpoint();
  await checkpointWrites;
  return loop;
}
