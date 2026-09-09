# NewBrain Holon/Hermes Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect NewBrain to Spring Holon/Hermes with durable remote execution, private knowledge review, feedback, rollback, and restart-safe event synchronization.

**Architecture:** Shared protocol contracts cross renderer/preload/main boundaries. Electron Main owns authenticated Spring calls and a SQLite WorkItem/outbox projection; the existing Agent Runtime remains the only tool/approval executor and emits sanitized events into that outbox. Renderer state is a non-authoritative projection reloaded from Spring.

**Tech Stack:** Electron 35, React 19, TypeScript 5.8, Node SQLite `DatabaseSync`, Node test runner, pnpm monorepo, Spring HTTP JSON APIs.

---

### Task 1: Shared Holon contracts

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Create: `apps/desktop/src/main/holon-contract.test.ts`
- Create: `apps/desktop/src/main/holon-contract.ts`

- [ ] **Step 1: Write a failing parser test**

Create tests that parse a valid Spring `item`, reject an `owner_user_id`, reject unknown status values, reject more than 100 events, and reject a negative sequence number.

```ts
test("parses an owned work item without accepting an owner field", () => {
  const item = parseHolonWorkItem({
    id: "wi_1", source: "desktop", objective: "Run tests", status: "DISPATCHED",
    target_device_id: "device_1", knowledge_snapshot_id: "ks_1",
    execution_policy_version: "execution-v1", learning_policy_version: "learning-v1",
    version_no: 1, dispatch_attempt_count: 1,
    lease_until: "2026-07-22T00:02:00Z", created_at: "2026-07-22T00:00:00Z",
    updated_at: "2026-07-22T00:00:00Z"
  });
  assert.equal(item.id, "wi_1");
  assert.equal("owner_user_id" in item, false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/holon-contract.test.ts
```

Expected: FAIL because `holon-contract.ts` does not exist.

- [ ] **Step 3: Add protocol types and strict parsers**

Add schema-versioned WorkItem, snapshot, event, candidate, search, feedback, and sync types to the protocol public entry point. Implement `parseHolonWorkItem`, `parseKnowledgeSnapshot`, `parseLearningCandidate`, and event-batch validation in `holon-contract.ts` using `unknown` inputs and explicit narrowing.

- [ ] **Step 4: Run the parser and protocol checks**

