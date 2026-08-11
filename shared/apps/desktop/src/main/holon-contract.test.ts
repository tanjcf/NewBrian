import assert from "node:assert/strict";
import test from "node:test";

const contract = import(new URL("./holon-contract.js", import.meta.url).href) as Promise<
  typeof import("./holon-contract.js")
>;

const workItem = {
  id: "wi_1",
  source: "desktop",
  objective: "Run the Maven test suite",
  status: "DISPATCHED",
  target_device_id: "device_1",
  knowledge_snapshot_id: "ks_1",
  execution_policy_version: "execution-v1",
  learning_policy_version: "learning-v1",
  version_no: 1,
  dispatch_attempt_count: 1,
  lease_until: "2026-07-22T00:02:00.000Z",
  cancel_requested: false,
  created_at: "2026-07-22T00:00:00.000Z",
  updated_at: "2026-07-22T00:00:00.000Z"
};

test("parses a Spring WorkItem into a bounded owner-free contract", async () => {
  const { parseHolonWorkItem } = await contract;
  const parsed = parseHolonWorkItem(workItem);

  assert.equal(parsed.id, "wi_1");
  assert.equal(parsed.status, "DISPATCHED");
  assert.equal(parsed.knowledgeSnapshotId, "ks_1");
  assert.equal("ownerUserId" in parsed, false);
  assert.equal("owner_user_id" in parsed, false);
});

test("rejects a WorkItem response that exposes an owner identifier", async () => {
  const { parseHolonWorkItem } = await contract;
  assert.throws(
    () => parseHolonWorkItem({ ...workItem, owner_user_id: 7 }),
    /HOLON_OWNER_FIELD_FORBIDDEN/
  );
});

test("rejects unknown WorkItem states and invalid lease timestamps", async () => {
  const { parseHolonWorkItem } = await contract;
  assert.throws(
    () => parseHolonWorkItem({ ...workItem, status: "MAGIC" }),
    /HOLON_WORK_STATUS_INVALID/
  );
  assert.throws(
    () => parseHolonWorkItem({ ...workItem, lease_until: "tomorrow" }),
    /HOLON_TIMESTAMP_INVALID/
  );
});

test("validates ordered runtime events and the Spring batch limit", async () => {
  const { validateHolonRuntimeEvents } = await contract;
  const event = {
    schemaVersion: 1 as const,
    eventId: "evt_1",
    workItemId: "wi_1",
    threadId: "thread_1",
    turnId: "turn_1",
    sequenceNo: 0,
    eventType: "work_item.started" as const,
    occurredAt: "2026-07-22T00:00:00.000Z",
    payload: {}
  };

  assert.equal(validateHolonRuntimeEvents([event])[0]?.eventId, "evt_1");
  assert.throws(
    () => validateHolonRuntimeEvents([{ ...event, sequenceNo: -1 }]),
    /HOLON_EVENT_SEQUENCE_INVALID/
  );
  assert.throws(
    () => validateHolonRuntimeEvents(Array.from({ length: 101 }, (_, index) => ({
      ...event,
      eventId: `evt_${index}`,
      sequenceNo: index
    }))),
    /HOLON_EVENT_BATCH_SIZE/
  );
});

test("parses a private snapshot without accepting owner fields", async () => {
  const { parseHolonKnowledgeSnapshot } = await contract;
  const parsed = parseHolonKnowledgeSnapshot({
    id: "ks_1",
    generation: 2,
    status: "READY",
    item_count: 1,
    content_hash: "abc123",
    created_at: "2026-07-22T00:00:00.000Z",
    items: [{
      skill_key: "qa.maven.windows",
      version_id: "hsv_1",
      ordinal: 0,
      content_json: "{\"action\":\"run tests\"}",
      content_hash: "def456"
    }]
  });

  assert.equal(parsed.items[0]?.skillKey, "qa.maven.windows");
  assert.throws(
    () => parseHolonKnowledgeSnapshot({
      id: "ks_1",
      owner_user_id: 7,
      generation: 2,
      status: "READY",
      item_count: 0,
      content_hash: "abc123",
      created_at: "2026-07-22T00:00:00.000Z",
      items: []
    }),
    /HOLON_OWNER_FIELD_FORBIDDEN/
  );
});

test("strictly parses learning candidates and private knowledge search results", async () => {
  const { parseHolonLearningCandidate, parseHolonKnowledgeSearchResult } = await contract;
  assert.deepEqual(parseHolonLearningCandidate({
    id: "hsv_1", skill_key: "qa.skill", parent_version_id: "hsv_0", status: "REVIEW_REQUIRED",
    content_json: "{\"rule\":\"run tests\"}", content_hash: "abc", source_work_item_id: "wi_1",
    evaluation_run_id: "eval_1", index_status: "PENDING", created_at: "2026-07-22T00:00:00Z",
    activated_at: null
  }), {
    versionId: "hsv_1", skillKey: "qa.skill", parentVersionId: "hsv_0", status: "REVIEW_REQUIRED",
    contentJson: "{\"rule\":\"run tests\"}", contentHash: "abc", sourceWorkItemId: "wi_1",
    evaluationRunId: "eval_1", indexStatus: "PENDING", createdAt: "2026-07-22T00:00:00Z"
  });
  assert.deepEqual(parseHolonKnowledgeSearchResult({
    skill_key: "qa.skill", version_id: "hsv_1", content: "run tests", content_hash: "abc",
    created_at: "2026-07-22T00:00:00Z", score: 0.75
  }), {
    skillKey: "qa.skill", versionId: "hsv_1", content: "run tests", contentHash: "abc",
    createdAt: "2026-07-22T00:00:00Z", score: 0.75
  });
  assert.throws(() => parseHolonLearningCandidate({ id: "hsv_1", owner_user_id: 7 }),
    /HOLON_OWNER_FIELD_FORBIDDEN/);
});
