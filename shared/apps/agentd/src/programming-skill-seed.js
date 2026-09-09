import path from "node:path";

/**
 * Seed content adapted from ~/.codex/skills/programming-skill.
 * Written into each project's always-on *-project-manager/references on init/upgrade.
 */

export const PROGRAMMING_GUARDRAILS_FILENAME = "programming-guardrails.md";
export const JAVA_JAVADOC_RULES_FILENAME = "java-javadoc-rules.md";
export const BACKEND_DESIGN_FRAMEWORK_FILENAME = "backend-technical-design-framework.md";

/** Marker used by ensureProjectSkill to detect an outdated project-manager SKILL.md. */
export const PROGRAMMING_SKILL_TEMPLATE_MARKER = "Programming Guardrails (coding)";

export const PROGRAMMING_GUARDRAILS_MARKDOWN = `# Programming Guardrails

Use these rules for general code-change work when reliability matters more than speed.
Adapted from the NewBrain programming-skill pack for always-on project context.

## Core Rules

1. Prefer small, local edits over whole-file rewrites.
2. Use patch-style edits whenever possible so unrelated code is less likely to break.
3. Before editing, inspect the target file's local structure instead of assuming clean encoding or formatting.
4. After editing, sanity-check that imports, braces, method boundaries, and class structure still line up.
5. Do not guess when behavior is unclear or contradicts expectations; inspect direct evidence first, such as actual HTTP responses, rendered HTML, logs, file bytes, or running process state.
6. When behavior must match an existing local runtime or tool, inspect that installation and reuse verified contracts; do not invent compatible-looking behavior from UI appearance or memory alone. If evidence is missing, report the gap.
7. After every code modification, perform an explicit evaluation before final response: what was implemented, what evidence was checked, what commands/tests/builds ran, and what remains unverified.

## Workspace Retrieval (platform tools)

Global and project Skills do **not** replace these built-in tools. Use them on Windows, macOS, and Ubuntu alike:

1. Find files: \`workspace.glob\` (alias \`glob\`) with \`pattern\` / optional \`path\` / \`namePattern\`.
2. Search contents: \`workspace.grep\` (alias \`grep\`) with \`pattern\` / optional \`path\` / \`glob\` / \`context\`.
3. Read files: \`workspace.read\` (alias \`read\`) with optional \`offset\` / \`limit\`. Prefer this over shell \`Get-Content\` / \`cat\` / \`type\`.
4. Shallow listing only: \`workspace.scan\` when you need a directory overview.
5. Do **not** use \`shell.exec\` for ordinary recursive code search (\`Get-ChildItem -Recurse\`, \`Select-String -Recurse\`, \`grep -r\`, \`find\` without \`-maxdepth\`, \`ls -R\`). Those can OOM the tool host; the built-in tools already ignore \`node_modules\`/\`.git\`/\`venv\` and cap depth/hits.

## Encoding Rules

1. On Windows, preserve UTF-8 without BOM unless the file already clearly requires BOM.
2. Treat UTF-8 as mandatory for repository source, config, Markdown, JSON, TypeScript, JavaScript, CSS, HTML, Java, and script files unless the file itself proves otherwise.
3. Avoid PowerShell default text writes for source edits. Do not use \`Set-Content\`, \`Out-File\`, \`>\` redirection, or ad-hoc script rewrites unless the command explicitly writes UTF-8 without BOM and preserves existing line endings where practical.
4. Prefer workspace patch/edit tools for small edits. If a bulk rewrite is unavoidable, use a UTF-8-aware API, then verify representative non-ASCII text did not become mojibake or \`???\`.
5. Before and after editing files that contain Chinese or other non-ASCII text, inspect exact text with a UTF-8-aware reader; do not trust a PowerShell console rendering alone.
6. Be especially careful with Java files: a UTF-8 BOM can trigger \`illegal character: '\\ufeff'\`.
7. If a file may have been rewritten by a tool or script, verify the first bytes before concluding the code itself is broken.
8. If compilation suddenly fails with many \`class, interface, enum, or record expected\` errors after an edit, first check encoding damage or accidental structural corruption near the edited area.

## Java Safety Checks

When editing or generating any \`.java\` file, read and enforce \`java-javadoc-rules.md\` in this references folder. Treat missing required method Javadoc in every touched class as an incomplete change.

1. Never overwrite a request-specified runtime field with a config default unless the task explicitly requires fallback behavior.
2. When moving variables used by both \`try\` and \`catch\`, define them outside the \`try\` block.
3. If a Java file contains garbled text or unstable strings, avoid broad search-and-replace across the whole file; patch only the exact logic needed.
4. After touching controller or service methods, verify signatures, helper methods, and return types still match call sites.

## Spring Backend Structure

Before designing or implementing a Spring backend, read and follow \`backend-technical-design-framework.md\` in this references folder. Treat every listed section as mandatory; mark an item \`N/A\` with a concrete reason instead of silently omitting it.

1. Put database CRUD and query operations in \`mapper\`; do not implement direct table access in controllers or scatter SQL/JDBC calls through services.
2. Keep persistence entities separate from API models. Use \`dto\` for request/command/service-boundary data and \`vo\` for response/view data. Do not expose database entities directly unless the project already standardizes that contract.
3. Put reusable utilities in \`common\` (or focused subpackages), shared constants in a dedicated constants package/class, and cross-cutting reusable behavior in common components.
4. When adding persistence-backed features, create or update \`src/main/resources/init.sql\` with required table DDL, indexes, constraints, and baseline data, including an initial administrator when required.
5. Make initialization safe to run repeatedly where the database permits it. Seed baseline records idempotently, store passwords only as hashes compatible with the application's password encoder, and never commit real credentials or production secrets.
6. Ensure the application actually executes \`init.sql\` in the supported runtime/profile, and verify a clean database can start, load schema/baseline data, and authenticate the initialized administrator.
7. Design indexes from actual query predicates, joins, sorting, grouping, uniqueness, and pagination paths; include index DDL in \`init.sql\` or migrations, and verify critical queries with \`EXPLAIN\` (or equivalent) before calling the work complete.

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
`;

