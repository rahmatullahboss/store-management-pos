# FOUNDATION: Platform and Contract Baseline

## Assignment

One foundation agent owns this entire workpack. Do not split it among infrastructure, database, identity, frontend or testing agents. No business-module agent starts until this workpack passes its completion gate.

## Branch allocation

```text
Git branch:   program/foundation-v1
Worktree:     .worktrees/foundation-v1
Neon branch:  dev/foundation-v1
```

## Mission

Create the production-grade shared platform, module contracts and development isolation required for seven large module agents to work concurrently without editing the same files or database schemas.

## Owned paths

```text
apps/api/**
apps/admin-web/src/app-shell/**
apps/pos-web/src/app-shell/**
apps/worker-jobs/**
packages/foundation/**
packages/contracts/**
packages/ui/**
packages/testing/**
database/foundation/**
tooling/**
.github/**
docs/contracts/**
docs/architecture/foundation/**
```

Top-level composition and configuration remain foundation/integrator owned after handoff.

## Complete scope

### Repository and module boundaries

- initialize Git, monorepo, package manager and workspace layout;
- establish module directory ownership and import boundaries;
- add architecture tests that reject cyclic and private cross-module imports;
- define formatting, linting, typing, build and test commands;
- establish environment configuration and secret handling;
- add contributor, commit and migration conventions.

### Cloudflare application platform

- Workers API shell and regional/tenant request context;
- static/admin/POS application shells;
- R2, Queues, Workflows, Durable Objects and KV adapters;
- feature flags, entitlements and safe configuration cache;
- request IDs, structured errors, rate-limit hooks and tracing;
- local, development, preview, staging and production configuration.

### Neon database platform

- direct `@neondatabase/serverless` connection adapter;
- HTTP one-shot and transaction-batch helper;
- request-scoped WebSocket `Client`/`Pool` transaction helper;
- explicit connection cleanup and timeout behavior;
- tenant/RLS transaction context;
- migration registry with foundation and per-module sequences;
- module PostgreSQL schema ownership;
- development seed and synthetic fixture framework;
- Neon branch create/delete/schema-diff automation for PRs and tests;
- backup/restore and database-health hooks.

### Shared domain primitives

- UUIDv7/opaque IDs;
- TenantId, LegalEntityId, StoreId, WarehouseId and RegisterId;
- exact Money, Currency, Quantity and Unit types;
- IANA timezone, BCP 47 locale and immutable BusinessDate snapshot;
- actor, device, approval and audit metadata;
- version/ETag and optimistic concurrency;
- idempotency request/result store;
- pagination, filtering and error contracts.

### Platform business foundation

- tenant provisioning and region assignment;
- legal entity/store/warehouse/register master primitives;
- users, memberships, roles, permissions and scoped access;
- approval request/action framework;
- append-only audit/security event framework;
- device/register enrollment and revocation;
- plan/entitlement baseline;
- support impersonation controls.

### Contract pack v1

Publish typed schemas and fixtures for:

- catalog item/variant references;
- price/tax calculation request and immutable result snapshot;
- stock availability, reservation and posting requests;
- customer and sales document references;
- payment intent, payment status and refund requests;
- accounting posting instruction/result;
- receipt/fiscal document model;
- domain event/outbox/inbox envelope;
- file/import/export job references;
- module health and reconciliation result.

### Event and job platform

- transactional outbox and consumer inbox;
- at-least-once idempotent event handler base;
- dead-letter/replay records;
- Workflow job state and correlation;
- signed webhook primitives;
- module event-schema validation and test fixtures.

### Shared UI foundation

- accessible design-system primitives;
- app shell, navigation, route permissions and error states;
- form, table, filter, pagination and audit-history components;
- locale/RTL/theme foundations;
- shared Money, date/time, quantity and status rendering;
- API client and query/mutation conventions;
- offline-aware POS shell without implementing checkout business logic.

### Quality, security and operations

- real PostgreSQL integration-test harness using isolated Neon branches;
- unit, property, contract and end-to-end test structure;
- tenant-isolation tests;
- dependency, secret, vulnerability and license scans;
- SBOM and third-party notice generation;
- OpenTelemetry-compatible tracing/metrics/logging;
- CI preview deployment and database branch lifecycle;
- release/canary/rollback skeleton;
- production access and migration role separation.

## Reference vertical slice

Implement one thin disposable/reference flow only to prove infrastructure:

```text
authenticated tenant command
 -> request-scoped Neon transaction
 -> tenant/RLS enforcement
 -> one foundation-owned record
 -> audit event
 -> outbox event
 -> queue consumer fixture
 -> admin shell readback
```

This slice must not become a shortcut implementation of any business module.

## Required benchmarks

- direct Neon HTTP read/write latency;
- HTTP non-interactive transaction batch;
- request-scoped WebSocket interactive transaction;
- tenant/RLS concurrency and connection cleanup;
- Neon cold compute wake-up;
- module migration against isolated branch;
- outbox publication and duplicate consumer replay;
- Cloudflare Worker bundle, CPU and memory baseline.

## Prohibited work

- no full catalog, stock, sales, POS, payment or accounting implementation;
- no module-owned table outside `platform`/foundation schemas;
- no provider-specific business logic;
- no production data in preview branches;
- no GPL/AGPL/custom-license code;
- no microservice split;
- no unversioned shared contract.

## Completion gate

The workpack is complete only when:

1. All owned capabilities above are implemented and documented.
2. Foundation migrations run on a fresh Neon branch.
3. Neon HTTP and WebSocket modes pass failure/concurrency tests.
4. Tenant isolation is enforced at API and database levels.
5. Seven module path/schema ownership rules are machine-enforced.
6. Contract pack v1 is published with schemas, fixtures and compatibility policy.
7. PR CI creates and deletes isolated Neon branches.
8. Audit, outbox, inbox and idempotency primitives pass duplicate/retry tests.
9. Shared UI shells build and enforce route permissions.
10. Security, dependency, license and SBOM checks pass.
11. Foundation benchmark and architecture reports are committed.
12. `program-board.yaml` marks FOUNDATION complete and MOD-A through MOD-G ready.
13. Final handoff is written to `docs/agent-handoffs/FOUNDATION-handoff.md`.
