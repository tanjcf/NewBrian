import type { HolonEventBatchResult, HolonRuntimeEvent } from "@codex-forge/protocol";
import type { CodexStorage, PersistedRemoteEvent } from "./codex-storage.js";
import { validateHolonRuntimeEvents } from "./holon-contract.js";

type HolonOutboxServiceInput = {
  storage: CodexStorage;
  sendEvents: (events: HolonRuntimeEvent[]) => Promise<HolonEventBatchResult>;
  now?: () => number;
};

export class HolonOutboxService {
  private readonly storage: CodexStorage;
  private readonly sendEvents: HolonOutboxServiceInput["sendEvents"];
  private readonly now: () => number;
  private currentFlush: Promise<{ sent: number; pending: number; quarantined?: number }> | null = null;

  constructor(input: HolonOutboxServiceInput) {
    this.storage = input.storage;
    this.sendEvents = input.sendEvents;
    this.now = input.now ?? Date.now;
  }

  flush(): Promise<{ sent: number; pending: number; quarantined?: number }> {
    if (this.currentFlush) return this.currentFlush;
    this.currentFlush = this.flushOnce().finally(() => {
      this.currentFlush = null;
    });
    return this.currentFlush;
  }

  private async flushOnce(): Promise<{ sent: number; pending: number; quarantined?: number }> {
    const nowMs = this.now();
    const rows = this.storage.listDueRemoteEvents(100, nowMs);
    if (!rows.length) return { sent: 0, pending: 0 };
    const eventIds = rows.map((row) => row.eventId);
    this.storage.markRemoteEventsSending(eventIds);
    try {
      const payloads = validateHolonRuntimeEvents(rows.map(parsePayload));
      const result = await this.sendEvents(payloads);
      if (result.total !== rows.length || result.accepted + result.duplicate !== result.total) {
        throw new Error("HOLON_EVENT_ACK_MISMATCH");
      }
      this.storage.acknowledgeRemoteEvents(eventIds, this.now());
      return { sent: rows.length, pending: 0 };
    } catch (error) {
      const message = stableError(error);
      if (message.startsWith("HOLON_HTTP_409:") || message === "HOLON_EVENT_ACK_MISMATCH") {
        this.storage.quarantineRemoteEvents(eventIds, message);
        return { sent: 0, pending: 0, quarantined: eventIds.length };
      }
      const nextAttemptAtMs = nowMs + retryDelay(rows);
      this.storage.retryRemoteEvents(eventIds, nextAttemptAtMs, message);
      return { sent: 0, pending: rows.length };
    }
  }
}

function parsePayload(row: PersistedRemoteEvent): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payloadJson);
  } catch {
    throw new Error("HOLON_OUTBOX_PAYLOAD_INVALID");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("HOLON_OUTBOX_PAYLOAD_INVALID");
  }
  return parsed as Record<string, unknown>;
}

function retryDelay(rows: PersistedRemoteEvent[]): number {
  const attempt = Math.max(...rows.map((row) => row.attemptCount), 0) + 1;
  return Math.min(300_000, 1_000 * (2 ** Math.min(attempt, 8)));
}

function stableError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 240);
  return "HOLON_EVENT_UPLOAD_FAILED";
}
