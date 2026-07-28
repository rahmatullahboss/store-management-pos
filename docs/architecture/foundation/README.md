# Foundation Architecture Baseline

## Runtime shape

- Cloudflare Worker API and jobs shells.
- Static admin and POS application shells with permission-filtered navigation.
- Canonical PostgreSQL in Neon.
- Direct `@neondatabase/serverless` HTTP for one-shot/preconstructed batches.
- Request-scoped WebSocket Client/Pool for dependent transactions.
- Transaction-local tenant, actor, scope, business-date, request and trace context.
- R2, Queue, Workflow, coordination and configuration-cache ports without making auxiliary storage canonical.

## Repository boundaries

`tooling/module-boundaries.json` assigns every workpack its paths, PostgreSQL schemas and dependency direction. `check-boundaries.mjs` rejects duplicate ownership, dependency cycles and private cross-module persistence imports.

## Database boundaries

Foundation owns `platform`. Each future module owns only its registered schema and migration prefix. The migration registry records deterministic Foundation ordering before module migrations.

## Security baseline

Tenant tables use forced RLS. The runtime role cannot mutate audit records or delete audit/outbox/inbox/idempotency history. Audit records are append-only; outbox event content is immutable after insertion. Session revocations are append-only and runtime writes are restricted to the audited function path. Secrets are environment-only.

## Reference slice

`POST /v1/platform/reference-records` proves authentication context, permission enforcement, request-scoped Neon transaction, RLS, idempotency, one Foundation record, append-only audit and transactional outbox. The jobs shell proves inbox-backed duplicate-safe consumption. It contains no catalog, stock, sales, payment or accounting business logic.
