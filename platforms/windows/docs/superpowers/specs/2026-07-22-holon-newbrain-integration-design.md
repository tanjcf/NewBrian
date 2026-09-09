# NewBrain Holon/Hermes Integration Design

## Objective

Connect the existing NewBrain Electron desktop runtime to the completed Spring Holon/Hermes control plane so one authenticated desktop user can safely execute owned remote work, upload durable learning evidence, review private learned skills, consume immutable knowledge snapshots, and submit feedback without cross-user sharing.

## Current State

Spring already provides and has exercised these authenticated endpoints:

- `GET /api/desktop/v1/holon/work-items/next`
- `POST /api/desktop/v1/holon/work-items/{id}/heartbeat`
- `GET /api/desktop/v1/holon/work-items/{id}/control`
- `POST /api/desktop/v1/holon/work-items/{id}/cancel`
- `POST /api/desktop/v1/holon/events:batch`
- `GET /api/desktop/v1/knowledge/snapshots/{id}`
- `GET /api/desktop/v1/learning/candidates`
- `GET /api/desktop/v1/learning/knowledge/search`
- `POST /api/desktop/v1/learning/candidates/{id}/approve`
- `POST /api/desktop/v1/learning/candidates/{id}/reject`
- `POST /api/desktop/v1/learning/skills/{skillKey}/rollback`
- `POST /api/desktop/v1/holon/feedback`

NewBrain currently synchronizes only bootstrap, model configuration, and capabilities. Its source tree has no Holon protocol, persistence, runtime projection, IPC, or renderer implementation.

## Chosen Approach

Use a durable local execution bridge with explicit user start:

1. Electron Main claims a WorkItem for the stable authenticated device.
2. It persists the claim before showing it to the renderer.
3. The user reviews the source, objective, snapshot, limits, and effective tool set, then clicks Start.
4. The existing local Agent Runtime executes with existing approval and workspace safety rules.
5. Runtime events are sanitized and appended to a local SQLite outbox after local rollout persistence.
6. A background sender uploads ordered batches and acknowledges only accepted or duplicate events.
7. Restart never repeats a confirmed side effect. A previously running remote item becomes interrupted and requires user action.

Direct HTTP calls from Agent callbacks are rejected because a crash or disconnect would lose evidence or duplicate side effects. Spring-driven step-by-step execution is rejected because local policy, approval, tool execution, and offline durability belong to NewBrain.

## Ownership Boundaries

### Renderer

The renderer displays remote task, snapshot, candidate, search, and feedback state. It never receives an access token, gateway URL, owner user ID, raw HTTP response, or unrestricted IPC channel.

### Preload

Preload exposes only typed Holon capabilities from the shared protocol package. Methods accept bounded identifiers and user actions; authentication and device identity remain in Electron Main.

### Electron Main

Electron Main owns Spring HTTP calls, response validation, local WorkItem and outbox persistence, heartbeats, cancellation checks, retry scheduling, event sanitization, IPC validation, and renderer notifications.

### Agent Runtime

The Agent Runtime retains its current model loop, tool registry, policy decisions, approval pause/resume, cancellation, rollout, and side-effect semantics. A remote execution context adds only `workItemId`, `knowledgeSnapshotId`, allowed-tool intersection, and event projection metadata.

### Spring

Spring remains authoritative for user ownership, WorkItem state, learning jobs, candidate versions, active pointers, snapshots, Elasticsearch projection, feedback aggregation, and rollback. NewBrain never persists central learning state as authoritative.

## Shared Protocol

Add schema-versioned data-only contracts:

- `HolonWorkItem`
- `HolonKnowledgeSnapshot`
- `HolonKnowledgeSnapshotItem`
- `HolonRuntimeEvent`
- `HolonEventBatchResult`
- `HolonLearningCandidate`
- `HolonKnowledgeSearchItem`
- `HolonRuntimeFeedbackInput`
- `HolonSyncStatus`

Runtime event types are a discriminated union:

