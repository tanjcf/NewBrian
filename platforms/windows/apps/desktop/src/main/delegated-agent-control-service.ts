export interface DelegatedApprovalResponseInput<T> {
  childThreadId: string;
  approved: boolean;
  canResume: boolean;
  resume: () => Promise<T>;
}

/** Owns volatile child-agent run, steering, cancellation, and approval coordination state. */
export class DelegatedAgentControlService {
  private readonly runs = new Map<string, Promise<unknown>>();
  private readonly followups = new Map<string, string[]>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly approvalWaiters = new Map<string, (approved: boolean) => void>();
  private readonly approvalDecisions = new Map<string, boolean>();

  trackRun<T>(childThreadId: string, run: () => Promise<T>): Promise<T> {
    const active = this.runs.get(childThreadId);
    if (active) return active as Promise<T>;
    const tracked = Promise.resolve().then(run).finally(() => {
      if (this.runs.get(childThreadId) === tracked) this.runs.delete(childThreadId);
    });
    this.runs.set(childThreadId, tracked);
    return tracked;
  }

  getRun<T = unknown>(childThreadId: string) {
    return this.runs.get(childThreadId) as Promise<T> | undefined;
  }

  scheduleAfterDependencies<T>(input: {
    childThreadId: string;
    dependencyIds: string[];
    getDependencyStatus: (childThreadId: string) => string | undefined;
    onDependencyFailure: () => T | Promise<T>;
    run: () => Promise<T>;
  }) {
    return this.trackRun(input.childThreadId, async () => {
      await Promise.all(input.dependencyIds.map(async (dependency) => {
        const active = this.getRun(dependency);
        if (active) await active.catch(() => undefined);
      }));
      const dependencyFailed = input.dependencyIds.some((dependency) => {
        const status = String(input.getDependencyStatus(dependency) ?? "").toLowerCase();
        return status !== "completed";
      });
      return dependencyFailed ? input.onDependencyFailure() : input.run();
    });
  }

  queueFollowup(childThreadId: string, message: string) {
    const queue = [...(this.followups.get(childThreadId) ?? []), message].slice(-8);
    this.followups.set(childThreadId, queue);
    return queue.length;
  }

  drainFollowups(childThreadId: string) {
    const queue = this.followups.get(childThreadId) ?? [];
    this.followups.delete(childThreadId);
    return queue;
  }

  bindAbortController(childThreadId: string, controller: AbortController) {
    this.abortControllers.get(childThreadId)?.abort(new Error("Child agent runtime was replaced."));
    this.abortControllers.set(childThreadId, controller);
    return () => {
      if (this.abortControllers.get(childThreadId) === controller) this.abortControllers.delete(childThreadId);
    };
  }

  interrupt(childThreadId: string, reason = "Child agent interrupted by parent.") {
    const controller = this.abortControllers.get(childThreadId);
    if (controller && !controller.signal.aborted) controller.abort(new Error(reason));
    this.approvalDecisions.delete(childThreadId);
    this.approvalWaiters.get(childThreadId)?.(false);
    return Boolean(controller || this.approvalWaiters.has(childThreadId));
  }

  async waitForApproval(childThreadId: string, signal?: AbortSignal) {
    const queued = this.approvalDecisions.get(childThreadId);
    if (queued !== undefined) {
      this.approvalDecisions.delete(childThreadId);
      return queued;
    }
    if (signal?.aborted) return false;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (approved: boolean) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        if (this.approvalWaiters.get(childThreadId) === finish) this.approvalWaiters.delete(childThreadId);
        resolve(approved);
      };
      const onAbort = () => finish(false);
      this.approvalWaiters.set(childThreadId, finish);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  respondApproval<T>(input: DelegatedApprovalResponseInput<T>) {
    const waiter = this.approvalWaiters.get(input.childThreadId);
    if (waiter) {
      waiter(input.approved);
      return this.getRun<T>(input.childThreadId);
    }
    if (!input.canResume) {
      throw new Error("Delegated task is not awaiting approval and cannot be resumed.");
    }
    this.approvalDecisions.set(input.childThreadId, input.approved);
    return this.getRun<T>(input.childThreadId) ?? this.trackRun(input.childThreadId, input.resume);
  }

  clear(childThreadId: string) {
    this.interrupt(childThreadId, "Child agent control state was cleared.");
    this.runs.delete(childThreadId);
    this.followups.delete(childThreadId);
    this.abortControllers.delete(childThreadId);
    this.approvalWaiters.delete(childThreadId);
    this.approvalDecisions.delete(childThreadId);
  }
}
