# Backend Technical Design Framework

Use this framework for every new backend module and every material backend change. Complete the design before implementation, keep it aligned with the code, and do not omit a section. Write `N/A` plus a concrete reason when a section does not apply.

## 1. Project context

- State the business background, users, scenario, pain point, and system goal in 2-4 sentences.
- List exact backend framework, language, build tool, ORM, database, cache, message queue, validation, and test versions.
- Define in-scope and out-of-scope behavior and the default actor or permission perspective.

## 2. Layered backend structure

Use and document this baseline structure, adapting names by business module without collapsing responsibilities:

```text
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
```

Document each package's responsibility. Group large systems by business module while retaining the entity/DTO/VO/mapper/service/controller boundaries.

## 3. Database design

For every table, provide a field table containing name, SQL type and length, nullability/default, PK/UK/FK/check constraint, and business meaning. Explicitly design:

- primary and related tables;
- business identifiers and uniqueness strategy;
- status, `created_at`, and `updated_at` fields where applicable;
- indexes derived from real filtering, join, sorting, grouping, uniqueness, and pagination paths;
- foreign-key relationships or the documented reason for logical associations;
- history/audit records for important state transitions;
- `src/main/resources/init.sql` containing DDL, indexes, constraints, and idempotent baseline/admin seed data.

Explain migration and compatibility effects for changes to existing tables. Never use plaintext administrator passwords or production secrets.

Treat index design as mandatory for every persistence table. For each important query, record the predicate and ordering columns, proposed single-column or composite index, composite-column order, uniqueness, and expected benefit. Prefer equality columns before range/order columns when supported by the target database and query shape. Reuse primary-key and unique indexes where sufficient; do not add redundant indexes, blindly index every column, or index low-selectivity fields alone without evidence. Account for write amplification, storage, lock/build impact, and database-specific limits. Verify critical SQL with `EXPLAIN`, `EXPLAIN ANALYZE`, or the target database's equivalent, and revise indexes when the execution plan still performs an avoidable full scan or filesort. Add all accepted index DDL to `init.sql` or the versioned migration scripts.

## 4. RESTful API design

Define the unified response contract (`code`, `message`, `data`) and group endpoints by business resource. For every endpoint, specify:

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

For each message flow, define exchange/topic, routing key, payload schema/version, producer timing, consumer behavior, idempotency key, retry, dead-letter handling, ordering requirement, and observability. Mark cache or MQ `N/A` with a reason when unused.

## 7. Errors, security, and observability

Map validation errors to 400, missing resources to 404, authentication/authorization failures to 401/403, business conflicts to the documented 4xx status, and unexpected failures to 500 with a non-sensitive message. Use unified result codes and global exception handling.

Document authentication, authorization, input validation, sensitive-field handling, audit logging, request/trace IDs, key metrics, and required operational logs. Never leak stack traces, credentials, tokens, or internal SQL through APIs.

## 8. Test design and acceptance

Define JUnit 5/Mockito unit tests for core services and integration/API tests for all endpoints. Cover normal, negative, boundary, missing-resource, authorization, illegal-state, concurrency/idempotency, transaction rollback, and database initialization paths. Include:

- named test classes and key test methods;
- legal and illegal state-transition coverage;
- clean-database `init.sql` execution and initialized-admin authentication;
- API cases with input and expected status/body;
- an acceptance checklist and remaining unverified risks.

## 9. Implementation order

Implement in this order unless the design records a justified dependency-driven exception:

1. Database DDL, indexes, constraints, and seed data.
2. `entity` / `dto` / `vo`, then `mapper`, `service`, and `controller`.
3. Unified response, validation, global exception handling, security, and pagination configuration.
4. Backend unit and integration tests.
5. Middleware integration.
6. API/UI integration, regression testing, and defect repair.
7. Test evidence and delivery report.

## 10. Key design decisions

Record the chosen option, rejected alternatives, and reason for ORM, database, middleware, pagination, unique-ID generation, state-machine implementation, transaction/concurrency strategy, and other consequential algorithms. Base the reason on requirements, consistency, complexity, operability, testability, and team constraints rather than preference alone.

## Completion gate

Do not call the backend design or implementation complete until the design document matches the delivered code, `init.sql` supports a clean environment, DTO/VO and mapper boundaries are respected, required tests pass, and every framework section is either completed or explicitly marked `N/A` with justification.
