# BRAIN Product Architecture

> Related docs:
> - [Workspace architecture and roadmap](../product/workspace-architecture.md)
> - [Implementation playbook](../product/implementation-playbook.md)
> - [Unified capability runtime v1](./unified-capability-runtime-v1.md)
> - [Scene Tools v1 — seven workspace sub-architectures](./brain-scene-tools-v1.md)
> - [Game runtime v1 — game scene only, UE5-aligned](./brain-game-runtime-v1.md)
> - [Docs index](../README.md)

## 1. Product boundary

BRAIN is a cross-platform desktop agent workbench, not a stock-platform client and not a Spring backend rewrite. It provides one conversation surface, local project access, controlled tools, artifacts, skills, and multiple workspaces for different professional tasks.

The first product surface contains these six workspace families:

1. Quantitative trading
2. Game creation
3. Video and music creation
4. Data and decision support
5. Software and automation
6. Document creation

Video and music are separate workspace modes inside one media family. A workspace changes tools, panels, artifacts, skills, and project templates. It does not create a different chat product.

The workspace switcher belongs at the top of the left navigation. Projects and conversations are scoped by workspace while files remain a shared project capability. Switching is infrequent, so it must not occupy the conversation header or center canvas.

## 2. Non-negotiable security rules

### 2.1 Company credentials

- Company model and search credentials exist only in the server control plane.
- BRAIN authenticates with a user session and device identity, never with a company API key.
- Company credentials must not enter desktop config, IPC, logs, crash reports, artifacts, prompts, plugins, or Rust Core.

### 2.2 User private models

- A user may configure a model endpoint and their own purchased API key.
- The key is write-only from the renderer.
- The Electron main process removes it from JSON before persistence.
- Windows uses DPAPI through Electron `safeStorage`.
- macOS uses Keychain through Electron `safeStorage`.
- Ubuntu accepts only Secret Service or KWallet backends. Electron `basic_text` is rejected.
- The renderer receives only `apiKeyConfigured`; plaintext is decrypted immediately before a trusted main-process network request.
- When protected storage is unavailable, saving fails closed. Plaintext fallback is forbidden.

### 2.3 Local authority

- Renderer, model output, attachments, plugins, URLs, and imported state are untrusted.
- Renderer capabilities flow through typed preload APIs into validated main-process IPC handlers.
- File access is restricted to an explicitly authorized project root after real-path and symlink checks.
- Mutating commands and writes require policy evaluation and approval according to risk.
- Long-running work has explicit cancellation, bounded output, process-exit handling, and cleanup behavior. BRAIN never terminates a task merely because a fixed wall-clock duration elapsed.

## 3. Runtime architecture

```text
React renderer
  -> typed preload API
  -> Electron main control plane
  -> runtime adapters
  -> Node agent runtime (current compatibility runtime)
  -> Rust Core sidecar (incremental privileged execution core)
  -> tools, local files, Git, document workers, media workers

Electron main
  -> Spring model/search control plane by user session
  -> user private model endpoint by OS-protected BYOK
```

Spring remains the remote control plane for accounts, entitlements, billing, company model routing, company web-search routing, and server policy. Rust is developed inside BRAIN as a desktop sidecar; it does not replace spring-app.

## 4. Rust Core boundary

Rust Core is an independent process, not a native library loaded into the Electron or Spring process. Its responsibilities are:

- restricted file read and write;
- child-process and terminal execution;
- Git operations;
- local file indexing and incremental hashing;
- CPU, memory, and output limits without a fixed execution deadline;
- approval-token validation;
- cancellation and crash recovery;
- computation-heavy backtesting and indicator workloads;
- media task orchestration;
- process isolation for document-rendering workers.

Rust Core never receives, stores, or forwards company model/search keys or user private model keys. It does not decide billing or model routing.

The versioned protocol contains:

```json
{
  "protocol_version": "1",
  "request_id": "req_...",
  "project_id": "project_...",
  "workspace_type": "documents",
  "operation": "file.read",
  "approval_token": "opaque-or-empty",
  "resource_limits": { "timeout_ms": 0, "max_output_bytes": 1048576 },
  "status": "accepted",
  "error_code": "",
  "artifacts": []
}
```

`timeout_ms` is a version-1 compatibility field whose only valid value is `0`; it cannot terminate work. Phase 1 uses local HTTP or stdio with framed JSON. The stable transport becomes gRPC only after protocol behavior and cancellation semantics are proven.