- `work_item.started`
- `tool.completed`
- `approval.requested`
- `approval.resolved`
- `work_item.completed`
- `work_item.failed`
- `work_item.cancelled`

Every event contains schema version 1, stable event ID, WorkItem ID, thread ID, turn ID, monotonically increasing sequence number, ISO timestamp, and a bounded structured payload.

## Local Persistence

Add migrations to `state_5.sqlite`:

```sql
CREATE TABLE remote_work_items (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  objective TEXT NOT NULL,
  source TEXT NOT NULL,
  target_device_id TEXT NOT NULL,
  knowledge_snapshot_id TEXT,
  payload_json TEXT NOT NULL,
  thread_id TEXT,
  claimed_at_ms INTEGER NOT NULL,
  lease_until_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  last_error TEXT NOT NULL DEFAULT ''
);

CREATE TABLE remote_event_outbox (
  event_id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  acknowledged_at_ms INTEGER,
  UNIQUE(work_item_id, sequence_no)
);
```

Outbox statuses are `pending`, `sending`, and `acknowledged`. Startup changes stale `sending` rows back to `pending`. It changes locally `running` WorkItems to `interrupted`; it does not replay the Agent loop automatically.

## HTTP and Authentication

The Holon client reuses the stable desktop fingerprint and the same authenticated-header builder used by the control plane. It accepts only paths under `/api/desktop/v1/holon`, `/api/desktop/v1/knowledge`, and `/api/desktop/v1/learning`. It parses the Spring dynamic envelope into strict internal contracts and returns stable NewBrain error codes.

401 triggers the existing desktop refresh flow once. 403/404 remain ownership-safe errors. 409 is a state conflict and must refresh local state. 429 and retryable 5xx use bounded exponential backoff. Cancellation and timeouts always release network resources.

## Event Privacy

Remote payloads must not contain:

- full command output;
- source or generated file contents;
- absolute paths;
- environment variables;
- access tokens, API keys, cookies, email addresses, or other PII;
- private reasoning text.

For tools, upload the tool name, success flag, duration, exit code, bounded semantic summary, output byte count, and SHA-256 hash. File paths are represented only by workspace-relative normalized labels when required for learning.

## Execution and Recovery

- A claimed WorkItem is displayed before execution. User confirmation is mandatory.
- Effective tools equal the intersection of Spring task policy, locally registered tools, and NewBrain permission policy.
- A heartbeat runs before half the two-minute lease expires.
- Control polling observes cancellation and lease state while the Agent loop runs.
- Approval waiting is a first-class event and does not count as task completion.
- A terminal local result is persisted before its terminal remote event is queued.
- A duplicate Spring acknowledgment is success; it never causes a replay.
- An outbox conflict quarantines the row and surfaces a repairable sync error.

## Renderer Experience

Add a quiet work-focused `Holon` feature with tabs:

1. `Remote Tasks`: claimed task, lease, objective, source, snapshot, effective tools, Start/Cancel/Resume decision.
2. `Knowledge Snapshot`: immutable generation and active skill versions used by a task.
3. `Learning Review`: candidate list, source WorkItem, parent version, evaluation, structured diff, Approve/Reject.
4. `My Knowledge`: private search results and version lineage, with rollback confirmation.
5. `Feedback`: task outcome, rating, safety violation, version attribution, and automatic rollback result.

No user can enter another owner ID. All lists are reloaded from Spring after mutation.

## Verification

Automated evidence must cover:

- strict parsing and IPC validation;
- SQLite migration, concurrency, restart, and duplicate outbox delivery;
- event sanitization and ordering;
- approval pause/resume and cancellation;
- cross-user and wrong-device denial using the real Spring test users;
- V1 creation, approval, V2 inheritance, snapshot binding, negative feedback, and V2-to-V1 rollback;
- renderer state and interaction in real Electron;
- production build.

MSI packaging remains outside this implementation gate until the user explicitly approves the development build.