export const JAVA_JAVADOC_RULES_MARKDOWN = `# Java Javadoc Mandatory Rules

Apply these rules automatically whenever editing a \`.java\` file, adding or refactoring a method, adding an interface or abstract method, generating documentation through \`/doc\`, or completing Java code with AI.

## Required workflow

1. Before finishing a Java change, scan every method in each touched class or interface for missing Javadoc.
2. Add compliant Javadoc to every undocumented method in the touched type, including public, protected, package-private, private, static, interface, abstract, and default methods. Do not limit the scan to newly added methods.
3. Update existing Javadoc when a refactor changes parameters, return semantics, exceptions, side effects, constraints, or business behavior.
4. Keep comments specific to the implementation contract. Do not add empty, tautological, copied, or misleading text merely to satisfy the format.
5. Preserve generated-code boundaries. Do not edit generated Java sources; document the owning source/schema or exclude the generated directory with a recorded reason.

## Mandatory method template

Use valid standard Javadoc syntax. Do not prefix prose or tags with Markdown list markers.

\`\`\`java
/**
 * 【方法中文功能简述】一句话说明该方法的核心业务作用。
 *
 * <p>详细说明：复杂逻辑、业务场景、特殊限制、副作用和异常场景。
 * 简单方法可以省略本段。</p>
 *
 * @param parameterName 参数含义、入参约束以及允许或不允许的值
 * @return 返回值的业务含义；返回类型为 void 时省略此标签
 * @throws ExceptionType 抛出该异常的明确触发条件
 * @author Developer Name
 * @date yyyy-MM-dd
 */
\`\`\`

## Tag rules

- Write the opening Chinese summary for every method and describe the business purpose, not merely the Java operation.
- Add one \`@param\` for every declared parameter, in declaration order. State meaning, nullability, range, format, allowed values, and other meaningful constraints.
- Add \`@return\` for every non-\`void\` method. Explain semantics, nullability, collection contents, empty-result behavior, or status meaning where relevant. Omit it only for \`void\`.
- Add \`@throws\` for every checked exception and every explicitly declared or intentionally propagated business/runtime exception whose trigger is part of the method contract. Do not invent exceptions that the method cannot throw.
- Resolve \`@author\` from the repository/team convention or configured developer identity (for example \`git config user.name\`). Do not invent a personal name. If no identity is available, use the project-approved generic author; otherwise request it before finalizing a persistent team artifact.
- Set \`@date\` to the actual creation/update date in \`yyyy-MM-dd\` format. When materially changing a method contract, refresh the date according to the repository convention.
- For overridden methods, use \`{@inheritDoc}\` only when the inherited documentation fully describes the implementation contract. Add implementation-specific constraints, side effects, or exceptions when they differ.
- For getters, setters, constructors, record accessors, and trivial delegation methods, keep the description concise but still provide all applicable mandatory tags unless the repository explicitly excludes generated/boilerplate methods.

## Completion check

Do not report a Java task complete until every touched Java type has been scanned, all methods have compliant Javadoc, tag names match actual parameters and exceptions, non-\`void\` methods have \`@return\`, \`void\` methods do not, and compilation/Javadoc validation has been run where available.
`;

