# BRAIN Product Platform Design

The authoritative product and technical design is [BRAIN Product Architecture](../architecture/brain-product-architecture.md). This specification fixes the approved scope and adds acceptance rules for implementation.

## Acceptance rules

1. The left navigation exposes six workspace families without replacing the central conversation UI.
2. Project and conversation catalogs are workspace-scoped; file access remains project-scoped and reusable by every workspace.
3. Company model and search keys never enter BRAIN.
4. User BYOK is write-only and stored only by an approved OS credential backend.
5. BRAIN can read, render, annotate, revise, and export every format in the document capability matrix.
6. Rust Core remains a BRAIN sidecar with a versioned, cancellable, resource-bounded protocol.
7. Quant workflows include real historical bars, charts, simulated portfolios, scheduled strategy skills, and per-skill performance.
8. Free news sources precede paid web search; current claims include sources and search time.
9. Windows, macOS, Ubuntu x64, and Ubuntu arm64 are not considered delivered until their platform-specific package and runtime gates pass.
10. Every milestone ships tests, failure handling, recovery evidence, and an isolated Git commit.

## Decomposition

The product is implemented as independently testable programs rather than one large feature branch:

- foundation and credential security;
- Rust Core protocol and process lifecycle;
- shared workspace shell and catalog scoping;
- document read/render/annotation/revision pipeline;
- quantitative market data, simulation, charts, and strategy skills;
- game workspace;
- video workspace;
- music workspace;
- data and decision workspace;
- software and automation workspace;
- server search/model policy integration;
- packaging, upgrade, observability, and recovery.

Each program must preserve the boundaries in the authoritative architecture. A later program may depend on an earlier stable contract, but it must not bypass it.
