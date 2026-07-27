# ADR-005: Direct Neon Serverless PostgreSQL from Cloudflare Workers

- **Status:** Accepted for implementation baseline; benchmark validation required
- **Date:** 2026-07-28
- **Supersedes:** ADR-001 only for database connectivity
- **Decision owners:** Product/Architecture

## Context

The canonical database remains PostgreSQL, but the selected managed provider is Neon Serverless Postgres. Cloudflare Workers can connect directly to Neon with `@neondatabase/serverless` over HTTP or WebSockets. Hyperdrive is therefore not a required dependency.

The platform needs both simple one-shot queries and complex transactional commands such as POS checkout, purchase receiving, stock costing and balanced journal posting.

## Decision

Use Neon Serverless PostgreSQL as the canonical transactional database and connect from Cloudflare Workers directly through `@neondatabase/serverless`.

Connection modes:

1. **HTTP query function** for one-shot reads, simple writes and non-interactive transaction batches.
2. **`Client` or `Pool` over WebSockets** for request-scoped interactive transactions where later SQL depends on earlier results.
3. **PostgreSQL stored functions/procedures** may be used for carefully reviewed atomic posting kernels when this materially reduces round trips and preserves module boundaries.
4. **Hyperdrive is optional**, retained only as a benchmark/fallback option if direct-driver latency, ORM compatibility or connection behavior is unacceptable in target regions.

## Transaction rules

- A `Client`/`Pool` is created, used and closed inside one Worker request.
- No database connection or session is reused across Worker invocations.
- Every business mutation is idempotent.
- Tenant/RLS context is set inside the same transaction that performs the command.
- Transactions remain short and do not wait for external payment, fiscal, email or shipping services.
- External calls use state machines, outbox events and recovery workflows.
- The HTTP `transaction()` API is used only when the complete query batch can be constructed safely before execution.
- Complex dependent checkout/posting logic uses a request-scoped WebSocket transaction or a reviewed database posting function.
- Raw SQL, query builders and ORMs must use parameterized queries and exact numeric handling.

## Neon branching decision

Every long-running module agent and every pull request receives an isolated Neon database branch.

Naming:

```text
dev/foundation-v1
dev/module-catalog-pricing-tax
dev/module-inventory-procurement
dev/module-customer-sales-fulfillment
dev/module-pos-cash-offline
dev/module-payments-accounting-banking
dev/module-localization-compliance
dev/module-reporting-integrations
preview/pr-<number>-<git-branch>
test/<module>-<commit>-<run>
```

Rules:

- Module branches are created from the approved foundation database branch.
- Agents never share one mutable development database.
- Production personal data is not copied into agent branches; use schema-only or approved synthetic/sanitized data.
- Each branch applies only its owned module migrations plus foundation migrations.
- PR CI creates an isolated preview branch, applies migrations, runs integration tests and deletes the branch when the PR closes.
- Database branch creation is not a substitute for migration review; production migrations remain forward-compatible and separately approved.

## Rationale

Direct Neon access removes an additional infrastructure dependency and uses a driver designed for serverless/edge environments. Neon database branching also aligns closely with parallel module-agent development by isolating schema and fixture changes.

Hyperdrive remains a valid alternative and may provide lower global connection latency, but it is not required for correctness or basic connectivity.

## Consequences

### Positive

- fewer baseline infrastructure components;
- direct Neon integration and serverless scaling;
- isolated database branches for agents, PRs and tests;
- full PostgreSQL relational, transaction and tooling capabilities;
- easier local/CI parity than D1-per-tenant architecture;
- Hyperdrive can still be introduced later without changing the domain model.

### Negative

- HTTP mode does not provide arbitrary interactive sessions;
- WebSocket connections cannot outlive one Worker request;
- global latency depends on Worker, Neon region, compute wake-up and chosen connection mode;
- ORM/query-library compatibility must be tested;
- connection/session limits and autosuspend behavior require monitoring;
- one home database region per tenant still creates geographic latency trade-offs.

## Required spikes

1. Benchmark HTTP one-shot query, HTTP transaction batch and WebSocket interactive transaction.
2. Complete a 20-line POS checkout with price, tax, FIFO stock, payment, journal and outbox effects.
3. Test RLS tenant context and connection cleanup under concurrency.
4. Test compute wake-up, cold latency and peak connection/session behavior.
5. Test failure during transaction, lost response and idempotent retry.
6. Test ORM/query-builder candidates in Workers.
7. Compare direct Neon with Hyperdrive from primary target regions before GA.
8. Test Neon branch creation, migration, preview cleanup and schema diff in CI.
9. Restore from Neon backup/history and reconcile stock/journal/outbox state.

## Guardrails

- Do not combine the Neon serverless driver with Hyperdrive in one connection path.
- Do not use Neon pooled and direct endpoints interchangeably without a documented reason.
- Do not place long-running external work inside a database transaction.
- Do not allow an agent branch to migrate shared foundation or another module's schema.
- Do not store production credentials in preview environments.
- Do not promise global write latency before regional benchmark evidence exists.

## Reconsider when

- direct-driver p95/p99 latency fails approved targets;
- WebSocket transaction behavior is unstable under the required concurrency;
- a required ORM/library is unsupported;
- Hyperdrive demonstrates material latency or operational benefit;
- regulation requires another database region/provider/deployment;
- a large customer requires dedicated infrastructure.

## Primary references

- https://neon.com/docs/serverless/serverless-driver
- https://github.com/neondatabase/serverless
- https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/
- https://neon.com/docs/get-started-with-neon/workflow-primer
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/

## Related documents

- `docs/05-SYSTEM-ARCHITECTURE.md`
- `docs/06-CLOUDFLARE-DECISION.md`
- `docs/13-TESTING-OBSERVABILITY-SRE.md`
- `docs/17-PARALLEL-AGENT-EXECUTION.md`
