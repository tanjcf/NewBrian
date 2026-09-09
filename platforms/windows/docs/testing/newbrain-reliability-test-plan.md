# NewBrain Reliability Test Plan

Status: proposed release gate
Scope: Windows desktop, model gateway, Agent runtime, tools, approvals, persistence, MSI
Objective: measure and close the reliability gap against OpenClaw using repeatable failure tests and real user-interface proof.

## 1. Quality targets

Run a 1,000-turn deterministic campaign and a 100-turn real DeepSeek soak for every release candidate. A release passes only when all critical cases below pass and these service-level objectives hold:

| Metric | Deterministic target | Real DeepSeek target |
| --- | ---: | ---: |
| Completed turns without UI deadlock | 100% | >= 99% |
| First visible state transition | <= 1 s | <= 1 s |
| First content token after response headers | <= 3 s | P95 <= 30 s |
| No-response-header termination | <= 125 s including one retry | <= 125 s including one retry |
| Cancel acknowledged in UI | <= 2 s | <= 3 s |
| Duplicate tool or file side effects | 0 | 0 |
| Recoverable thread after forced restart | 100% | 100% |
| Renderer/main/agent-host unhandled errors | 0 | 0 |
| Process handles after 8-hour soak | no monotonic growth; final <= baseline + 10% | same |

Any turn still showing an active state after its terminal event, any approval bypass, workspace escape, duplicate side effect, lost user message, or false artifact-success claim blocks release.

## 2. Test environments and evidence

- `DET`: packaged production code with a contract-faithful local model gateway supporting delayed headers, partial SSE, malformed frames, disconnects, rate limits, and deterministic tool calls.
- `REAL`: configured production gateway and DeepSeek account, reasoning set to low. Never persist or print credentials.
- `MSI`: clean Windows user-data directory, installation through `windows/scripts/package-win-msi.ps1` output, then normal visible launch from the installed executable.
- Evidence root: `integration-artifacts/reliability/<build-id>/<case-id>/` containing screen recording, before/after screenshots, main/renderer/agent-host logs, rollout export, process sample CSV, fault-server trace, hashes, and `result.json`.
- Status vocabulary: `PASS`, `FAIL`, `BLOCKED`, `NOT RUN`, `PARTIAL`. Mock success never satisfies a real-model or packaged-MSI gate.

## 3. Execution order

1. Focused model-request, stream, cancellation, Agent-loop, approval, persistence, and renderer tests.
2. Deterministic Electron E2E with fault injection.
3. Packaged MSI install/upgrade/restart cases.
4. Real DeepSeek smoke and 100-turn soak.
5. Eight-hour mixed workload soak with process and resource sampling.

## REL-001: Normal multi-turn streaming through the visible UI

- Requirement: a normal conversation must stream, complete, accept a follow-up, and remain durable.
- Source paths: `windows/apps/desktop/src/main/index.ts`, `windows/apps/desktop/src/main/model-chat-step-service.ts`, `windows/apps/desktop/src/main/model-response-stream.ts`, `windows/apps/desktop/src/renderer/app/useDesktopCore.tsx`.
- Risk: baseline path can appear complete while the composer, persistence, or next turn is broken.
- Execution tier: Electron E2E, real-model smoke, packaged MSI.

### Preconditions

Installed MSI; clean workspace `reliability-normal`; logged-in test account; DeepSeek reasoning low; complete-access mode; no active request.

### Fixtures

Empty project containing `fixture.txt` with `RELIABILITY_MARKER_20260725`; record its SHA-256 before the test.

### User actions

1. Launch NewBrain visibly and create project `reliability-normal` through the UI.
2. Create a new thread and select complete access, DeepSeek, reasoning low.
3. Type `你好，请分三点说明当前项目中 fixture.txt 的用途，不要修改文件。` and click Send.
4. After completion type `把第二点改写得更简短。` and click Send.

### Running-state assertions

Both user messages remain visible; send changes to cancel while active; reasoning contains no private planning; streamed text grows without replay or layout overlap; composer returns to send after each terminal state.

### Runtime assertions

Exactly one request ID and one ordered terminal event per turn; stream deltas precede completion; the second request contains the first turn context; no tool call occurs.

### Side-effect assertions

`fixture.txt` SHA-256 is unchanged; one durable user and assistant record per turn; no duplicate rollout terminal records.