```powershell
pnpm --filter @codex-forge/protocol check
pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/holon-contract.test.ts
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the contract increment**

```powershell
git add packages/protocol/src/index.ts apps/desktop/src/main/holon-contract.ts apps/desktop/src/main/holon-contract.test.ts
git commit -m "feat(holon): add desktop protocol contracts"
```

### Task 2: Durable WorkItem and event outbox storage

**Files:**
- Modify: `apps/desktop/src/main/codex-storage.ts`
- Modify: `apps/desktop/src/main/codex-storage.test.ts`
- Create: `apps/desktop/src/main/holon-outbox-service.ts`
- Create: `apps/desktop/src/main/holon-outbox-service.test.ts`

- [ ] **Step 1: Write failing storage tests**

Test migration creation, claim idempotency, monotonically increasing sequence allocation, duplicate event rejection, concurrent append, `sending` recovery, `running` to `interrupted` recovery, acknowledged rows remaining durable, and no terminal WorkItem replay.

```ts
test("recovers an interrupted remote item without replaying acknowledged events", () => {
  const storage = new CodexStorage(tempRoot);
  storage.upsertRemoteWorkItem(workItem, "running");
  storage.appendRemoteEvent(event);
  storage.acknowledgeRemoteEvents([event.eventId], 1000);
  storage.recoverRemoteExecutionState(2000);
  assert.equal(storage.getRemoteWorkItem("wi_1")?.status, "interrupted");
  assert.equal(storage.listPendingRemoteEvents(10, 2000).length, 0);
});
```

- [ ] **Step 2: Run and verify RED**

```powershell
pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/codex-storage.test.ts src/main/holon-outbox-service.test.ts
```

Expected: FAIL because remote storage methods are absent.

- [ ] **Step 3: Add migration and storage methods**

Add `remote_work_items` and `remote_event_outbox` migration 8 to `state_5.sqlite`. Add transactional methods for claim persistence, state CAS, next sequence, outbox append, due batch claim, acknowledgment, retry, quarantine, startup recovery, and sync counts.

- [ ] **Step 4: Implement the outbox service**

`HolonOutboxService` must serialize sends, cap batches at 100, mark only accepted/duplicate events acknowledged, use bounded exponential retry, and leave conflicts quarantined with a stable error.

- [ ] **Step 5: Run storage tests and commit**

```powershell
pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/codex-storage.test.ts src/main/holon-outbox-service.test.ts
git add apps/desktop/src/main/codex-storage.ts apps/desktop/src/main/codex-storage.test.ts apps/desktop/src/main/holon-outbox-service.ts apps/desktop/src/main/holon-outbox-service.test.ts
git commit -m "feat(holon): persist remote work and event outbox"
```

Expected: tests PASS and only the four scoped files are staged.

### Task 3: Authenticated Spring Holon client

**Files:**
- Create: `apps/desktop/src/main/holon-control-plane-service.ts`
- Create: `apps/desktop/src/main/holon-control-plane-service.test.ts`
- Modify: `apps/desktop/src/main/desktop-control-plane.ts`

- [ ] **Step 1: Write failing HTTP contract tests**

Use a contract-faithful local HTTP server to verify stable device headers, token secrecy, empty task parsing, WorkItem parsing, snapshot parsing, event POST body, 401 refresh once, ownership-safe 404, 409 conflict, 429/5xx retry, timeout cancellation, and no arbitrary URL input.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/holon-control-plane-service.test.ts
```

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement the narrow client**

Create methods `claimNextWorkItem`, `heartbeat`, `getControl`, `requestCancel`, `sendEvents`, `getSnapshot`, `listCandidates`, `searchKnowledge`, `approveCandidate`, `rejectCandidate`, `rollbackSkill`, and `submitFeedback`. Reuse the existing header builder and authenticated-state callback; do not expose tokens or origins in returned state.

- [ ] **Step 4: Run tests and commit**

```powershell
pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/holon-control-plane-service.test.ts src/main/desktop-control-plane.test.ts
git add apps/desktop/src/main/holon-control-plane-service.ts apps/desktop/src/main/holon-control-plane-service.test.ts apps/desktop/src/main/desktop-control-plane.ts
git commit -m "feat(holon): add authenticated Spring client"
```

### Task 4: Runtime event projection and privacy sanitizer

**Files:**
- Create: `apps/desktop/src/main/remote-event-sanitizer.ts`
- Create: `apps/desktop/src/main/remote-event-sanitizer.test.ts`
- Create: `apps/desktop/src/main/holon-runtime-projector.ts`
- Create: `apps/desktop/src/main/holon-runtime-projector.test.ts`
- Modify: `apps/desktop/src/main/model-chat-agent-loop-service.ts`

- [ ] **Step 1: Write failing sanitizer and projection tests**

