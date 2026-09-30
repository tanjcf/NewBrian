export interface AutomationTimerServiceOptions {
  intervalMs: number;
  tick: () => Promise<void>;
  onError?: (error: unknown) => void;
  setInterval?: (callback: () => void, intervalMs: number) => unknown;
  clearInterval?: (timer: unknown) => void;
}

/** Owns the desktop automation polling lifecycle, including startup catch-up. */
export class AutomationTimerService {
  private readonly options: AutomationTimerServiceOptions;
  private readonly setIntervalFn: (callback: () => void, intervalMs: number) => unknown;
  private readonly clearIntervalFn: (timer: unknown) => void;
  private timer: unknown;

  constructor(options: AutomationTimerServiceOptions) {
    this.options = options;
    this.setIntervalFn = options.setInterval ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
    this.clearIntervalFn = options.clearInterval ?? ((timer) => clearInterval(timer as NodeJS.Timeout));
  }

  start() {
    if (this.timer !== undefined) return;
    const run = () => { void this.options.tick().catch((error) => this.options.onError?.(error)); };
    this.timer = this.setIntervalFn(run, this.options.intervalMs);
    run();
  }

  stop() {
    if (this.timer === undefined) return;
    this.clearIntervalFn(this.timer);
    this.timer = undefined;
  }
}
