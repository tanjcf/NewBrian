# Holon NewBrain Closed-Loop Verification

Date: 2026-07-22

## Deterministic desktop closure

Status: PASS

- Production Electron bundles build successfully.
- Visible UI opens the Holon workspace and claims a WorkItem.
- WorkItem execution remains blocked until the user opens and confirms the execution prompt.
- The existing ModelChat/Agent Runtime path executes the objective with local approval policy enabled.
- WorkItem terminal state is persisted locally.
- The durable Outbox retries a simulated HTTP 500, then sends terminal and approval events to a contract-faithful Spring double.
- Uploaded events contain no owner identifier, command output, or model response body.
- Immutable snapshot loading, learning candidate listing, and private knowledge search work through preload IPC.
- Candidate approval, rejection, rollback and feedback require visible user actions; duplicate feedback submission is suppressed.
- A second claimed WorkItem can be explicitly discarded and produces one remote cancellation plus a durable cancelled event.
- A third WorkItem reaches the existing shell approval UI, executes only after approval, and uploads requested/resolved/tool/completion evidence.
- Killing Electron during execution recovers the task as `interrupted`; restart does not execute it again, and explicit discard is still required.

Evidence:

- `integration-artifacts/holon-newbrain/deterministic-electron.json`
- `integration-artifacts/holon-newbrain/restart-recovery.json`

Command:

```powershell
pnpm --filter @codex-forge/desktop test:holon-runtime
```

Latest deterministic results:

```json
{"ok":true,"eventCount":8,"eventAttempts":6,"snapshot":true,"candidate":true,"search":true,"governance":true,"feedback":true,"cancellation":true,"approval":true}
{"ok":true,"interrupted":true,"explicitDiscard":true,"duplicateExecutions":0}
```

Quality gates:

- Architecture and workspace TypeScript checks: PASS.
- Agent Runtime tests: 95/95 PASS.
- Desktop storage tests: 101/101 PASS.
- Desktop security tests: 145/145 PASS.
- Holon/model focused tests: 63/63 PASS.
- Production Electron build: PASS.

## Isolated two-user Spring mock closure

Status: PASS

The user authorized an isolated stateful mock because a disposable Spring database was unavailable. The mock uses two bearer identities and in-memory fixture data only; it never connects to MySQL, Redis, Elasticsearch, or the remote Spring deployment.

Visible Electron verification covers:

- user A executes episode 1, reviews and approves private V1;
- episode 2 is bound to the immutable V1 snapshot and produces V2 with V1 lineage;
- user A approves V2, submits a safety-violation feedback, and the active pointer rolls back to V1;
- user B sees no A WorkItems, candidates, or private knowledge;
- a direct B request for A's snapshot is rejected by ownership enforcement;
- fixture cleanup reports zero residual tasks, events, candidates, versions, snapshots, and feedback.

Command and evidence:

```powershell
pnpm --filter @codex-forge/desktop test:holon-two-user
```

- `integration-artifacts/holon-newbrain/two-user-mock-electron.json`

## Real Spring two-user closure

Status: BLOCKED

- No Spring service is listening on local port 8790 as of the latest verification.
- The configured database points to `203.0.113.10:3307`, but no isolated QA database password is present in the process environment.
- Spring main and test sources compile successfully with the IntelliJ-configured JDK 26 (target release 21).
- The fixture is intentionally opt-in and requires `HOLON_QA_RUN_ID`, two temporary passwords, and isolated QA database credentials; those credentials are not present in the current process environment.
- No fixture data was written to the remote database.

Required before running the existing `HolonE2eFixtureIntegrationTest` seed/append/cleanup campaign:

1. Supply isolated QA database credentials.
2. Start Spring on port 8790 and run the fixture with a unique `holon_e2e_*` run ID.
3. Complete user A/user B isolation, V1/V2 approval, feedback rollback, restart replay, and cleanup assertions.

## Release scope

MSI packaging was intentionally not run. Development implementation and tests must be accepted first.