Tests must prove that secrets, absolute paths, environment values, full output, file content, email addresses, and reasoning are absent; hashes, durations, exit codes, tool names, and bounded summaries remain. Project agent start, tool result, approval wait/resolution, completion, failure, and cancellation in order with stable IDs.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/remote-event-sanitizer.test.ts src/main/holon-runtime-projector.test.ts
```

- [ ] **Step 3: Implement sanitizer and projector**

The projector receives a persisted local Agent event only after rollout append, assigns the next WorkItem sequence transactionally, creates a schema-version-1 event, and appends it to the outbox. It never performs HTTP in an Agent callback.

- [ ] **Step 4: Bind remote context to the Agent loop**

Extend the model-chat execution context with optional `remoteWorkItemId` and `knowledgeSnapshotId`. Intersect task allowed tools with registered tools before loop start and retain existing NewBrain policy/approval checks.

- [ ] **Step 5: Run failure-path tests and commit**

```powershell
pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/remote-event-sanitizer.test.ts src/main/holon-runtime-projector.test.ts src/main/model-chat-agent-loop-service.test.ts
git add apps/desktop/src/main/remote-event-sanitizer.ts apps/desktop/src/main/remote-event-sanitizer.test.ts apps/desktop/src/main/holon-runtime-projector.ts apps/desktop/src/main/holon-runtime-projector.test.ts apps/desktop/src/main/model-chat-agent-loop-service.ts
git commit -m "feat(holon): project agent events into durable evidence"
```

### Task 5: WorkItem orchestration, heartbeat, cancellation, and recovery

**Files:**
- Create: `apps/desktop/src/main/holon-work-item-service.ts`
- Create: `apps/desktop/src/main/holon-work-item-service.test.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Write failing orchestration tests**

Test explicit start, wrong-device rejection, expired lease, heartbeat before half lease, control cancellation, approval wait, terminal persistence before terminal event, crash recovery to interrupted, user resume decision, and no duplicate execution for the same WorkItem.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/holon-work-item-service.test.ts
```

- [ ] **Step 3: Implement the service**

The service claims and persists tasks, loads snapshots, creates or binds a local thread, starts only after user action, schedules heartbeat/control polling, invokes the existing runtime through its adapter, persists terminal state, appends terminal evidence, and stops timers on completion/cancel/window shutdown.

- [ ] **Step 4: Register lifecycle wiring and verify**

```powershell
pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/holon-work-item-service.test.ts src/main/model-chat-agent-loop-service.test.ts
git add apps/desktop/src/main/holon-work-item-service.ts apps/desktop/src/main/holon-work-item-service.test.ts apps/desktop/src/main/index.ts
git commit -m "feat(holon): orchestrate remote work items"
```

### Task 6: Narrow IPC and preload surface

**Files:**
- Create: `apps/desktop/src/main/holon-ipc.ts`
- Create: `apps/desktop/src/main/holon-ipc.test.ts`
- Create: `apps/desktop/src/main/learning-ipc.ts`
- Create: `apps/desktop/src/main/learning-ipc.test.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Write failing IPC validation tests**

