type TimerHandle = { unref?: () => void } | unknown;

export class DesktopControlPlaneHeartbeat {
  private timer: TimerHandle;
  private running = false;
  private readonly dependencies: {
    intervalMs: number;
    sync: () => Promise<unknown>;
    setInterval?: (callback: () => void, intervalMs: number) => TimerHandle;
    clearInterval?: (timer: TimerHandle) => void;
  };

  constructor(dependencies: {
    intervalMs: number;
    sync: () => Promise<unknown>;
    setInterval?: (callback: () => void, intervalMs: number) => TimerHandle;
    clearInterval?: (timer: TimerHandle) => void;
  }) {
    this.dependencies = dependencies;
  }

  start() {
    if (this.timer !== undefined) return;
    const setTimer = this.dependencies.setInterval
      ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
    this.timer = setTimer(() => {
      if (this.running) return;
      this.running = true;
      void this.dependencies.sync()
        .catch(() => undefined)
        .finally(() => { this.running = false; });
    }, this.dependencies.intervalMs);
    (this.timer as { unref?: () => void })?.unref?.();
  }

  stop() {
    if (this.timer === undefined) return;
    const clearTimer = this.dependencies.clearInterval
      ?? ((timer: TimerHandle) => clearInterval(timer as ReturnType<typeof setInterval>));
    clearTimer(this.timer);
    this.timer = undefined;
  }
}