### Artifact assertions

Not applicable; no artifact link or file may be created.

### Recovery assertions

Restart NewBrain, reopen the project and thread, verify both turns and completed state, then send `只回复：恢复成功` successfully.

### Failure variants

Slow first token, scroll during streaming, project switch during execution, renderer reload after completion.

### Evidence

Screen recording, screenshots at submitted/streaming/completed/restarted states, rollout export, hashes, and logs.

### Pass criteria

All actions complete within targets; text and state survive restart; zero unintended changes and zero console errors.

### Release blocker

Failure blocks MSI release.

## REL-002: Missing response headers are bounded

- Requirement: a gateway that returns no HTTP response headers must not leave the UI thinking indefinitely.
- Source paths: `windows/apps/desktop/src/main/model-response-request.ts`, `windows/apps/desktop/src/main/model-chat-step-service.ts`, `windows/apps/desktop/src/main/model-chat-failure-service.ts`.
- Risk: the reported five-minute apparent freeze recurs.
- Execution tier: service integration and Electron E2E.

### Preconditions

DET gateway configured to accept a request and send no headers; timeout 60 seconds; retry budget for this failure is one.

### Fixtures

Fault script `headers-never` records connection time, abort time, and request identity without returning headers.

### User actions

1. Open a fresh visible thread.
2. Type `只回复你好` and click Send.
3. Observe the page without using internal controls.
4. After terminal failure, type `重试：只回复你好` and send using a healthy DET route.

### Running-state assertions

The user message stays visible; retry state is shown once; cancel remains usable; failure is visible by 125 seconds; composer is usable afterward; healthy follow-up completes.

### Runtime assertions

Exactly two upstream attempts, both aborted near 60 seconds; one canonical failure event; no third attempt and no late delta accepted from either abandoned request.

### Side-effect assertions

No artifact, tool side effect, duplicate assistant message, or active task remains.

### Artifact assertions

Not applicable; artifact count remains zero.

### Recovery assertions

Restart and verify the failed turn is terminal, not resumed automatically, and the healthy follow-up remains complete.

### Failure variants

Headers arrive at 59 seconds, headers arrive after abort, user cancels at 10 seconds, gateway refuses connection, HTTP 429 and HTTP 503.

### Evidence

Fault-server timestamps, UI recording, request logs, rollout terminal event, and post-restart screenshot.

### Pass criteria

Two attempts maximum; terminal UI by 125 seconds; explicit cancellation is never reported as timeout; no stale output.

### Release blocker

Failure blocks all releases.

## REL-003: Partial stream, idle timeout, and retry isolation

- Requirement: an interrupted stream must either recover cleanly or terminate without duplicated text.
- Source paths: `windows/apps/desktop/src/main/model-response-stream.ts`, `windows/apps/desktop/src/main/model-chat-step-service.ts`, `windows/apps/desktop/src/main/model-chat-event-projector.ts`.
- Risk: replayed prefixes, endless processing, or two concurrent streams.
- Execution tier: service integration and Electron E2E.

### Preconditions

DET gateway supports `partial-disconnect`, `partial-idle`, and healthy retry routes with stable response IDs.

### Fixtures

First attempt emits `第一段唯一标记` then disconnects or idles; retry emits the final three-paragraph answer once.

### User actions

1. Send `输出三段文字，每段带序号。` through the visible composer.
2. During the first partial stream, scroll upward and then back to the latest message.
3. Wait for recovery or terminal failure and send a follow-up.

### Running-state assertions

Partial text is visible promptly; retry status is visible; only one assistant bubble is active; scroll position is stable; cancel works; terminal state always restores the composer.

### Runtime assertions

Only the current attempt may publish deltas; abandoned response IDs are ignored; one terminal outcome wins according to cancellation/timeout precedence.

### Side-effect assertions

No duplicated memory, rollout completion, or follow-up context entry.

### Artifact assertions

Not applicable; no file is created.

### Recovery assertions

Restart and verify the saved assistant content equals the final visible content byte-for-byte.

### Failure variants

Malformed SSE JSON, missing `[DONE]`, UTF-8 split across chunks, disconnect before first delta, idle after reasoning but before content.

### Evidence

Raw SSE fixture log, delta timeline, screenshots, persisted message export, and equality hash.

### Pass criteria

