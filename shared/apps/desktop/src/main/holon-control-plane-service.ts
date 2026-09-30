import type {
  HolonEventBatchResult,
  HolonKnowledgeSearchResult,
  HolonKnowledgeSnapshot,
  HolonLearningCandidate,
  HolonRuntimeEvent,
  HolonWorkItem
} from "@codex-forge/protocol";
import {
  parseHolonKnowledgeSnapshot,
  parseHolonKnowledgeSearchResult,
  parseHolonLearningCandidate,
  parseHolonWorkItem,
  validateHolonRuntimeEvents
} from "./holon-contract.js";

export type HolonConnection = {
  gatewayOrigin: string;
  deviceId: string;
  headers: Record<string, string>;
};

type HolonControlPlaneServiceInput = {
  getConnection: () => Promise<HolonConnection>;
  refreshConnection?: () => Promise<HolonConnection>;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export class HolonControlPlaneService {
  async expertPreferences(scope: string): Promise<import("./expert-collaboration.js").ExpertPreference[]> {
    const connection = await this.getConnection();
    const result = object(await this.request(connection, "GET", `/api/desktop/v1/experts/preferences?scope=${encodeURIComponent(scope)}`));
    if (!Array.isArray(result.items)) throw new Error("EXPERT_PREFERENCES_INVALID");
    return result.items as import("./expert-collaboration.js").ExpertPreference[];
  }

  async saveExpertPreference(input: import("./expert-collaboration.js").ExpertPreference) {
    const connection = await this.getConnection();
    return this.request(connection, "POST", "/api/desktop/v1/experts/preferences", input);
  }
  private readonly getConnection: HolonControlPlaneServiceInput["getConnection"];
  private readonly fetchImpl: typeof fetch;
  private readonly refreshConnection?: HolonControlPlaneServiceInput["refreshConnection"];
  private readonly now: () => number;

  constructor(input: HolonControlPlaneServiceInput) {
    this.getConnection = input.getConnection;
    this.refreshConnection = input.refreshConnection;
    this.fetchImpl = input.fetchImpl ?? fetch;
    this.now = input.now ?? Date.now;
  }

  async claimNextWorkItem(): Promise<HolonWorkItem | null> {
    const connection = await this.getConnection();
    const envelope = await this.request(connection, "GET",
      `/api/desktop/v1/holon/work-items/next?device_id=${encodeURIComponent(connection.deviceId)}`);
    const item = object(envelope).item;
    if (isEmptyObject(item)) return null;
    const workItem = parseHolonWorkItem(item);
    if (workItem.targetDeviceId !== connection.deviceId) throw new Error("HOLON_TARGET_DEVICE_MISMATCH");
    if (Date.parse(workItem.leaseUntil) <= this.now()) throw new Error("HOLON_LEASE_EXPIRED");
    return workItem;
  }

  async heartbeat(workItemId: string): Promise<{ workItemId: string; leaseUntil: string }> {
    const connection = await this.getConnection();
    const envelope = object(await this.request(connection, "POST",
      `/api/desktop/v1/holon/work-items/${encodeId(workItemId)}/heartbeat?device_id=${encodeURIComponent(connection.deviceId)}`));
    return {
      workItemId: requiredString(envelope.work_item_id, "HOLON_WORK_ITEM_ID_INVALID"),
      leaseUntil: requiredTimestamp(envelope.lease_until)
    };
  }

  async getControl(workItemId: string): Promise<Record<string, unknown>> {
    const connection = await this.getConnection();
    const envelope = object(await this.request(connection, "GET",
      `/api/desktop/v1/holon/work-items/${encodeId(workItemId)}/control?device_id=${encodeURIComponent(connection.deviceId)}`));
    return ownerFreeObject(envelope.control);
  }

  async requestCancel(workItemId: string): Promise<void> {
    const connection = await this.getConnection();
    await this.request(connection, "POST",
      `/api/desktop/v1/holon/work-items/${encodeId(workItemId)}/cancel?device_id=${encodeURIComponent(connection.deviceId)}`);
  }

  async sendEvents(events: HolonRuntimeEvent[]): Promise<HolonEventBatchResult> {
    const validated = validateHolonRuntimeEvents(events);
    const connection = await this.getConnection();
    const envelope = object(await this.request(connection, "POST", "/api/desktop/v1/holon/events:batch", {
      schema_version: 1,
      device_id: connection.deviceId,
      events: validated.map(toSpringEvent)
    }));
    const accepted = nonNegativeInteger(envelope.accepted, "HOLON_EVENT_ACK_INVALID");
    const duplicate = nonNegativeInteger(envelope.duplicate, "HOLON_EVENT_ACK_INVALID");
    const total = nonNegativeInteger(envelope.total, "HOLON_EVENT_ACK_INVALID");
    if (envelope.ok !== true || accepted + duplicate !== total) throw new Error("HOLON_EVENT_ACK_INVALID");
    return { ok: true, accepted, duplicate, total };
  }

  async getKnowledgeSnapshot(snapshotId: string): Promise<HolonKnowledgeSnapshot> {
    const connection = await this.getConnection();
    const envelope = object(await this.request(connection, "GET",
      `/api/desktop/v1/knowledge/snapshots/${encodeId(snapshotId)}`));
    return parseHolonKnowledgeSnapshot(envelope.snapshot);
  }

  async listCandidates(limit = 50): Promise<HolonLearningCandidate[]> {
    const connection = await this.getConnection();
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const envelope = object(await this.request(connection, "GET",
      `/api/desktop/v1/learning/candidates?limit=${safeLimit}`));
    return boundedList(envelope.items).map(parseHolonLearningCandidate);
  }

  async submitCandidate(input: { skill_key: string; source: string; upstream_commit: string; files: Record<string, string> }) {
    return this.mutateLearning("/api/desktop/v1/learning/candidates/import", input);
  }

  async evaluateOpenSpace(input: Record<string, unknown>) {
    return this.mutateLearning("/api/desktop/v1/learning/openspace/evaluate", input);
  }

  async searchKnowledge(query: string, limit = 20): Promise<HolonKnowledgeSearchResult[]> {
    const normalized = query.trim();
    if (!normalized || normalized.length > 2_000) throw new Error("HOLON_QUERY_INVALID");
    const connection = await this.getConnection();
    const safeLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
    const envelope = object(await this.request(connection, "GET",
      `/api/desktop/v1/learning/knowledge/search?q=${encodeURIComponent(normalized)}&limit=${safeLimit}`));
    return boundedList(envelope.items).map(parseHolonKnowledgeSearchResult);
  }

  async approveCandidate(versionId: string): Promise<Record<string, unknown>> {
    return this.mutateLearning(`/api/desktop/v1/learning/candidates/${encodeId(versionId)}/approve`);
  }

  async rejectCandidate(versionId: string): Promise<Record<string, unknown>> {
    return this.mutateLearning(`/api/desktop/v1/learning/candidates/${encodeId(versionId)}/reject`);
  }

  async rollbackSkill(skillKey: string, targetVersionId: string): Promise<Record<string, unknown>> {
    return this.mutateLearning(
      `/api/desktop/v1/learning/skills/${encodeId(skillKey, 255)}/rollback`,
      { target_version_id: requiredString(targetVersionId, "HOLON_VERSION_ID_INVALID", 80) }
    );
  }

  async submitFeedback(input: {
    idempotencyKey: string;
    workItemId: string;
    knowledgeSnapshotId: string;
    skillKey: string;
    versionId: string;
    success: boolean;
    safetyViolation: boolean;
    userRating?: -1 | 0 | 1;
    metrics: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const connection = await this.getConnection();
    return ownerFreeObject(await this.request(connection, "POST", "/api/desktop/v1/holon/feedback", {
      idempotency_key: requiredString(input.idempotencyKey, "HOLON_IDEMPOTENCY_KEY_INVALID", 128),
      work_item_id: requiredString(input.workItemId, "HOLON_WORK_ITEM_ID_INVALID", 80),
      knowledge_snapshot_id: requiredString(input.knowledgeSnapshotId, "HOLON_SNAPSHOT_ID_INVALID", 80),
      skill_key: requiredString(input.skillKey, "HOLON_SKILL_KEY_INVALID", 255),
      version_id: requiredString(input.versionId, "HOLON_VERSION_ID_INVALID", 80),
      success: input.success,
      safety_violation: input.safetyViolation,
      user_rating: input.userRating,
      metrics: input.metrics
    }));
  }

  private async mutateLearning(path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const connection = await this.getConnection();
    return ownerFreeObject(await this.request(connection, "POST", path, body));
  }

  private async request(
    connection: HolonConnection,
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<unknown> {
    if (!path.startsWith("/api/desktop/v1/holon/")
      && !path.startsWith("/api/desktop/v1/knowledge/")
      && !path.startsWith("/api/desktop/v1/experts/preferences")
      && !path.startsWith("/api/desktop/v1/learning/")) {
      throw new Error("HOLON_PATH_FORBIDDEN");
    }
    let activeConnection = connection;
    let response: Response | null = null;
    let refreshedAuthentication = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const origin = new URL(activeConnection.gatewayOrigin).origin;
      try {
        response = await this.fetchImpl(`${origin}${path}`, {
          method,
          ...(path.startsWith("/api/desktop/v1/experts/preferences") ? { signal: AbortSignal.timeout(8000) } : {}),
          headers: {
            Accept: "application/json",
            ...activeConnection.headers,
            ...(body ? { "Content-Type": "application/json" } : {})
          },
          body: body ? JSON.stringify(body) : undefined
        });
      } catch (error) {
        throw new Error("HOLON_HTTP_UNAVAILABLE");
      }
      if (response.status === 401 && this.refreshConnection && !refreshedAuthentication) {
        activeConnection = await this.refreshConnection();
        refreshedAuthentication = true;
        continue;
      }
      if (response.status !== 429 && response.status < 500) break;
    }
    if (!response) throw new Error("HOLON_HTTP_UNAVAILABLE");
    const raw = await response.text();
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      throw new Error("HOLON_HTTP_JSON_INVALID");
    }
    if (!response.ok) {
      const errorPayload = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const detail = String(errorPayload.message || errorPayload.detail || "REQUEST_FAILED").slice(0, 240);
      throw new Error(`HOLON_HTTP_${response.status}:${detail}`);
    }
    return payload;
  }
}

function toSpringEvent(event: HolonRuntimeEvent) {
  return {
    event_id: event.eventId,
    work_item_id: event.workItemId,
    thread_id: event.threadId,
    turn_id: event.turnId,
    sequence_no: event.sequenceNo,
    event_type: event.eventType,
    occurred_at: event.occurredAt,
    payload: event.payload
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("HOLON_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}

function isEmptyObject(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).length === 0);
}

function ownerFreeObject(value: unknown): Record<string, unknown> {
  const result = object(value);
  if ("owner_user_id" in result || "ownerUserId" in result) throw new Error("HOLON_OWNER_FIELD_FORBIDDEN");
  return result;
}

function ownerFreeList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("HOLON_LIST_INVALID");
  return value.map(ownerFreeObject);
}

function boundedList(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("HOLON_LIST_INVALID");
  return value;
}

function requiredString(value: unknown, code: string, maxLength = 240): string {
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(code);
  return normalized;
}

function encodeId(value: unknown, maxLength = 80): string {
  return encodeURIComponent(requiredString(value, "HOLON_ID_INVALID", maxLength));
}

function requiredTimestamp(value: unknown): string {
  const normalized = requiredString(value, "HOLON_TIMESTAMP_INVALID", 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error("HOLON_TIMESTAMP_INVALID");
  return normalized;
}

function nonNegativeInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
}
