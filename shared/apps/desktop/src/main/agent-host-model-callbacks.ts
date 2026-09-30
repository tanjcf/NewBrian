interface ModelCallbackFailure {
  code: string;
  message: string;
}
interface PendingModelCallback {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface AgentHostModelCallbacksOptions {
  publish(payload: {
    runtimeId: string;
    callbackId: string;
    input: unknown;
  }): void;
}

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
  private nextCallbackId = 1;
  private stopped = false;

  constructor(options: AgentHostModelCallbacksOptions) {
    this.options = options;
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
      const pending: PendingModelCallback = { resolve, reject };
      this.pending.set(callbackId, pending);
    });
    this.options.publish({ runtimeId, callbackId, input });
    return promise;
  }

  /** Confirm that a callback is still registered; progress never changes its lifetime. */
  touch(callbackId: string) {
    const pending = this.pending.get(callbackId);
    if (!pending) {
      return { callbackId, touched: false };
    }
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
      pending.reject(
        new AgentHostModelCallbackError(
          "host_shutting_down",
          `Agent host stopped before model callback completed: ${callbackId}`
        )
      );
    }
    this.pending.clear();
  }
}
