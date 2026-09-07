# Programming Guardrails

Use these rules for general code-change work when reliability matters more than speed.
Adapted from the codeCN programming-skill pack for always-on project context.

## Core Rules

1. Prefer small, local edits over whole-file rewrites.
2. Use patch-style edits whenever possible so unrelated code is less likely to break.
3. Before editing, inspect the target file's local structure instead of assuming clean encoding or formatting.
4. After editing, sanity-check that imports, braces, method boundaries, and class structure still line up.
5. Do not guess when behavior is unclear or contradicts expectations; inspect direct evidence first, such as actual HTTP responses, rendered HTML, logs, file bytes, or running process state.
6. When behavior must match an existing local runtime or tool, inspect that installation and reuse verified contracts; do not invent compatible-looking behavior from UI appearance or memory alone. If evidence is missing, report the gap.
7. After every code modification, perform an explicit evaluation before final response: what was implemented, what evidence was checked, what commands/tests/builds ran, and what remains unverified.

## Encoding Rules

1. On Windows, preserve UTF-8 without BOM unless the file already clearly requires BOM.
2. Treat UTF-8 as mandatory for repository source, config, Markdown, JSON, TypeScript, JavaScript, CSS, HTML, Java, and script files unless the file itself proves otherwise.
3. Avoid PowerShell default text writes for source edits. Do not use `Set-Content`, `Out-File`, `>` redirection, or ad-hoc script rewrites unless the command explicitly writes UTF-8 without BOM and preserves existing line endings where practical.
4. Prefer workspace patch/edit tools for small edits. If a bulk rewrite is unavoidable, use a UTF-8-aware API, then verify representative non-ASCII text did not become mojibake or `???`.
5. Before and after editing files that contain Chinese or other non-ASCII text, inspect exact text with a UTF-8-aware reader; do not trust a PowerShell console rendering alone.
6. Be especially careful with Java files: a UTF-8 BOM can trigger `illegal character: '\ufeff'`.
7. If a file may have been rewritten by a tool or script, verify the first bytes before concluding the code itself is broken.
8. If compilation suddenly fails with many `class, interface, enum, or record expected` errors after an edit, first check encoding damage or accidental structural corruption near the edited area.

## Java Safety Checks

When editing or generating any `.java` file, read and enforce `java-javadoc-rules.md` in this references folder. Treat missing required method Javadoc in every touched class as an incomplete change.

1. Never overwrite a request-specified runtime field with a config default unless the task explicitly requires fallback behavior.
2. When moving variables used by both `try` and `catch`, define them outside the `try` block.
3. If a Java file contains garbled text or unstable strings, avoid broad search-and-replace across the whole file; patch only the exact logic needed.
4. After touching controller or service methods, verify signatures, helper methods, and return types still match call sites.

## Spring Backend Structure

Before designing or implementing a Spring backend, read and follow `backend-technical-design-framework.md` in this references folder. Treat every listed section as mandatory; mark an item `N/A` with a concrete reason instead of silently omitting it.

1. Put database CRUD and query operations in `mapper`; do not implement direct table access in controllers or scatter SQL/JDBC calls through services.
2. Keep persistence entities separate from API models. Use `dto` for request/command/service-boundary data and `vo` for response/view data. Do not expose database entities directly unless the project already standardizes that contract.
3. Put reusable utilities in `common` (or focused subpackages), shared constants in a dedicated constants package/class, and cross-cutting reusable behavior in common components.
4. When adding persistence-backed features, create or update `src/main/resources/init.sql` with required table DDL, indexes, constraints, and baseline data, including an initial administrator when required.
5. Make initialization safe to run repeatedly where the database permits it. Seed baseline records idempotently, store passwords only as hashes compatible with the application's password encoder, and never commit real credentials or production secrets.
6. Ensure the application actually executes `init.sql` in the supported runtime/profile, and verify a clean database can start, load schema/baseline data, and authenticate the initialized administrator.
7. Design indexes from actual query predicates, joins, sorting, grouping, uniqueness, and pagination paths; include index DDL in `init.sql` or migrations, and verify critical queries with `EXPLAIN` (or equivalent) before calling the work complete.

## Patch Strategy

1. Start with the smallest possible patch.
2. Avoid large replacement operations in files that already contain mojibake, mixed encodings, or generated text.
3. If a normal patch repeatedly fails because the file content is unstable, pause and verify the exact local text before retrying.
4. Only use full-block replacement as a last resort, and re-check encoding immediately afterward.

## Recovery Rules

1. If your own edit causes a build break, fix the workspace first before adding more feature work.
2. If an edit path proves fragile, switch to a safer method rather than forcing the same approach again.
3. When the failure is caused by editing technique rather than business logic, record the guardrail so it is not repeated.

## Post-Change Evaluation

1. For every changed-code task, include a short real-fix evaluation in the final answer.
2. Distinguish: implemented in code / verified by automated checks / verified by runtime or UI observation / not verified or still incomplete.
3. If no runtime or UI verification was possible, say that clearly instead of rating the fix as fully complete.
4. If the user asks whether a feature was "真实修复" or "按要求实现", answer strictly from evidence and list any gaps.
