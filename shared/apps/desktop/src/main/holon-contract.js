const WORK_ITEM_STATUSES = new Set([
  "QUEUED", "DISPATCHED", "RUNNING", "WAITING_APPROVAL",
  "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"
]);

const EVENT_TYPES = new Set([
  "work_item.started", "tool.completed", "tool.failed", "approval.requested",
  "approval.resolved", "work_item.completed", "work_item.failed", "work_item.cancelled"
]);

function record(value, code = "HOLON_OBJECT_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value;
}

function rejectOwnerField(value) {
  if ("owner_user_id" in value || "ownerUserId" in value) {
    throw new Error("HOLON_OWNER_FIELD_FORBIDDEN");
  }
}

function text(value, field, maxLength) {
  if (typeof value !== "string") throw new Error(`HOLON_${field.toUpperCase()}_INVALID`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`HOLON_${field.toUpperCase()}_INVALID`);
  }
  return normalized;
}

function optionalText(value, field, maxLength) {
  if (value === null || value === undefined || value === "") return undefined;
  return text(value, field, maxLength);
}

function integer(value, field, minimum = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`HOLON_${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function timestamp(value) {
  const normalized = text(value, "timestamp", 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error("HOLON_TIMESTAMP_INVALID");
  return normalized;
}

function booleanValue(value, field) {
  if (typeof value === "boolean") return value;
  if (value === 0) return false;
  if (value === 1) return true;
  throw new Error(`HOLON_${field.toUpperCase()}_INVALID`);
}

export function parseHolonWorkItem(value) {
  const input = record(value, "HOLON_WORK_ITEM_INVALID");
  rejectOwnerField(input);
  const status = text(input.status, "work_status", 32);
  if (!WORK_ITEM_STATUSES.has(status)) throw new Error("HOLON_WORK_STATUS_INVALID");
  return {
    schemaVersion: 1,
    id: text(input.id, "work_item_id", 80),
    source: text(input.source, "source", 32),
    objective: text(input.objective, "objective", 100_000),
    status,
    targetDeviceId: text(input.target_device_id, "target_device_id", 128),
    knowledgeSnapshotId: optionalText(input.knowledge_snapshot_id, "knowledge_snapshot_id", 80),
    executionPolicyVersion: text(input.execution_policy_version, "execution_policy_version", 40),
    learningPolicyVersion: text(input.learning_policy_version, "learning_policy_version", 40),
    versionNo: integer(input.version_no, "version_no"),
    dispatchAttemptCount: integer(input.dispatch_attempt_count, "dispatch_attempt_count"),
    leaseUntil: timestamp(input.lease_until),
    cancelRequested: booleanValue(input.cancel_requested ?? false, "cancel_requested"),
    createdAt: timestamp(input.created_at),
    updatedAt: timestamp(input.updated_at)
  };
}

function parseSnapshotItem(value) {
  const input = record(value, "HOLON_SNAPSHOT_ITEM_INVALID");
  rejectOwnerField(input);
  return {
    skillKey: text(input.skill_key, "skill_key", 255),
    versionId: text(input.version_id, "version_id", 80),
    ordinal: integer(input.ordinal_no ?? input.ordinal, "ordinal"),
    contentJson: text(input.content_json, "content_json", 100_000),
    contentHash: text(input.content_hash, "content_hash", 128)
  };
}

export function parseHolonKnowledgeSnapshot(value) {
  const input = record(value, "HOLON_SNAPSHOT_INVALID");
  rejectOwnerField(input);
  if (input.status !== "READY") throw new Error("HOLON_SNAPSHOT_STATUS_INVALID");
  if (!Array.isArray(input.items) || input.items.length > 1000) {
    throw new Error("HOLON_SNAPSHOT_ITEMS_INVALID");
  }
  const items = input.items.map(parseSnapshotItem);
  const itemCount = integer(input.item_count, "item_count");
  if (items.length !== itemCount) throw new Error("HOLON_SNAPSHOT_ITEM_COUNT_MISMATCH");
  return {
    schemaVersion: 1,
    id: text(input.id, "snapshot_id", 80),
    generation: integer(input.generation, "generation"),
    status: "READY",
    itemCount,
    contentHash: text(input.content_hash, "content_hash", 128),
    createdAt: timestamp(input.created_at),
    items
  };
}

export function parseHolonLearningCandidate(value) {
  const input = record(value, "HOLON_LEARNING_CANDIDATE_INVALID");
  rejectOwnerField(input);
  if (input.status !== "REVIEW_REQUIRED") throw new Error("HOLON_CANDIDATE_STATUS_INVALID");
  const activatedAt = optionalText(input.activated_at, "activated_at", 64);
  return {
    versionId: text(input.id, "version_id", 80),
    skillKey: text(input.skill_key, "skill_key", 255),
    parentVersionId: optionalText(input.parent_version_id, "parent_version_id", 80),
    status: "REVIEW_REQUIRED",
    contentJson: text(input.content_json, "content_json", 100_000),
    contentHash: text(input.content_hash, "content_hash", 128),
    sourceWorkItemId: optionalText(input.source_work_item_id, "source_work_item_id", 80),
    evaluationRunId: optionalText(input.evaluation_run_id, "evaluation_run_id", 80),
    indexStatus: text(input.index_status, "index_status", 32),
    createdAt: timestamp(input.created_at),
    ...(activatedAt ? { activatedAt: timestamp(activatedAt) } : {})
  };
}

export function parseHolonKnowledgeSearchResult(value) {
  const input = record(value, "HOLON_KNOWLEDGE_RESULT_INVALID");
  rejectOwnerField(input);
  if (typeof input.score !== "number" || !Number.isFinite(input.score) || input.score < 0) {
    throw new Error("HOLON_KNOWLEDGE_SCORE_INVALID");
  }
  const source = optionalText(input.source, "source", 40);
  return {
    skillKey: text(input.skill_key, "skill_key", 255),
    versionId: text(input.version_id, "version_id", 80),
    content: text(input.content ?? input.content_json, "content", 100_000),
    contentHash: text(input.content_hash, "content_hash", 128),
    createdAt: timestamp(input.created_at),
    score: input.score,
    ...(source ? { source } : {})
  };
}

export function validateHolonRuntimeEvents(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error("HOLON_EVENT_BATCH_SIZE");
  }
  return value.map((raw) => {
    const input = record(raw, "HOLON_EVENT_INVALID");
    const eventType = text(input.eventType, "event_type", 64);
    if (!EVENT_TYPES.has(eventType)) throw new Error("HOLON_EVENT_TYPE_INVALID");
    if (input.schemaVersion !== 1) throw new Error("HOLON_SCHEMA_UNSUPPORTED");
    const payload = record(input.payload, "HOLON_EVENT_PAYLOAD_INVALID");
    const sequenceNo = integer(input.sequenceNo, "event_sequence");
    return {
      schemaVersion: 1,
      eventId: text(input.eventId, "event_id", 80),
      workItemId: text(input.workItemId, "work_item_id", 80),
      threadId: optionalText(input.threadId, "thread_id", 80),
      turnId: optionalText(input.turnId, "turn_id", 80),
      sequenceNo,
      eventType,
      occurredAt: timestamp(input.occurredAt),
      payload
    };
  });
}