export const BACKEND_DESIGN_FRAMEWORK_MARKDOWN = `# Backend Technical Design Framework

Use this framework for every new backend module and every material backend change. Complete the design before implementation, keep it aligned with the code, and do not omit a section. Write \`N/A\` plus a concrete reason when a section does not apply.

## 1. Project context

- State the business background, users, scenario, pain point, and system goal in 2-4 sentences.
- List exact backend framework, language, build tool, ORM, database, cache, message queue, validation, and test versions.
- Define in-scope and out-of-scope behavior and the default actor or permission perspective.

## 2. Layered backend structure

Use and document this baseline structure, adapting names by business module without collapsing responsibilities:

\`\`\`text
src/main/java/<base-package>/
├── <Application>.java
├── common/
│   ├── Result.java
│   ├── ResultCode.java
│   └── GlobalExceptionHandler.java
├── config/
├── entity/
├── dto/
├── vo/
├── mapper/
├── service/
│   └── impl/
├── controller/
└── mq/                 # optional
\`\`\`

Document each package's responsibility. Group large systems by business module while retaining the entity/DTO/VO/mapper/service/controller boundaries.

## 3. Database design

For every table, provide a field table containing name, SQL type and length, nullability/default, PK/UK/FK/check constraint, and business meaning. Explicitly design:

- primary and related tables;
- business identifiers and uniqueness strategy;
- status, \`created_at\`, and \`updated_at\` fields where applicable;
- indexes derived from real filtering, join, sorting, grouping, uniqueness, and pagination paths;
- foreign-key relationships or the documented reason for logical associations;
- history/audit records for important state transitions;
- \`src/main/resources/init.sql\` containing DDL, indexes, constraints, and idempotent baseline/admin seed data.

Explain migration and compatibility effects for changes to existing tables. Never use plaintext administrator passwords or production secrets.

Treat index design as mandatory for every persistence table. For each important query, record the predicate and ordering columns, proposed single-column or composite index, composite-column order, uniqueness, and expected benefit. Prefer equality columns before range/order columns when supported by the target database and query shape. Reuse primary-key and unique indexes where sufficient; do not add redundant indexes, blindly index every column, or index low-selectivity fields alone without evidence. Account for write amplification, storage, lock/build impact, and database-specific limits. Verify critical SQL with \`EXPLAIN\`, \`EXPLAIN ANALYZE\`, or the target database's equivalent, and revise indexes when the execution plan still performs an avoidable full scan or filesort. Add all accepted index DDL to \`init.sql\` or the versioned migration scripts.

## 4. RESTful API design

Define the unified response contract (\`code\`, \`message\`, \`data\`) and group endpoints by business resource. For every endpoint, specify:

- HTTP method and path;
- purpose and authorization boundary;
- path, query, and request DTO fields with validation rules;
- response VO and pagination contract;
- success status and business/error responses;
- idempotency and concurrency behavior for write operations.

Cover create, paginated query, detail, update, delete/cancel, statistics, and domain actions when applicable. Do not expose persistence entities as request or response contracts.

## 5. Core business logic

- Define state values, legal transitions, forbidden transitions, preconditions, operator, side effects, and history records as an explicit state machine.
- Describe each key algorithm or rule as ordered steps: input/precondition, lookup, comparison/calculation, failure condition, result, and additional validation.
- Define business-number or unique-ID format, example, collision prevention, concurrency behavior, and selected generator (database sequence, Redis INCR, snowflake, or equivalent).
- State transaction boundaries, locking/optimistic-version strategy, retry rules, and rollback behavior for multi-write operations.

## 6. Middleware design

For each cache, define content, key format, TTL, invalidation timing, consistency strategy, penetration/breakdown/avalanche protection, and fallback. Prefer Cache-Aside when suitable: read cache then DB and backfill; commit DB changes before cache invalidation. Do not mix Redis deletion into an uncommitted database transaction without a consistency design.

For each message flow, define exchange/topic, routing key, payload schema/version, producer timing, consumer behavior, idempotency key, retry, dead-letter handling, ordering requirement, and observability. Mark cache or MQ \`N/A\` with a reason when unused.

## 7. Errors, security, and observability

Map validation errors to 400, missing resources to 404, authentication/authorization failures to 401/403, business conflicts to the documented 4xx status, and unexpected failures to 500 with a non-sensitive message. Use unified result codes and global exception handling.

Document authentication, authorization, input validation, sensitive-field handling, audit logging, request/trace IDs, key metrics, and required operational logs. Never leak stack traces, credentials, tokens, or internal SQL through APIs.

## 8. Test design and acceptance

Define JUnit 5/Mockito unit tests for core services and integration/API tests for all endpoints. Cover normal, negative, boundary, missing-resource, authorization, illegal-state, concurrency/idempotency, transaction rollback, and database initialization paths. Include:

- named test classes and key test methods;
- legal and illegal state-transition coverage;
- clean-database \`init.sql\` execution and initialized-admin authentication;
- API cases with input and expected status/body;
- an acceptance checklist and remaining unverified risks.

## 9. Implementation order

Implement in this order unless the design records a justified dependency-driven exception:

1. Database DDL, indexes, constraints, and seed data.
2. \`entity\` / \`dto\` / \`vo\`, then \`mapper\`, \`service\`, and \`controller\`.
3. Unified response, validation, global exception handling, security, and pagination configuration.
4. Backend unit and integration tests.
5. Middleware integration.
6. API/UI integration, regression testing, and defect repair.
7. Test evidence and delivery report.

## 10. Key design decisions

Record the chosen option, rejected alternatives, and reason for ORM, database, middleware, pagination, unique-ID generation, state-machine implementation, transaction/concurrency strategy, and other consequential algorithms. Base the reason on requirements, consistency, complexity, operability, testability, and team constraints rather than preference alone.

## Completion gate

Do not call the backend design or implementation complete until the design document matches the delivered code, \`init.sql\` supports a clean environment, DTO/VO and mapper boundaries are respected, required tests pass, and every framework section is either completed or explicitly marked \`N/A\` with justification.
`;

/** Writes/updates programming-skill reference files under a project-manager references directory. */
export async function ensureProgrammingSkillReferences(referencesPath, writeFile, mkdir) {
  await mkdir(referencesPath, { recursive: true });
  const files = [
    [PROGRAMMING_GUARDRAILS_FILENAME, PROGRAMMING_GUARDRAILS_MARKDOWN],
    [JAVA_JAVADOC_RULES_FILENAME, JAVA_JAVADOC_RULES_MARKDOWN],
    [BACKEND_DESIGN_FRAMEWORK_FILENAME, BACKEND_DESIGN_FRAMEWORK_MARKDOWN]
  ];
  for (const [name, content] of files) {
    await writeFile(path.join(referencesPath, name), content, "utf8");
  }
  return files.map(([name]) => name);
}