## 5. Project and storage model

- Conversation metadata, workspace catalog, task state, approvals, and artifact indexes use local SQLite/event files with schema versions.
- User project content remains in user-authorized local folders by default.
- Large source files and generated artifacts are not copied into a central BRAIN account store by default.
- Server synchronization stores bounded account state, entitlements, optional encrypted preferences, and user-authorized cloud artifacts only.
- Retention limits apply per project and artifact class. Cache data is disposable and excluded from backup.
- Tenants are never provisioned one permanent server-side project filesystem each.

## 6. Document capability

BRAIN must both read and create or modify these formats:

| Format | Read and render | Structural anchor for annotations and edits |
|---|---|---|
| Image | raster decode, metadata, OCR when requested | image coordinates, selection, zoom baseline |
| PDF | pages, text layer, images, OCR fallback | page, rectangle, selected text, OCR coordinates |
| DOCX | paragraphs, runs, tables, images, styles | paragraph, text range, table cell, image object |
| PPTX | slides, shapes, text, media, notes | slide, shape ID, text range, z-order |
| XLSX | sheets, cells, formulas, charts | sheet, cell/range, formula, chart object |
| TXT/Markdown | UTF-8 text and structure | line and character range |

Annotations are immutable selections stored separately from the source. A conversation command references annotation IDs. Modification creates a preview and a new artifact revision; it does not silently overwrite the source. Format workers run outside the main Electron process and are isolated by Rust Core as that capability becomes available.

## 7. Search and model behavior

- Current news search remains the free first source where it can answer the request.
- Paid web search is automatically invoked for latest announcements, policy, news, prices, and other time-sensitive information when free sources are insufficient.
- General knowledge, calculations, rewriting, and code questions do not search by default.
- Time-sensitive answers include source links and search time.
- Search failure is explicit; the model must not invent current information.
- Administrators centrally enable, disable, and route paid search. Ordinary users require no configuration.
- A tool call can produce search/fetch cost plus another model inference round; cost policy and limits are enforced by the server control plane.

## 8. Quantitative trading workspace

The first quantitative workflow supports historical price queries, daily/weekly/monthly bars, OHLC, volume, turnover, change percentage, date range, forward/backward/no adjustment, candlestick charts, and volume charts. The right panel hosts a real market-chart plugin and portfolio tools.

Simulation includes holdings, cash, cost basis, realized and unrealized P&L, orders, fills, fees, and portfolio curve. Skills may run scheduled simulated strategies. Performance is isolated and compared per skill using return, drawdown, volatility, Sharpe-like metrics, win rate, and trade count. No live order is placed without a separately designed broker boundary and explicit approval.

## 9. Cross-platform source ownership

- Identical cross-platform implementation belongs in `shared/`.
- Complete OS-specific files belong in `platforms/windows`, `platforms/macos/common`, or `platforms/ubuntu/common`.
- CPU metadata and native differences belong in architecture overlays.
- `.materialized/` is generated and never edited directly.
- Every supported target must materialize an agentd entry and desktop main, preload, and renderer entries.
- Windows, macOS, and Ubuntu source builds are independent quality gates.

## 10. Reliability and observability

- Provider-required `reasoning_content` is retained only in memory for the current tool continuation, then discarded.
- Private chain-of-thought is never placed in thread history, diagnostics, error reports, or rollout logs; only bounded user-visible summaries and stable features are retained.
- Error reports preserve structured category, symptom, possible cause, recent conversation starts, and diagnostic tails under a fixed size budget.
- Every request carries request, thread, turn, and project identifiers.
- Durable state changes use atomic writes or transactions and versioned migrations.
- Release readiness requires packaged install, upgrade, restart recovery, and real OS verification. A Vite build alone is not release evidence.

## 11. Current implementation baseline

The following commits are verified milestones:

- `21880a2`: preserve thinking-mode context across turns;
- `567c81b`: preserve bounded structured diagnostics;
- `6f6cc55`: protect macOS user private-model credentials;
- `799bfbc`: restore shared cross-platform desktop module ownership;
- `68a0ca7`: establish Ubuntu x64/arm64 source-build baseline and reject insecure Linux credential fallback.

This baseline is not the final product. Real macOS/Ubuntu packaging and runtime tests, the Rust sidecar, document annotation workers, complete workspace experiences, and production release gates remain implementation work.
