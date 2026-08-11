import type { DesktopFailureInput } from "./desktop-error-outbox.js";

interface ChildProcessGoneDetails {
  type?: string;
  reason?: string;
  exitCode?: number;
  serviceName?: string;
  name?: string;
}

/** Filters normal exits and Chromium's self-recovering Network Service restart. */
export function isReportableChildProcessGone(details: ChildProcessGoneDetails) {
  if (["clean-exit", "killed"].includes(details.reason ?? "")) return false;
  return !(
    details.type === "Utility"
    && details.reason === "crashed"
    && details.serviceName === "network.mojom.NetworkService"
    && details.name === "Network Service"
  );
}

interface TimerHandle {
  unref?: () => void;
}

interface DesktopErrorCollectorDependencies {
  capture: (failure: DesktopFailureInput) => Promise<unknown>;
  flush: () => Promise<unknown>;
  setInterval?: (callback: () => void, intervalMs: number) => TimerHandle;
  clearInterval?: (timer: TimerHandle) => void;
  onDiagnostic?: (message: string) => void;
  intervalMs?: number;
}

/** Serializes durable error capture and background delivery to the server. */
export class DesktopErrorCollector {
  private readonly dependencies: DesktopErrorCollectorDependencies;
  private queue = Promise.resolve();
  private timer: TimerHandle | null = null;

  constructor(dependencies: DesktopErrorCollectorDependencies) {
    this.dependencies = dependencies;
  }

  start() {
    if (this.timer) return;
    this.enqueueFlush();
    const setTimer = this.dependencies.setInterval
      ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
    this.timer = setTimer(() => this.enqueueFlush(), this.dependencies.intervalMs ?? 30_000);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    const clearTimer = this.dependencies.clearInterval
      ?? ((timer) => clearInterval(timer as NodeJS.Timeout));
    clearTimer(this.timer);
    this.timer = null;
  }

  report(failure: DesktopFailureInput) {
    return this.reportWithResult(failure).catch(() => undefined);
  }

  /** Capture durably and expose delivery evidence to explicit user submissions. */
  reportWithResult(failure: DesktopFailureInput) {
    const operation = this.queue.then(async () => {
      const capture = await this.dependencies.capture(failure);
      const flush = await this.flushSafely();
      return { capture, flush };
    });
    this.queue = operation.then(
      () => undefined,
      (error) => this.diagnose("capture", error)
    );
    return operation;
  }

  whenIdle() {
    return this.queue;
  }

  private enqueueFlush() {
    this.queue = this.queue.then(async () => {
      await this.flushSafely();
    });
  }

  private async flushSafely() {
    try {
      return await this.dependencies.flush();
    } catch (error) {
      this.diagnose("upload", error);
      return undefined;
    }
  }

  private diagnose(stage: string, error: unknown) {
    this.dependencies.onDiagnostic?.(
      `desktop error collector ${stage} failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