No duplicate substring caused by replay; no active state beyond the configured idle bound; persisted and visible content match.

### Release blocker

Failure blocks nightly and MSI release.

## REL-004: Cancellation at every lifecycle boundary

- Requirement: cancel must stop model work, tools, and UI projection without later resurrection.
- Source paths: `windows/apps/desktop/src/main/model-chat-task-service.ts`, `windows/apps/desktop/src/main/agent-host-loop-bridge.ts`, `windows/apps/desktop/src/main/model-chat-failure-service.ts`, `windows/apps/desktop/src/renderer/app/useDesktopCore.tsx`.
- Risk: late output, duplicate side effects, or a permanently disabled composer.
- Execution tier: Electron E2E and packaged MSI.

### Preconditions

DET routes pause at pre-header, mid-stream, pre-tool, running-tool, and post-tool/pre-completion barriers.

### Fixtures

Workspace with a sentinel file; tool fixture would create `cancel-side-effect.txt` only when actually allowed to finish.

### User actions

1. For each barrier, send the supplied task from the UI.
2. Click Cancel once; for one run click it twice rapidly.
3. Send `只回复取消后可继续` after cancellation.

### Running-state assertions

Cancel acknowledges within 2 seconds; active indicators stop; late deltas never appear; composer accepts the next message.

### Runtime assertions

Abort reaches fetch, stream reader, Agent host, and running child process as applicable; one cancellation terminal event wins; cancellation is not retried.

### Side-effect assertions

Pre-tool cancellation creates no file; running-tool cancellation records the truthful tool outcome; rapid double cancel is idempotent.

### Artifact assertions

Any partial artifact is absent or explicitly marked failed and cannot be opened as successful output.

### Recovery assertions

Restart after every boundary; no cancelled run resumes and no side effect repeats.

### Failure variants

Cancel during retry delay, approval wait, child Agent wait, artifact generation, and app shutdown.

### Evidence

Barrier trace, UI recording, process tree before/after, rollout, file hashes, and restart screenshots.

### Pass criteria

All boundaries terminate deterministically, next turn works, and confirmed side effects occur at most once.

### Release blocker

Failure blocks all releases.

## REL-005: Tool approval, rejection, and stale approval

- Requirement: approval buttons must remain clickable and authorize exactly one matching tool call.
- Source paths: `windows/apps/desktop/src/main/approval-resume-service.ts`, `windows/apps/desktop/src/main/delegated-agent-ipc-service.ts`, `windows/apps/desktop/src/renderer/app/delegated-agent-approval.ts`, `windows/apps/desktop/src/renderer/app/WorkspaceModules.tsx`.
- Risk: the previously reported unclickable approve/reject state or approval replay.
- Execution tier: Electron E2E and packaged MSI.

### Preconditions

Approval mode enabled; DET requests a harmless workspace write followed by a second denied command.

### Fixtures

Expected file `approval-once.txt` with exact content `APPROVED_ONCE`; forbidden file `approval-denied.txt`.

### User actions

1. Send `创建 approval-once.txt，内容为 APPROVED_ONCE。`.
2. Click Approve once when the card appears.
3. Send the denied-file task and click Reject.
4. Reopen the old approval card and attempt no additional action; restart while a third approval is waiting, then approve it after recovery.

### Running-state assertions

Buttons are visible, enabled, and respond once; accepted tool shows live output and remains cancellable; rejected state is explicit; stale cards cannot trigger work.

### Runtime assertions

Approval call ID matches the pending tool; one resolution event per call; restart restores the same checkpoint; stale response is an idempotent no-op.

### Side-effect assertions

Approved file exists once with exact SHA-256; denied file is absent; no command runs before approval.

### Artifact assertions

The approved file link resolves to the same path and opens exact content; no link exists for the rejected file.

### Recovery assertions

Restart before and after approval; pending state survives; completed side effect never repeats.

### Failure variants

Double click, reject then late approve, child Agent completion before click, Agent host crash while awaiting approval.

### Evidence

Approval screenshots, IPC/tool trace, hashes, process logs, and restart recording.

### Pass criteria

Every decision is clickable and one-shot; authorization and side effect identities match; no bypass or replay.

### Release blocker

Failure blocks all releases.

## REL-006: Concurrent guidance, quote, and task isolation

