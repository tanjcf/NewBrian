# BRAIN Unified Capability Runtime v1

> Status: approved architecture baseline. Implementation must follow this
> document; changes to the capability contract require a versioned review.

## 1. Decision summary

BRAIN does not expose “plugins” as a single executable concept. It exposes a
unified capability runtime. A user asks for an outcome; the runtime selects,
authorizes, executes, verifies, and reports the smallest set of capabilities
required to produce that outcome.

The user-facing default is zero configuration. Extension details, providers,
manifests, health checks, and audit records remain available in an advanced
view but are not required for ordinary work.

The runtime supports four provider classes:

| Provider | Meaning | Default behavior |
| --- | --- | --- |
| `instruction` | Skill, knowledge, or workflow guidance | Inject only when relevant |
| `builtin` | NewBrain-owned deterministic local capability | Auto-use when policy allows |
| `process` | Local executable or script | Never auto-run without policy/approval |
| `mcp` | External or local MCP server | Auto-use only after connection and permission |

An extension may combine providers, but every capability is registered and
authorized independently. A `SKILL.md` alone can never claim to be an
executable provider.

The runtime also owns capability acquisition. “Install a plugin” is an
internal recovery action, not a user workflow. The resolver first uses an
already-active builtin, then a verified local provider, and only then requests
an approved package from a trusted catalog. Installation is transactional:
download, signature and compatibility check, isolated install, health check,
conformance test, activation, and rollback on any failure. An unverified
package can be suggested, but it cannot enter the model-visible registry.

## 2. Product contract

### Normal user flow

```text
User intent
  -> attachment and workspace inspection
  -> intent and capability routing
  -> capability acquisition when no active provider exists
  -> automatic low-risk execution
  -> artifact/data verification
  -> concise result and links
```

The user does not choose a plugin for ordinary requests. The composer may show
the selected capability as progress text, for example “正在读取 Excel” or
“正在验证输出文件”. It must not expose internal provider terminology unless
the user opens advanced details.

### User intervention is required only when

1. an operation can delete, overwrite, publish, or externally transmit data;
2. a script or external process must run;
3. a new external account, credential, or MCP connection is needed;
4. an input ambiguity can materially change the result;
5. the requested capability is unavailable or failed verification.

Reading, analyzing, creating a new output file, and local verification are
non-interactive by default.

### Autonomous acquisition decision

The resolver ranks candidates by semantic fit, trust, local availability,
privacy, cost, latency, and verification coverage. It must prefer a slightly
less capable verified local provider over an unverified or externally hosted
provider. If no candidate satisfies the acceptance contract, it stops with a
clear explanation and asks the user rather than improvising a fake result.

```text
request -> active registry -> verified local provider -> trusted catalog
        -> permission preview -> silent low-risk install -> conformance test
        -> activate or rollback
```

Automatic installation is allowed only for packages that are signed or
content-addressed, version-compatible, sandboxable, and limited to declared
permissions. External credentials, network access, process execution, and
destructive writes remain explicit approval boundaries.

## 3. Extension contract

The next manifest contract is versioned and machine-readable:

```json
{
  "schema_version": 2,
  "id": "spreadsheets",
  "version": "1.0.0",
  "providers": [
    { "id": "guidance", "type": "instruction", "path": "./skills/" },
    { "id": "local", "type": "builtin", "capabilities": [
      "spreadsheet.inspect", "spreadsheet.analyze", "spreadsheet.update"
    ] }
  ],
  "permissions": ["workspace.read", "workspace.write"],
  "verification": { "required": true, "suite": "spreadsheet-v1" }
}
```

The manifest is descriptive, not authoritative. Activation succeeds only when
the declared capabilities are found in the runtime registry and the provider
passes its verification suite. A manifest may never create an arbitrary tool
by naming it.

## 4. Capability descriptor

Each registered capability has a stable descriptor:

```text
CapabilityDescriptor
  id                 stable namespace and operation name
  version            compatible contract version
  providerId         builtin/process/mcp provider identity
  inputSchema        strict JSON schema
  outputSchema       strict data-only result contract
  risk               read/local-write/overwrite/delete/external
  permissions        required policy permissions
  approval           never/conditional/always
  idempotency        safe-key or non-repeatable declaration
  verification       required postcondition checks
  availability       active/degraded/disabled/failed
```

The model receives only descriptors whose provider is active and whose policy
requirements are satisfied. Model output is never treated as a capability
declaration.

## 5. Runtime pipeline

```text
Manifest loader
  -> signature/hash and schema validation
  -> provider supervisor
  -> capability registry
  -> intent router
  -> policy decision
  -> approval checkpoint when required
  -> normalized provider invocation
  -> result and artifact verifier
  -> durable audit event and UI projection
```

All providers use one normalized invocation boundary:

```text
invoke(capabilityId, validatedInput, executionContext)
  -> { status, output, artifacts, evidence, error }
```

