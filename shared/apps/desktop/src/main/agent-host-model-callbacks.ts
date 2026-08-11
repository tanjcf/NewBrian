interface ModelCallbackFailure {
  code: string;
  message: string;
}
interface PendingModelCallback {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout | null;
}

interface AgentHostModelCallbacksOptions {
  publish(payload: {
    runtimeId: string;
    callbackId: string;
    input: unknown;
  }): void;
  /** Inactivity budget. Streaming progress must call touch() to renew it. */
  timeoutMs?: number;
}

/**
 * Legacy default for tests that still construct callbacks with an explicit
 * inactivity budget. Production model/tool/policy callbacks use {@code 0}
 * (disabled): hang detection belongs to the parent agent.loop.advance budget
 * plus progress heartbeats (Codex / OpenClaw style), not a brittle 120s kill.
 */
export const DEFAULT_AGENT_MODEL_CALLBACK_TIMEOUT_MS = 0;

export class AgentHostModelCallbackError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentHostModelCallbackError";
    this.code = code;
  }
}

export class AgentHostModelCallbacks {
  private readonly options: AgentHostModelCallbacksOptions;
  private readonly pending = new Map<string, PendingModelCallback>();
  private readonly timeoutMs: number;
  private nextCallbackId = 1;
  private stopped = false;

  constructor(options: AgentHostModelCallbacksOptions) {
    this.options = options;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_MODEL_CALLBACK_TIMEOUT_MS;
  }

  get pendingCount() {
    return this.pending.size;
  }

  request(runtimeId: string, input: unknown) {
    if (this.stopped) {
      return Promise.reject(
        new AgentHostModelCallbackError(
          "host_shutting_down",
          "Agent host is shutting down."
        )
      );
    }
    const callbackId = `model_${this.nextCallbackId++}`;
    const promise = new Promise<unknown>((resolve, reject) => {
      const pending: PendingModelCallback = { resolve, reject, timer: null };
      this.armTimer(callbackId, pending);
      this.pending.set(callbackId, pending);
    });
    this.options.publish({ runtimeId, callbackId, input });
    return promise;
  }

  /** Renew the inactivity budget while the provider is still streaming or working. */
  touch(callbackId: string) {
    const pending = this.pending.get(callbackId);
    if (!pending) {
      return { callbackId, touched: false };
    }
    this.armTimer(callbackId, pending);
    return { callbackId, touched: true };
  }

  resolve(callbackId: string, result: unknown, error?: ModelCallbackFailure) {
    const pending = this.pending.get(callbackId);
    if (!pending) {
      throw new AgentHostModelCallbackError(
        "model_callback_not_found",
        `Agent model callback was not found: ${callbackId}`
      );
    }
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(callbackId);
    if (error) {
      pending.reject(new AgentHostModelCallbackError(error.code, error.message));
    } else {
      pending.resolve(result);
    }
    return { callbackId, resolved: true };
  }

  shutdown() {
    if (this.stopped) return;
    this.stopped = true;
    for (const [callbackId, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(
        new AgentHostModelCallbackError(
          "host_shutting_down",
          `Agent host stopped before model callback completed: ${callbackId}`
        )
      );
    }
    this.pending.clear();
  }

  private armTimer(callbackId: string, pending: PendingModelCallback) {
    if (pending.timer) clearTimeout(pending.timer);
    if (!(this.timeoutMs > 0) || !Number.isFinite(this.timeoutMs)) {
      pending.timer = null;
      return;
    }
    pending.timer = setTimeout(() => {
      this.pending.delete(callbackId);
      pending.reject(
        new AgentHostModelCallbackError(
          "model_callback_timeout",
          `Agent model callback timed out: ${callbackId}`
        )
      );
    }, this.timeoutMs);
  }
}
