import type { GrowthControlPlaneService } from "./growth-control-plane-service.ts";
import { readGrowthEnabledFromCapabilities } from "./growth-control-plane-service.ts";

export type GrowthHostServiceInput = {
  client: GrowthControlPlaneService;
  leaseOwner?: string;
  intervalMs?: number;
  isLocallyEnabled?: () => boolean;
  readCapabilities?: () => Promise<Record<string, unknown> | null | undefined>;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  /** Optional sink for poll failures (network down, 5xx). Never throws to the timer. */
  onError?: (error: unknown) => void;
};

/**
 * Polls spring Growth due instances, leases them, and advances auto cursors.
 * Human nodes are skipped until app callbacks resume the instance.
 */
export class GrowthHostService {
  private readonly client: GrowthControlPlaneService;
  private readonly leaseOwner: string;
  private readonly intervalMs: number;
  private readonly isLocallyEnabled: () => boolean;
  private readonly readCapabilities?: GrowthHostServiceInput["readCapabilities"];
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly onError?: GrowthHostServiceInput["onError"];
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickInFlight = false;
  private consecutiveFailures = 0;

  constructor(input: GrowthHostServiceInput) {
    this.client = input.client;
    this.leaseOwner = (input.leaseOwner || "newbrain-desktop-host").trim() || "newbrain-desktop-host";
    this.intervalMs = Math.max(5_000, Math.min(120_000, input.intervalMs ?? 15_000));
    this.isLocallyEnabled = input.isLocallyEnabled ?? (() => true);
    this.readCapabilities = input.readCapabilities;
    this.setIntervalFn = input.setIntervalFn ?? setInterval;
    this.clearIntervalFn = input.clearIntervalFn ?? clearInterval;
    this.onError = input.onError;
  }

  start(): void {
    if (this.timer) return;
    this.timer = this.setIntervalFn(() => {
      void this.tick().catch((error) => {
        this.consecutiveFailures += 1;
        // Avoid spamming the console every 15s when the gateway is down.
        if (this.consecutiveFailures === 1 || this.consecutiveFailures % 8 === 0) {
          this.onError?.(error);
        }
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    this.clearIntervalFn(this.timer);
    this.timer = null;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  async tick(): Promise<{ advanced: number; skipped: number }> {
    if (this.tickInFlight) return { advanced: 0, skipped: 0 };
    this.tickInFlight = true;
    let advanced = 0;
    let skipped = 0;
    try {
      if (!this.isLocallyEnabled()) return { advanced, skipped };
      if (this.readCapabilities) {
        const caps = await this.readCapabilities();
        if (!readGrowthEnabledFromCapabilities(caps ?? null)) {
          return { advanced, skipped };
        }
      }
      let due: Record<string, unknown>;
      try {
        due = await this.client.listDueInstances(20);
      } catch (error) {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures === 1 || this.consecutiveFailures % 8 === 0) {
          this.onError?.(error);
        }
        return { advanced, skipped };
      }
      this.consecutiveFailures = 0;
      const items = Array.isArray(due.items) ? due.items as Array<Record<string, unknown>> : [];
      for (const item of items) {
        const instanceId = String(item.id || "");
        if (!instanceId) continue;
        if (String(item.status || "") !== "running") {
          skipped += 1;
          continue;
        }
        try {
          await this.client.lease(instanceId, this.leaseOwner);
          const after = await this.client.advance(instanceId, { result: { host: this.leaseOwner } });
          const afterStatus = String(after.status || "");
          if (afterStatus === "waiting_human" || afterStatus === "waiting_async") {
            skipped += 1;
          } else {
            advanced += 1;
          }
        } catch {
          skipped += 1;
        }
      }
      return { advanced, skipped };
    } finally {
      this.tickInFlight = false;
    }
  }
}