- Requirement: guidance entered during an active run and quoted follow-ups must bind to the intended request without corrupting another thread.
- Source paths: `windows/apps/desktop/src/main/model-chat-task-service.ts`, `windows/apps/desktop/src/renderer/app/desktop-model.tsx`, `windows/apps/desktop/src/renderer/app/useDesktopCore.tsx`.
- Risk: dropped guidance, broken quote identity, or cross-thread output.
- Execution tier: Electron E2E and real-model smoke.

### Preconditions

Two projects and three threads; first task uses a DET barrier so guidance can be entered while active.

### Fixtures

Exact messages: initial `输出一个测试 doc 文件`; queued guidance `hello你好！`; quoted revision `修改引用内容为 LPP`.

### User actions

1. Send the initial task.
2. Before it completes, enter `hello你好！`, click Quote on that message, and submit it as guidance.
3. After completion, quote the intended message and send `修改引用内容为 LPP`.
4. Switch to another thread during execution and send a separate short prompt.

### Running-state assertions

Queued/guidance state is explicit; quote preview shows the correct source text and message identity; switching threads never hides or moves another thread's active task.

### Runtime assertions

Guidance attaches once to the owning request; quote metadata survives IPC and persistence; request IDs and event observers remain thread-scoped.

### Side-effect assertions

Only the owning project receives the DOCX; the other thread receives no messages, files, or goal state from it.

### Artifact assertions

Parse the DOCX independently; required fact `LPP` is present after revision, superseded text is absent where replacement was requested, and the UI link points to the revised file.

### Recovery assertions

Restart and verify quote rendering, thread ownership, final artifact link, and no duplicate file.

### Failure variants

Guidance arrives after terminal completion, quoted source is deleted, project switches during upload, simultaneous completion of both threads.

### Evidence

Screen recording, quote metadata export, request/event trace, DOCX parser output, SHA-256, and restart screenshot.

### Pass criteria

No guidance is silently lost; quote and task ownership are exact; artifact semantics and isolation pass.

### Release blocker

Failure blocks MSI release.

## REL-007: Crash and restart recovery without duplicate side effects

- Requirement: renderer, main process, and Agent host crashes must converge to a truthful recoverable state.
- Source paths: `windows/apps/desktop/src/main/agent-host-client.ts`, `windows/apps/desktop/src/main/thread-rollout-recovery-service.ts`, `windows/apps/desktop/src/main/thread-rollout-lifecycle-service.ts`, `windows/apps/desktop/src/renderer/app/generation-failure-recovery.ts`.
- Risk: task loss, phantom running state, duplicate tool execution, or restart loop.
- Execution tier: Electron E2E and packaged MSI.

### Preconditions

DET workflow contains checkpoints before tool, after tool, awaiting approval, and mid-stream. Process IDs are sampled externally.

### Fixtures

Idempotency marker tool appends one line containing its stable call ID to `recovery-once.log`.

### User actions

1. Start each workflow through the UI.
2. At the documented barrier, terminate only the target renderer, main, or Agent-host process using the fault controller.
3. Relaunch NewBrain normally and reopen the same thread.
4. Use visible Resume/Retry only when offered.

### Running-state assertions

Renderer recovery is bounded; the app never shows an endless blank window; recovered status is truthful; no hidden automatic rerun occurs after a confirmed side effect.

### Runtime assertions

Checkpoint and terminal precedence are canonical; pending promises reject on host crash; lazy host restart creates one new host; recovered execution adopts stable identities.

### Side-effect assertions

`recovery-once.log` contains each call ID exactly once; no duplicate artifacts, memories, or completion events.

### Artifact assertions

Completed artifacts remain parseable; interrupted artifacts are not presented as success.

### Recovery assertions

This case is itself the recovery assertion; perform a second clean restart to prove convergence and persistence.

### Failure variants

Crash before checkpoint flush, corrupt/truncated rollout tail, missing thread, Agent host exits twice, renderer crashes four times in one minute.

### Evidence

Process timeline, crash logs, pre/post database and rollout snapshots, file hashes, screen recording, and second-restart screenshot.

### Pass criteria

Every run becomes completed, failed, cancelled, or awaiting approval within a bounded period; zero duplicate confirmed side effects; no infinite restart loop.

### Release blocker

Failure blocks all releases.

## REL-008: MSI upgrade, eight-hour soak, and resource stability

