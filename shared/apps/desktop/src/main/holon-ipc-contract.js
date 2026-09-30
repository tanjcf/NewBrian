const ID_LIMIT = 80;
const METRIC_KEYS = new Set(["durationMs", "toolCallCount", "retryCount", "approvalCount", "cancelled"]);

function exactRecord(value, label, fields, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const allowed = new Set([...fields, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains an unknown field: ${key}.`);
  }
  return value;
}

function id(value, label, maxLength = ID_LIMIT) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value.trim();
}

function integer(value, label, minimum, maximum, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} is invalid.`);
  return value;
}

export function parseHolonWorkItemIdInput(value) {
  const input = exactRecord(value, "Holon work item input", ["workItemId"]);
  return { workItemId: id(input.workItemId, "Work item ID") };
}

export function parseHolonKnowledgeSnapshotInput(value) {
  const input = exactRecord(value, "Holon knowledge snapshot input", ["snapshotId"]);
  return { snapshotId: id(input.snapshotId, "Knowledge snapshot ID") };
}

export function parseStartHolonWorkItemInput(value) {
  const input = exactRecord(value, "Start Holon work item input", ["workItemId", "threadId", "turnId"]);
  return {
    workItemId: id(input.workItemId, "Work item ID"),
    threadId: id(input.threadId, "Thread ID", 128),
    turnId: id(input.turnId, "Turn ID", 128)
  };
}

export function parseLearningListInput(value) {
  if (value === undefined) return { limit: 50 };
  const input = exactRecord(value, "Learning list input", [], ["limit"]);
  return { limit: integer(input.limit, "Limit", 1, 100, 50) };
}

export function parseLearningSearchInput(value) {
  const input = exactRecord(value, "Knowledge search input", ["query"], ["limit"]);
  if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 2_000) {
    throw new TypeError("Knowledge query is invalid.");
  }
  return { query: input.query.trim(), limit: integer(input.limit, "Limit", 1, 50, 20) };
}

export function parseLearningCandidateInput(value) {
  const input = exactRecord(value, "Learning candidate input", ["versionId"]);
  return { versionId: id(input.versionId, "Version ID") };
}

export function parseLearningRollbackInput(value) {
  const input = exactRecord(value, "Learning rollback input", ["skillKey", "targetVersionId"]);
  return {
    skillKey: id(input.skillKey, "Skill key", 255),
    targetVersionId: id(input.targetVersionId, "Target version ID")
  };
}

export function parseHolonFeedbackInput(value) {
  const input = exactRecord(value, "Holon feedback input", [
    "idempotencyKey", "workItemId", "knowledgeSnapshotId", "skillKey", "versionId",
    "success", "safetyViolation", "metrics"
  ], ["userRating"]);
  if (typeof input.success !== "boolean" || typeof input.safetyViolation !== "boolean") {
    throw new TypeError("Feedback flags are invalid.");
  }
  if (input.userRating !== undefined && ![-1, 0, 1].includes(input.userRating)) {
    throw new TypeError("User rating is invalid.");
  }
  const metrics = exactRecord(input.metrics, "Feedback metrics", [] , [...METRIC_KEYS]);
  for (const [key, metric] of Object.entries(metrics)) {
    if ((key === "cancelled" && typeof metric !== "boolean")
      || (key !== "cancelled" && (typeof metric !== "number" || !Number.isFinite(metric) || metric < 0))) {
      throw new TypeError(`Feedback metric ${key} is invalid.`);
    }
  }
  return {
    idempotencyKey: id(input.idempotencyKey, "Idempotency key", 128),
    workItemId: id(input.workItemId, "Work item ID"),
    knowledgeSnapshotId: id(input.knowledgeSnapshotId, "Knowledge snapshot ID"),
    skillKey: id(input.skillKey, "Skill key", 255),
    versionId: id(input.versionId, "Version ID"),
    success: input.success,
    safetyViolation: input.safetyViolation,
    ...(input.userRating === undefined ? {} : { userRating: input.userRating }),
    metrics: { ...metrics }
  };
}
