# NewBrain Agent Runtime v2

## Scope

The Windows runtime implements a local-first agent architecture with durable
conversation events, structured tool calling, reusable skills, plugin/MCP
contributions, delegated agents, policy enforcement, memory, and scheduled
automation.

## Runtime flow

```text
Desktop renderer
  -> Electron IPC
  -> LocalAgentRuntime
     -> AgentLoop
        -> model callback (Responses or Chat Completions)
        -> PolicyEngine
        -> ToolRegistry
           -> built-in tools
           -> dynamically registered MCP tools
     -> SkillRegistry
     -> MemoryIndex
     -> MultiAgentOrchestrator
  -> append-only rollout JSONL
  -> SQLite projections
```

## Durable state

- Each thread has one append-only `*.rollout.jsonl`.
- State snapshots and events share the rollout and carry schema, thread, turn,
  and timestamp fields.
- Per-file append serialization and `fsync` prevent interleaved writes.
- Readers ignore a partial crash tail and recover the latest valid snapshot.
- SQLite WAL databases project threads, spawn edges, delegated tasks, logs,
  memories, and goals for indexed access.

## Tools and approvals

- Built-in tools are registered with names, JSON Schemas, risk levels, and
  approval requirements.
- Responses `function_call`, Chat Completions `tool_calls`, and streamed
  function arguments enter the same resumable agent loop.
- The loop pauses on approval and resumes with either a tool result or an
  explicit denial result.
- Ordered local rules support `allow`, `ask`, and `deny`.
- Non-overridable guards block critical system commands and mutating paths
  outside the workspace, including symbolic-link escapes.
- Shell children have time and output limits. This is a local process/policy
  boundary, not a VM or kernel security boundary.

## Skills, plugins, and MCP

- Skills are discovered from `SKILL.md` metadata and loaded in full only after
  matching.
- Plugin manifests can contribute skill roots and MCP server definitions.
- Enabling, disabling, or deleting a plugin activates or removes those
  contributions.
- Discovered MCP tools are dynamically registered in the model tool list.
- MCP stdio supports newline-delimited JSON-RPC and legacy `Content-Length`
  frames.
- Enabled local MCP processes and dynamic tool registrations are restored at
  startup and terminated during app shutdown.

## Delegation, memory, and automation

- Parent threads delegate bounded instructions to role-specific child threads.
- Child tasks have concurrency limits, independent failure states, durable
  SQLite records, restart recovery, and explicit result merge.
- Memory records are bounded, searchable, usage-ranked, persisted, and injected
  only when relevant to the current request.
- Automations run in isolated runtime instances, do not replace the active UI
  thread, prevent overlapping scheduler ticks, and retry with exponential
  backoff before pausing.

## Verification

The implementation is covered by:

- agent loop approval, denial, and structured tool tests;
- tool, policy, memory, skill, delegated-agent, and runtime integration tests;
- rollout recovery and concurrent append tests;
- SQLite schema and persistence tests;
- Responses/Chat tool-wire and MCP framing tests;
- TypeScript checking and production Electron builds.
# Mandatory streaming and durable writing rule

- Every **user-facing chat and agent-loop** model request must set `stream: true` at the wire boundary and consume SSE incrementally. Application services must forward text deltas to the renderer as they arrive; replaying a completed response character-by-character is fallback compatibility behavior, not streaming. Desktop entry point: `buildModelRequestPayload` in `apps/desktop/src/main/model-gateway-protocol.ts`. Gateway chat/anthropic adapters and native Responses prep also force upstream `stream: true`. Stream progress renews agent-host / loop inactivity budgets (`onHostModelProgress` → `agent.model.progress` / `touch`).
- **Intentional non-stream exceptions** (do not change these to SSE without a product reason): connectivity / draft probes and text certification runners (short JSON “OK” checks; streaming adds idle timeouts and parse complexity with no UI benefit); local vision describe sidecar (`describeImageWithLocalVision`, Ollama-style `/api/chat`); other batch/admin health probes that await a single bounded response.
- Durable goals and long-form writing must never use a fixed wall-clock request timeout. They stop only on explicit user cancellation, a provider/network failure, an approval or user-input boundary, or a bounded no-progress safety guard.
- Transient connection/provider failures use bounded retry with visible status and resume from the persisted goal/plan state. A completed model turn is not a completed task while the durable goal still has incomplete plan steps.
- Any change that reintroduces a fixed total timeout for durable writing, disables SSE delta forwarding for chat/agent, or finalizes an incomplete active goal violates the runtime architecture and must fail review.

## Mandatory government-writing evidence rule

- Material claims about policies, regulations, government actions, statistics, dates, organizations, local practices, progress, achievements, or attributed official statements require primary evidence from the originating authority: government websites, official gazettes, official documents, or official statistical bulletins.
- When sufficient official material is not already supplied, the government-writing workflow must search before drafting factual detail. Search snippets, news reports, self-media, encyclopedias, and model memory may locate evidence but cannot replace the primary official publication.
- The workflow must never fabricate a policy or document title, issuing authority, document number, quotation, statistic, date, URL, or citation. Unsupported details must be omitted or visibly marked `【待核验】` / `【待补充】`.
- Added detail must be either supported fact, explicitly identified analysis, or explicitly identified recommendation. Plausible inference must never be presented as an accomplished government fact.