- Requirement: installed behavior must match development behavior and remain responsive under sustained mixed workloads.
- Source paths: `windows/apps/desktop/package.json`, `windows/scripts/package-win-msi.ps1`, `windows/apps/desktop/src/main/index.ts`, `windows/apps/desktop/src/main/managed-child-process.ts`.
- Risk: package-only missing resources, process-name regressions, leaked handles, or degradation over time.
- Execution tier: packaged MSI and real-model soak.

### Preconditions

Install previous released MSI with existing projects, upgrade using the candidate MSI, then launch normally. Capture baseline process, memory, handle, thread, and disk-use samples.

### Fixtures

Workload cycle: 6 normal chats, 1 cancelled stream, 1 approved tool, 1 rejected tool, 1 DOCX generation, 1 project switch, and one app restart every 20 cycles.

### User actions

1. Upgrade through the MSI and launch from Start Menu.
2. Verify automatic login and existing project/thread history.
3. Run the workload through visible UI automation for eight hours.
4. Manually inspect one cycle every hour and the final cycle.

### Running-state assertions

No blank window, overlap, frozen composer, invisible active input, or stale processing state; all six Electron roles display as `newbrain.exe`; process count returns to baseline after each restart.

### Runtime assertions

No unhandled rejection, crash loop, orphan Agent host, permanently pending request, or increasing retry storm; each cycle has balanced start/terminal events.

### Side-effect assertions

Expected file count and stable call IDs match the workload manifest; disk growth is explained by named logs/artifacts; no workspace escape.

### Artifact assertions

Every generated DOCX passes ZIP signature and independent parser checks; sampled required text matches its originating request; links reopen after restart.

### Recovery assertions

After the final forced restart, all threads load, no task auto-replays, and a fresh real-model turn completes.

### Failure variants

Offline start, gateway outage for 10 minutes, sleep/resume, network adapter disable/enable, low disk warning, upgrade with an active thread.

### Evidence

MSI hash and install log, hourly screenshots, process/resource CSV, event-balance report, artifact manifest/parser output, and final real-model recording.

### Pass criteria

All quality targets in section 1 hold; no monotonic resource leak; zero release-blocking invariant violations; real-model success rate is at least 99% with all failures visibly terminal and recoverable.

### Release blocker

Failure blocks MSI release.

## 4. Automation ownership and commands

Add deterministic tests beside their owning modules. Add Electron scenarios under `windows/apps/desktop/scripts/` and keep visible user actions in the E2E layer. The following commands form the initial gate; new reliability scripts must be added as named package scripts before the plan becomes enforced:

```powershell
cd windows/apps/desktop
node --experimental-strip-types --test src/main/model-response-request.test.ts
node --experimental-strip-types --test src/main/model-chat-step-service.test.ts
node --experimental-strip-types --test src/main/model-chat-agent-loop-service.test.ts
pnpm run test:approval-runtime
pnpm run test:thread-recovery-runtime
pnpm run test:holon-runtime

cd ../..
pnpm run check
powershell -NoLogo -ExecutionPolicy Bypass -File scripts/package-win-msi.ps1
```

Proposed scripts:

- `test:reliability-faults`: REL-002 through REL-005 deterministic Electron cases.
- `test:reliability-concurrency`: REL-006 with two projects and three threads.
- `test:reliability-crash`: REL-007 process fault campaign.
- `test:reliability-msi-smoke`: REL-001 plus MSI subset of REL-005 and REL-007.
- `test:reliability-soak`: REL-008; duration and real-provider execution require an explicit release environment.

## 5. Reporting and release decision

Each run writes a machine-readable `result.json` containing build SHA, MSI SHA-256, environment, case status, start/end times, assertion counts, first actionable failure, evidence paths, and unverified surfaces. The release report must list every case; missing evidence is `NOT RUN`, not `PASS`.

Release requires:

1. REL-001 through REL-008 all `PASS` on the candidate code SHA.
2. Deterministic 1,000-turn campaign meets every section 1 target.
3. Packaged MSI smoke and restart recovery pass on a clean profile and an upgrade profile.
4. Real DeepSeek 100-turn soak meets the 99% success target; every unsuccessful turn terminates visibly and the next turn remains usable.
5. No accepted critical or high review finding remains.

This document defines the gate; cases not yet implemented remain `NOT RUN` and therefore do not establish OpenClaw-equivalent reliability.