The boundary preserves provider trust information, request IDs, tool-call IDs,
workspace scope, explicit cancellation, and approval decisions. Invocation has
no fixed wall-clock deadline; completion, provider exit/error, user cancellation,
or application shutdown are the only terminal triggers.

## 5A. Goal-oriented task graph

The runtime treats a user request as a goal, not as a single tool call. The
planner creates a durable task graph whose nodes declare a capability, input
and output contracts, dependencies, risk, retry policy, idempotency key, and
verification postcondition. Independent nodes may run in parallel; mutating
nodes are serialized by workspace and artifact identity. A node is complete
only after its verifier passes. Restart recovery resumes completed nodes and
does not repeat confirmed irreversible effects.

```text
goal -> inspect -> plan -> acquire -> approve -> execute -> verify -> deliver
```

The model may propose a graph, but the runtime validates and owns it. Model
text cannot invent capabilities, permissions, successful results, or artifact
links.

## 5B. Capability acquisition and installation

Acquisition is an internal runtime action. The resolver ranks active builtins,
verified local providers, trusted catalog packages, and temporary user-provided
providers by semantic fit, trust, privacy, cost, latency, and verification
coverage. It prefers a verified local provider over an unverified or remote
provider even when the latter has more features.

Installation is transactional:

```text
discover -> download -> signature/hash check -> isolated install
         -> dependency check -> health check -> conformance test
         -> atomic activate, or cleanup and rollback
```

Only signed or content-addressed, compatible, sandboxable packages with
declared permissions may be installed automatically. The active version is
pinned for the current task. The supervisor retains a last-known-good version
and restores it after crashes, failed health checks, revoked signatures, or
failed conformance tests. Remote catalog installation remains gated until the
security and rollback test suite is complete.

## 5C. Provider selection contract

One capability may have multiple providers. Selection must consider provider
health, platform support, trust level, privacy boundary, required permissions,
estimated cost, latency, and verifier coverage. Provider failure removes it
from the model-visible registry and triggers a compatible fallback when the
fallback preserves the requested output contract. A fallback that changes the
meaning or quality guarantee must be reported to the user.

## 5D. User experience contract

The default interface exposes outcomes and plain-language progress only:
“正在读取文件”, “正在分析数据”, and “正在验证输出文件”. Provider names,
versions, permissions, install sources, and evidence are available in an
advanced diagnostics view. Ordinary users never need to select or configure a
plugin. Approval is reserved for external transmission, credentials, process
execution, overwrite/delete, payment, or material ambiguity.

## 5E. Task-start capability preparation

The Agent Runtime invokes `CapabilityResolver` before failing an unknown
capability. Existing registered capabilities remain on the fast path. For a
missing capability, the resolver searches the active registry and trusted
catalog, applies platform and runtime compatibility checks, and performs a
low-risk installation through `ProviderSupervisor`. The task continues only
after the installed provider has registered the requested capability and the
runtime can obtain its descriptor. A denied, unavailable, or unverified
capability produces a user-facing explanation; it is never silently replaced
with instruction text.

The resolver is injected into each platform runtime, while capability
semantics remain shared. Platform code supplies only the process, path, and
credential adapters required by the selected provider.

## 5F. Official capability catalog

The first release uses a bundled, content-addressed catalog for core and
official providers. Catalog entries declare capability IDs, supported
platforms, runtime compatibility, permissions, privacy boundary, verification
coverage, and an installation source. The catalog accepts only `core` and
`official` trust levels. Third-party entries require a separate reviewed
catalog and cannot be inserted into the bundled catalog.

After installation, `ProviderActivation` converts the verified manifest into
registered providers and capabilities. A package that installs files but does
not register the requested capability is considered failed and is rolled back.
This keeps package installation, capability registration, and model-visible
tool exposure as one atomic product contract.

### Supervisor responsibilities

The provider supervisor is the single owner of install and activation state.
It maintains a content-addressed package cache, an active-version pointer, and
a last-known-good version. It performs atomic activation only after the
conformance suite passes. Crashes, health-check failures, or revoked
signatures move the provider to `degraded` and restore the last-known-good
version when one exists.

## 6. Provider lifecycle

```text
discovered -> validated -> installed -> awaiting_permission -> active
                                      -> degraded -> failed
active -> disabled -> removed
```

`installed` is not `active`. A provider with no verified capabilities is shown
as installed but unavailable. A disconnected MCP provider is degraded and its
tools are removed from the model tool list. A process provider is never started
during discovery or approval preparation.

## 7. Permission and risk model

Permissions are capability-level, not extension-level:

```text
workspace.read       read files inside the selected workspace
workspace.write      create or modify files inside the workspace
workspace.overwrite  replace an existing file
workspace.delete     delete files
process.execute      launch a local process or script
network.connect      connect to a remote service
credential.use       use a stored external credential
mcp.invoke           call an MCP capability
```

Policy decisions are durable and explainable. A normal local XLSX analysis
needs `workspace.read`; writing a new summary under `outputs/` needs
`workspace.write`; replacing the source workbook needs `workspace.overwrite`
and an explicit approval.

## 8. File and artifact workflow

