---
name: tmp-project-manager
description: Always-on Project OS + preference shadow for this workspace. Own PAHF personalization under .codecn; durable architecture lives in repo-root CODECN.md. When coding (especially Java/Spring), enforce seeded programming guardrails, Javadoc, encoding, and backend design references.
metadata:
  short-description: Project OS, preferences, and coding guardrails
---

# tmp Project Manager

This skill is the always-on shadow for tmp. It combines Claude Code–style **Project OS** (repo-root `CODECN.md`) with a Hermes/PAHF **personalization** loop (runtime-managed preference files) and seeded **programming guardrails** for reliable code edits.

## Project OS (repo layer)

1. Durable project truth lives in repo-root `CODECN.md` (also honor `CLAUDE.md` / `AGENTS.md` if present and `CODECN.md` is empty).
2. When architecture, build/test commands, directory layout, or lasting conventions change, **update `CODECN.md` with workspace tools**.
3. You may edit `CODECN.md`, `docs/**`, and normal project source files.
4. Do **not** use tools to create or edit `.codecn`, `.codebuddy`, skill `references/`, memory, or session-summary files — the runtime owns those after each turn.

## Required Workflow (PAHF)

1. The CodeCN runtime injects preference references (`user-output-rules`, open questions) and Project OS text into context.
2. **Pre-Action Clarification**: If the request is ambiguous or subjective AND preference memory does not answer it, ask ONE clarifying question BEFORE editing, generating, or committing.
3. **Preference Grounding**: Apply injected user rules and `CODECN.md`. Once a preference exists, act directly and do not re-ask.
4. **Post-Action Learning**: When the user corrects you or answers a learning question, state the durable preference clearly; the runtime distills it into references. Do not wait for "记住/以后".
5. Do not call tools merely to re-read injected preference references.
6. Ask at most one preference question per turn. Prefer completing the task when memory already covers the ambiguity.

## Programming Guardrails (coding)

When the user request edits, generates, completes, or documents source code—especially Java/Spring on Windows—follow the seeded programming-skill pack:

1. Read and enforce `references/programming-guardrails.md` (core rules, encoding, patch strategy, recovery, real-fix evaluation).
2. When touching any `.java` file, also enforce `references/java-javadoc-rules.md`. Missing required method Javadoc in a touched type means the change is incomplete.
3. Before designing or implementing Spring/backend modules, follow `references/backend-technical-design-framework.md`; mark unused sections `N/A` with a concrete reason.
4. Prefer smallest safe patches; preserve UTF-8 without BOM; never claim a coding fix complete without stating verified vs unverified evidence.

## Runtime knowledge files (do not edit with tools)

- `references/user-output-rules.md`: distilled habits, preferences, and corrections.
- `references/learning-open-questions.md`: open preference questions to ask before acting.
- `references/session-digest.md`: append-only session summaries.
- `references/project-knowledge.md`: short CODECN.md candidate index only (not the architecture source of truth).
- `references/programming-guardrails.md`: coding reliability, encoding, Java safety, Spring structure, patch/recovery, evaluation.
- `references/java-javadoc-rules.md`: mandatory Java method Javadoc rules.
- `references/backend-technical-design-framework.md`: mandatory Spring/backend design sections.