Reject unknown fields, empty/oversize identifiers, invalid feedback ratings, owner IDs, arbitrary URLs, batches over limits, and unavailable handlers. Verify logout clears renderer projections without deleting unsent outbox evidence.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/holon-ipc.test.ts src/main/learning-ipc.test.ts
```

- [ ] **Step 3: Implement handlers and typed preload methods**

Expose only `getNextWorkItem`, `startWorkItem`, `cancelWorkItem`, `getWorkItemState`, `getKnowledgeSnapshot`, `getHolonSyncStatus`, `listLearningCandidates`, `searchPrivateKnowledge`, `approveLearningCandidate`, `rejectLearningCandidate`, `rollbackPrivateSkill`, and `submitHolonFeedback`.

- [ ] **Step 4: Run checks and commit**

```powershell
pnpm --filter @codex-forge/protocol check
pnpm --filter @codex-forge/desktop check
pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/holon-ipc.test.ts src/main/learning-ipc.test.ts
git add packages/protocol/src/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/holon-ipc.ts apps/desktop/src/main/holon-ipc.test.ts apps/desktop/src/main/learning-ipc.ts apps/desktop/src/main/learning-ipc.test.ts
git commit -m "feat(holon): expose typed desktop capabilities"
```

### Task 7: Holon renderer workflow

**Files:**
- Create: `apps/desktop/src/renderer/app/HolonWorkspace.tsx`
- Create: `apps/desktop/src/renderer/app/holon-workspace.test.mjs`
- Modify: `apps/desktop/src/renderer/app/FeaturePanel.tsx`
- Modify: `apps/desktop/src/renderer/app/desktop-model.tsx`
- Modify: `apps/desktop/src/renderer/ui.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`

- [ ] **Step 1: Write failing renderer contract tests**

Verify five tabs, explicit Start, immutable snapshot display, candidate diff, approval/rejection confirmation, private search, rollback confirmation, feedback idempotency state, empty/loading/error states, and absence of owner ID/token/origin fields.

- [ ] **Step 2: Verify RED**

```powershell
pnpm --filter @codex-forge/desktop exec node --test src/renderer/app/holon-workspace.test.mjs
```

- [ ] **Step 3: Implement focused renderer state and UI**

Use existing controls and visual tokens. Keep durable state in Electron Main/Spring; refresh from IPC after each mutation. Do not nest cards or put operational context inside the composer menu.

- [ ] **Step 4: Run renderer tests and commit**

```powershell
pnpm --filter @codex-forge/desktop exec node --test src/renderer/app/holon-workspace.test.mjs src/renderer/app/composer-layout.test.mjs
pnpm --filter @codex-forge/desktop check
git add apps/desktop/src/renderer/app/HolonWorkspace.tsx apps/desktop/src/renderer/app/holon-workspace.test.mjs apps/desktop/src/renderer/app/FeaturePanel.tsx apps/desktop/src/renderer/app/desktop-model.tsx apps/desktop/src/renderer/ui.tsx apps/desktop/src/renderer/styles.css
git commit -m "feat(holon): add private learning workspace"
```

### Task 8: Closed-loop Electron and real Spring verification

**Files:**
- Create: `apps/desktop/scripts/test-electron-holon-flow.mjs`
- Create: `apps/desktop/scripts/holon-contract-model-server.mjs`
- Modify: `apps/desktop/package.json`
- Create: `docs/testing/holon-newbrain-closed-loop.md`

- [ ] **Step 1: Add deterministic Electron E2E**

Use a contract-faithful Spring double only for deterministic streams and failures. Through visible UI, assert claim, explicit start, running events, approval pause, cancellation, outbox retry, restart recovery, candidate review, search, feedback, and no duplicate side effect.

- [ ] **Step 2: Run deterministic Electron E2E**

```powershell
pnpm --filter @codex-forge/desktop test:holon-runtime
```

Expected: PASS with evidence under `integration-artifacts/holon-newbrain/`.

- [ ] **Step 3: Run the real Spring double-user closure**

Use JUnit fixture `holon_e2e_<timestamp>` to create users A/B and subscriptions. Log in through normal NewBrain UI, verify B sees no A task/candidate/knowledge, execute A episodes, approve V1 and V2 through UI, bind V2 snapshot, submit safety feedback, verify V1 restored and V2 absent, then restart NewBrain and confirm no repeated side effects.

- [ ] **Step 4: Run release gates excluding MSI**

```powershell
pnpm check
pnpm --filter @codex-forge/agentd test
pnpm --filter @codex-forge/desktop test:storage
pnpm --filter @codex-forge/desktop test:security
pnpm --filter @codex-forge/desktop test:holon-runtime
pnpm --filter @codex-forge/desktop build
git diff --check
```

Expected: all commands PASS; MSI is not generated.

- [ ] **Step 5: Clean fixture and preserve evidence**

Run the Spring JUnit cleanup action for the same RunId. Verify users, subscriptions, WorkItems, events, snapshots, candidates, feedback, sessions, and API keys have zero residue. Record PASS/FAIL/PARTIAL accurately in `docs/testing/holon-newbrain-closed-loop.md`.

- [ ] **Step 6: Commit test campaign**

```powershell
git add apps/desktop/scripts/test-electron-holon-flow.mjs apps/desktop/scripts/holon-contract-model-server.mjs apps/desktop/package.json docs/testing/holon-newbrain-closed-loop.md
git commit -m "test(holon): verify desktop learning closure"
```

