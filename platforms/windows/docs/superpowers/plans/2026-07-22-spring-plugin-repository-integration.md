# Spring Plugin Repository Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the NewBrain plugin marketplace to the Spring plugin repository and prove secure install, update, reconciliation, and reporting without requiring a live MySQL server.

**Architecture:** Typed protocol and preload methods expose narrow plugin operations. Electron main owns authenticated HTTP, external-payload validation, Ed25519/ZIP verification, atomic local state, and recovery; the existing renderer consumes normalized snapshots only.

**Tech Stack:** TypeScript 5.8, Electron 35, Node test runner, JSZip 3.10, React 19, Spring Boot 3.3, JUnit 5/MockMvc.

---

### Task 1: Cross-process plugin protocol

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Test: `apps/desktop/src/main/plugin-protocol.test.ts`

- [ ] Write a failing source contract test for `PluginCatalogItem`, `PluginCatalogSnapshot`, operation inputs/results, and six `desktopIpcChannels.plugins` channels.
- [ ] Run `pnpm --filter @codex-forge/desktop exec node --experimental-strip-types --test src/main/plugin-protocol.test.ts`; expect missing-symbol failure.
- [ ] Add data-only interfaces and fixed channel names `plugins:list/get/install/set-enabled/remove/reconcile`; no raw URL or filesystem path fields.
- [ ] Run the test and `pnpm --filter @codex-forge/protocol check`; expect pass.

### Task 2: Spring HTTP client and payload validation

**Files:**
- Create: `apps/desktop/src/main/plugin-repository-client.ts`
- Test: `apps/desktop/src/main/plugin-repository-client.test.ts`

- [ ] Write failing tests using a local Node HTTP server for catalog/detail/manifest/download/reconcile/report, auth headers, invalid JSON, non-2xx, same-origin enforcement, timeout and cancellation.
- [ ] Run the focused test and confirm missing-module failure.
- [ ] Implement `PluginRepositoryClient` with injected `fetch`, gateway origin, auth headers and bounded response sizes; parse external values from `unknown` and return normalized protocol objects.
- [ ] Re-run focused test and desktop typecheck.

### Task 3: Package verifier

**Files:**
- Create: `apps/desktop/src/main/plugin-package-verifier.ts`
- Test: `apps/desktop/src/main/plugin-package-verifier.test.ts`

- [ ] Write failing tests that generate Ed25519 keys and real ZIPs, covering valid package, SHA mismatch, signature mismatch, missing plugin manifest, absolute/parent/duplicate paths, excessive entries and extracted size.
- [ ] Run focused test and confirm missing-module failure.
- [ ] Implement bounded verification with Node crypto and JSZip; validate `.codex-plugin/plugin.json`, `skills/`, entry names, file count and total uncompressed bytes.
- [ ] Re-run focused test twice to prove deterministic behavior.

### Task 4: Atomic installation and recovery

**Files:**
- Create: `apps/desktop/src/main/plugin-installation-service.ts`
- Test: `apps/desktop/src/main/plugin-installation-service.test.ts`
- Reuse: `apps/desktop/src/main/atomic-file.ts`

- [ ] Write failing real-filesystem tests for first install, idempotent install, upgrade, failed upgrade preserving old version, enable/disable, remove, concurrent same-plugin serialization, corrupt state, stale staging cleanup and pending-report retry.
- [ ] Run focused test and confirm missing-module failure.
- [ ] Implement schema-versioned `installed.json`, per-plugin promise queues, staging extraction, atomic directory activation, local-first final state and stable operation IDs.
- [ ] Re-run focused test and desktop typecheck.

### Task 5: IPC and preload boundary

**Files:**
- Create: `apps/desktop/src/main/plugin-repository-ipc.ts`
- Test: `apps/desktop/src/main/plugin-repository-ipc.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`

- [ ] Write failing IPC tests for every operation, invalid input, unavailable auth and no generic channel exposure.
- [ ] Implement fixed handlers wired to existing auth state, gateway origin, device fingerprint and user-data plugin directory.
- [ ] Expose six typed preload functions and register handlers once with deterministic teardown.
- [ ] Run IPC tests, protocol check, desktop check and architecture check.

### Task 6: Renderer marketplace integration

**Files:**
- Modify: `apps/desktop/src/renderer/app/desktop-model.tsx`
- Modify: `apps/desktop/src/renderer/app/WorkspaceModules.tsx`
- Modify: `apps/desktop/src/renderer/styles.css`
- Test: `apps/desktop/src/renderer/app/plugin-marketplace.test.mjs`

- [ ] Write a failing renderer policy/source test for public/private tabs, server categories, install/update/enable/disable/remove actions, builtin merge and loading/empty/error states.
- [ ] Add plugin snapshot state and effect-based loading with cleanup; replace the static remote catalog while keeping builtin plugins immutable.
- [ ] Wire buttons only to typed preload operations and refresh normalized snapshots after mutations.
- [ ] Run renderer test, desktop check and production build.

### Task 7: Spring-NewBrain contract fixtures

**Files:**
- Create: `src/test/java/com/demo/tokensystem/controller/DesktopPluginNewbrainContractTest.java` in the Spring plugin worktree
- Create: `apps/desktop/scripts/plugin-repository-contract-server.mjs`
- Create: `apps/desktop/src/main/plugin-repository-contract.test.ts`

- [ ] Add Spring MockMvc assertions for catalog keys, manifest keys, ZIP headers and report payload acceptance.
- [ ] Add a Node contract server that emits only those fields, dynamically signs a real package and records report calls.
- [ ] Run a NewBrain end-to-end test for list -> install -> report -> update -> revoked reconciliation using temporary storage.
- [ ] Run Spring focused tests and NewBrain contract test.

### Task 8: Full quality gates

- [ ] Run NewBrain focused plugin tests, `pnpm check`, desktop production build and architecture check.
- [ ] Run Spring plugin tests, full `mvnw test`, package and Javadoc using the configured JDK.
- [ ] Run `git diff --check`, inspect stats, scan UTF-8 replacement characters and obvious secrets in both worktrees.
- [ ] Compare every design acceptance item with test evidence; record live MySQL/UI gates separately if unavailable.
