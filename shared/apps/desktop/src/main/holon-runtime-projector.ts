import type { HolonRuntimeEvent } from "@codex-forge/protocol";
import type { CodexStorage } from "./codex-storage.js";
import { sanitizeRemoteAgentEvent } from "./remote-event-sanitizer.js";

type HolonRuntimeContext = {
  workItemId: string;
  threadId?: string;
  turnId?: string;
};

type HolonRuntimeProjectorInput = {
  storage: CodexStorage;
  createId?: (prefix: string, sequence: number) => string;
  nowIso?: () => string;
  nowMs?: () => number;
};

export class HolonRuntimeProjector {
  private readonly storage: CodexStorage;
  private readonly createId: NonNullable<HolonRuntimeProjectorInput["createId"]>;
  private readonly nowIso: () => string;
  private readonly nowMs: () => number;

  constructor(input: HolonRuntimeProjectorInput) {
    this.storage = input.storage;
    this.createId = input.createId ?? ((prefix, sequence) =>
      `${prefix}_${Date.now().toString(36)}_${sequence.toString(36)}_${crypto.randomUUID().replace(/-/g, "")}`);
    this.nowIso = input.nowIso ?? (() => new Date().toISOString());
    this.nowMs = input.nowMs ?? Date.now;
  }

  project(context: HolonRuntimeContext, agentEvent: { type: string; payload?: unknown }): HolonRuntimeEvent | null {
    const sanitized = sanitizeRemoteAgentEvent(agentEvent);
    if (!sanitized) return null;
    const sequenceNo = this.storage.nextRemoteEventSequence(context.workItemId);
    const event: HolonRuntimeEvent = {
      schemaVersion: 1,
      eventId: this.createId("evt", sequenceNo),
      workItemId: context.workItemId,
      threadId: context.threadId,
      turnId: context.turnId,
      sequenceNo,
      eventType: sanitized.eventType,
      occurredAt: this.nowIso(),
      payload: sanitized.payload
    };
    const nowMs = this.nowMs();
    this.storage.appendRemoteEvent({
      eventId: event.eventId,
      workItemId: event.workItemId,
      sequenceNo,
      payloadJson: JSON.stringify(event),
      status: "pending",
      attemptCount: 0,
      nextAttemptAtMs: nowMs,
      createdAtMs: nowMs
    });
    return event;
  }
}