Every document capability follows the same chain:

```text
identify -> safe path resolve -> parse -> bounded context
  -> operation -> write to controlled output
  -> independent reopen -> structural verification
  -> optional render -> artifact evidence -> clickable result
```

For spreadsheets this means inspecting sheets, formulas, typed values, and
dimensions before analysis; reopening the output after edits; and reporting
formula/style/row-count evidence. Returning a Python script instead of the
requested workbook is a failed delivery, not a successful fallback.

## 9. Skill, Codex, OpenClaw, and MCP mapping

| Source | Runtime mapping | Automatic execution |
| --- | --- | --- |
| Built-in skill | `instruction` provider | Guidance only |
| OpenClaw `SKILL.md` | `instruction` provider | Guidance only |
| OpenClaw `scripts/` | `process` candidate | No; approval and scan required |
| Codex built-in tool | `builtin` provider | Yes, policy permitting |
| Codex MCP plugin | `mcp` provider | Only after healthy connection |
| Figma plugin | `mcp` provider | Only after account/credential authorization |

The UI must show “仅提示词” for an instruction-only package and must not use
“已启用” as a synonym for “可执行”.

## 10. Persistence and evidence

The runtime persists safe execution evidence, never private chain-of-thought:

```text
CapabilityInvocation
  requestId, turnId, toolCallId
  extensionId, providerId, capabilityId, version
  inputHash, permissionDecision, approvalDecision
  startedAt, finishedAt, status
  outputSummary, artifactPaths, artifactHashes
  verificationStatus, errorCode
```

Side-effecting operations use an idempotency key derived from turn, tool-call,
and operation identity. Recovery replays state but never repeats a confirmed
irreversible side effect without an explicit compensation or new approval.

## 11. BRAIN layering

The following belongs in `shared/`:

- extension and capability contracts;
- registry, routing, policy, invocation, and evidence logic;
- cross-platform builtin providers;
- provider conformance tests;
- instruction-pack parsing and classification.

The following belongs in `platforms/<os>/`:

- native process and shell adapters;
- Electron IPC wiring and platform permissions;
- signing, installers, entitlements, AppImage/DMG/MSI behavior;
- platform-specific credentials and path/encoding behavior.

Materialized workspaces remain disposable. No platform may fork capability
semantics merely because packaging or shell behavior differs.

## 12. Migration plan

### Phase 0 — contract and inventory

Freeze the v2 contract, inventory every current skill/plugin/MCP/builtin tool,
and mark each one with its actual provider and verification status. Do not add
new user-visible capability claims during this phase.

### Phase 1 — runtime foundation

Implement the descriptor, registry, provider lifecycle, policy decision, and
normalized invocation result. Add registry tests for missing providers,
invalid schemas, unavailable MCP, approval denial, cancellation, and
duplicate tool-call delivery.

Add acquisition and supervision with bundled local packages and a test catalog
first. Enable remote installation only after signature, sandbox, rollback, and
audit tests pass.

Add the acquisition supervisor in this phase, initially allowing only bundled
local packages and a test catalog. Remote catalog installation remains behind
a feature flag until signature, sandbox, rollback, and audit tests pass.

### Phase 2 — migrate real builtins

Migrate spreadsheet, document, PDF, presentation, workspace, browser, and
visualization operations into builtin providers. Each gets an independent
conformance suite and artifact evidence contract.

### Phase 3 — migrate external sources

Map Codex plugins and OpenClaw packages into instruction/process/MCP providers.
Scripts stay inactive by default. MCP tools are registered only after health
checks. Existing feature configuration is read compatibly and projected into
the new state model.

### Phase 4 — automatic routing and progressive disclosure

Add intent-to-capability routing, automatic low-risk execution, concise
progress copy, and an advanced diagnostics view. Remove manual plugin selection
from the normal path while keeping explicit override for expert users.

### Phase 5 — cross-platform release gate

Run the same capability conformance suite after Windows, macOS Intel/ARM, and
Ubuntu materialization. Then build installers and verify that packaged runtime
contents contain the registered providers and manifests.

## 13. Non-negotiable acceptance criteria

The architecture is not complete unless:

1. an instruction-only package cannot appear as an executable tool;
2. every model-visible tool has a registry descriptor and provider;
3. every mutating operation has policy, approval, idempotency, and evidence;
4. every office artifact is independently reopened and verified;
5. provider failure removes or degrades capabilities visibly;
6. restart does not duplicate irreversible side effects;
7. ordinary users can complete common tasks without managing plugins;
8. all supported platforms pass the same semantic capability tests.
9. missing capabilities can be acquired without user plugin management;
10. failed installation leaves no partially active provider or side effect;
11. automatic installation never expands permissions beyond the manifest;
12. package upgrades are atomic, request-pinned, and reversible.
9. missing capabilities can be acquired without user plugin management;
10. failed installation leaves no partially active provider or side effect;
11. automatic installation never expands permissions beyond the manifest;
12. package upgrades are atomic, request-pinned, and reversible.
