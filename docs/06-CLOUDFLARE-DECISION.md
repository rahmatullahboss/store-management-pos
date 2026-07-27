# Cloudflare and Neon Architecture Decision

## Decision

Adopt a **Cloudflare-first application stack with direct Neon Serverless PostgreSQL**:

- Cloudflare Workers for API compute, BFF and edge routing.
- Cloudflare Static Assets/Pages/CDN/WAF for web and POS delivery.
- Neon Serverless PostgreSQL as the canonical transactional database.
- `@neondatabase/serverless` as the baseline Workers-to-Neon driver.
- HTTP for one-shot queries and non-interactive transaction batches.
- Request-scoped WebSocket `Client`/`Pool` for interactive transactions.
- Neon database branches for module agents, pull requests and isolated tests.
- Durable Objects for narrow serialized coordination.
- Queues and Workflows for asynchronous/durable execution.
- R2 for objects, media, legal documents, imports and exports.
- D1/KV for bounded auxiliary data and safe caches, not canonical accounting/inventory.
- Hyperdrive is optional and benchmark-only, not required in the baseline.

Decision status: **Accepted for implementation baseline; validate through architecture spikes before production commitment.**

## 1. Why this combination

Cloudflare provides:

- globally distributed request handling and static delivery;
- low-operations Workers deployment;
- WAF, DDoS, bot and rate controls;
- R2, Queues, Workflows and Durable Objects close to the application runtime;
- custom-domain and SaaS edge patterns.

Neon provides:

- fully managed serverless PostgreSQL;
- standard PostgreSQL transactions, constraints and tooling;
- storage/compute separation and autoscaling behavior;
- an HTTP/WebSocket driver designed for serverless/edge runtimes;
- isolated copy-on-write database branches for development and previews;
- PostgreSQL portability compared with a D1-only domain model.

Together they preserve a globally distributed application edge and a mature relational source of truth.

## 2. Direct Neon connection modes

### HTTP query mode

Use the Neon query function for:

- simple reads;
- independent writes;
- one-shot API operations;
- preconstructed non-interactive transaction batches;
- lightweight projection and job queries.

Advantages:

- low connection overhead;
- SQL transported over HTTPS;
- simple Worker lifecycle;
- suitable for operations that do not require a persistent session.

Limitations:

- arbitrary interactive sessions are unavailable;
- later queries cannot depend on runtime results from earlier statements unless the complete operation is expressed as one SQL statement, a preconstructed batch or a database function.

### WebSocket `Client`/`Pool` mode

Use request-scoped WebSockets for:

- POS checkout with dependent validation/posting steps;
- purchase receiving and costing;
- returns/refunds with original-allocation lookup;
- accounting period/posting commands;
- operations requiring explicit `BEGIN`, row locks and multiple dependent queries.

Rules:

- create the client inside the Worker request;
- connect, execute, commit/rollback and close within the same request;
- never keep it in global state for reuse across invocations;
- set tenant/RLS context inside the transaction;
- keep transactions short and free of external network waits;
- set query/lock/statement timeouts;
- use idempotency keys and recover lost responses safely.

### Stored posting functions

A reviewed PostgreSQL function may implement a narrow atomic posting kernel when it:

- materially reduces round trips;
- preserves clear module ownership;
- remains testable and migration-controlled;
- returns an explicit posting result;
- does not hide broad business orchestration in the database.

Do not move the whole application into stored procedures.

## 3. Hyperdrive position

Hyperdrive is **not required** because Neon supports direct Workers access through its serverless driver.

Keep Hyperdrive as an optional comparison/fallback because Cloudflare currently recommends it for lowest possible global connection latency and broad native-driver/ORM compatibility.

If evaluated:

- use standard PostgreSQL drivers such as `pg` or Postgres.js through Hyperdrive;
- do not combine Hyperdrive and `@neondatabase/serverless` on the same connection path;
- do not place Neon pooling behind Hyperdrive pooling without a measured reason;
- compare p50/p95/p99 latency, connection behavior, cost and failure recovery;
- disable or strictly govern query caching for authorization, stock, payment and finance reads.

No production dependency on Hyperdrive is introduced unless a later ADR records benchmark evidence.

## 4. Neon branch strategy

Every module agent and pull request gets an isolated Neon branch.

```text
main/production
  └── integration
       └── dev/foundation-v1
            ├── dev/module-catalog-pricing-tax
            ├── dev/module-inventory-procurement
            ├── dev/module-customer-sales-fulfillment
            ├── dev/module-pos-cash-offline
            ├── dev/module-payments-accounting-banking
            ├── dev/module-localization-compliance
            └── dev/module-reporting-integrations
```

Preview/test branches:

```text
preview/pr-<number>-<git-branch>
test/<module>-<commit>-<run>
```

Rules:

- branches are created from an approved schema baseline;
- agents never share one mutable development database;
- use schema-only or approved synthetic/sanitized data;
- production personal data is not copied to agent previews;
- module migrations are isolated and owned;
- CI applies migrations, runs tests and deletes ephemeral branches;
- schema diff and migration review remain mandatory before merge;
- production migrations are applied by the release pipeline only.

## 5. Why D1 is not canonical

D1 is valuable for bounded workloads, but the product needs:

- large append-only stock, payment, journal and audit ledgers;
- rich relational constraints and exact accounting;
- complex queries, migrations, backups and BI tooling;
- large-tenant growth and portable exports;
- one coherent relational transaction for internal posting effects.

D1 remains suitable for:

- small auxiliary databases;
- isolated integration state;
- lightweight read projections;
- prototypes and experiments;
- use cases proven by benchmarks.

Do not create a split-brain fallback that writes canonical transactions to D1 when Neon is unavailable.

## 6. Durable Objects responsibility

Use Durable Objects only when one logical coordinator must serialize operations:

- active register/session coordination;
- live customer display/cart channel;
- short-lived high-contention reservation coordinator;
- device/offline sync cursor arbitration;
- websocket presence and realtime notifications;
- legally appropriate sequence allocation.

Durable Object state must be recoverable from Neon or explicitly classified as ephemeral/auxiliary. Do not store the global accounting or inventory ledger in Durable Objects.

## 7. Queues and Workflows

Cloudflare Queues has at-least-once delivery, so:

- Neon transaction writes authoritative data and outbox event together;
- publisher sends outbox events to Queues;
- every consumer is idempotent;
- failures use retry, dead-letter and replay tooling;
- queue delay cannot invalidate an already committed transaction.

Use Workflows for:

- imports and exports;
- fiscal/e-invoice submission;
- settlement reconciliation;
- tenant provisioning/migration/offboarding;
- privacy operations;
- large backfills and scheduled reports.

Workflow state is orchestration history; business truth remains in Neon.

## 8. R2 responsibility

Use R2 for:

- product images and media;
- supplier/customer attachments;
- immutable receipt/invoice PDFs;
- import source/error files;
- reports and exports;
- tenant portability bundles;
- integration evidence where retention permits.

Store object checksum, size, content type, tenant, retention and legal-document version in Neon. Use immutable keys for legal documents and short-lived signed access.

## 9. Storage responsibility table

| Storage/service | Responsibility | Must not own |
|---|---|---|
| Neon PostgreSQL | Canonical transactions, ledgers, constraints, module state | Large media/blobs |
| Neon branches | Agent/PR/test isolation and migration validation | Production release approval |
| R2 | Media, documents, imports/exports and archives | Transactional balances |
| Durable Objects | Narrow serialized/realtime coordination | Enterprise financial ledger |
| D1 | Bounded auxiliary DB/projection | Default accounting/inventory source |
| KV/cache | Versioned non-authoritative config/cache | Permissions, stock or payment truth |
| Client IndexedDB/SQLite | Offline catalog, carts and operation log | Final server authority |
| Analytics store | Long-range governed BI | Transaction processing |

## 10. Regional model

- Each tenant is pinned to a home Neon region/data plane for writes.
- Cloudflare routes requests globally but business writes execute against the tenant's assigned database region.
- The global control plane stores minimum tenant routing/subscription metadata.
- Cross-region reporting uses governed exports/projections, not distributed transactional joins.
- Region migration is an explicit freeze, copy, verify and cutover workflow.
- Country/data-residency marketing must reflect Cloudflare, Neon, R2, logging, backup and integration-provider behavior together.

## 11. Required architecture spikes

### Direct driver benchmark

- HTTP read/write and HTTP transaction batch;
- WebSocket interactive transaction;
- Neon cold compute wake-up;
- p50/p95/p99 from target user regions;
- connection/session count and cleanup;
- query/lock timeout and database failover behavior.

### POS posting benchmark

- 20-line sale;
- price/tax/discount snapshot;
- stock reservation and FIFO consumption;
- payment/cash record;
- balanced journals and outbox;
- concurrent final-unit sale;
- response loss and idempotent retry.

### Branching/CI benchmark

- create module/PR branch;
- apply foundation and module migrations;
- load synthetic fixtures;
- run database/E2E tests;
- inspect schema diff;
- delete branch and verify cleanup.

### Restore and recovery

- Neon point-in-time/backup restore according to selected plan;
- R2 object verification;
- outbox replay;
- projection rebuild;
- stock/journal reconciliation;
- tenant route cutover.

### Hyperdrive comparison

Run only after direct Neon baseline exists. Adopt only if measured benefit justifies the extra dependency.

## 12. Framework and ORM selection

Select the database layer after a spike validates:

- Workers compatibility;
- Neon HTTP and WebSocket modes;
- explicit transactions and row locks;
- migrations and schema namespaces;
- exact numeric handling;
- query observability and cancellation;
- RLS tenant context;
- bundle size and maintenance.

The core should not depend on ORM-specific magic for ledgers or tenant security. Critical posting SQL remains explicit and reviewable.

## 13. Failure behavior

### Neon unavailable

- online writes fail closed;
- permitted POS operations may continue offline;
- do not write canonical data to D1/KV as fallback;
- queued non-critical work waits;
- recovery reconciles pending offline/provider operations.

### Response lost after commit

- retry with the same idempotency key;
- return the original stored result;
- never execute a second sale/payment/posting.

### External payment/fiscal provider unavailable

- persist explicit pending/unknown state;
- recover through status query, signed callback or Workflow;
- no external call remains inside a long database transaction.

### Queue/R2/Durable Object failure

- committed Neon business records remain valid;
- outbox/workflow retries;
- legal document generation may remain pending where law permits;
- Durable Object recovers authoritative state or restarts ephemeral state.

## 14. Decision scorecard

Score: 1 weak, 5 strong.

| Criterion | D1 canonical | Neon direct | Neon + Hyperdrive | Conventional cloud |
|---|---:|---:|---:|---:|
| Financial relational fit | 3 | 5 | 5 | 5 |
| Workers integration | 5 | 5 | 5 | 2 |
| Baseline simplicity | 5 | 5 | 4 | 2 |
| Global connection optimization | 5 | 4 | 5 | 3 |
| Standard PostgreSQL portability | 2 | 5 | 5 | 5 |
| Isolated agent/PR databases | 3 | 5 | 5 | 3 |
| Reporting/tool ecosystem | 2 | 5 | 5 | 5 |
| Vendor concentration | 2 | 4 | 3 | 4 |
| Recommended role | Auxiliary | **Primary** | Optional fallback | Regulatory/runtime fallback |

## 15. Exit criteria for changing the decision

Create a new ADR if:

- direct Neon latency or transaction behavior fails approved budgets;
- a required driver/ORM is incompatible;
- Hyperdrive produces a material measured benefit;
- regulation or enterprise contracts require another deployment;
- database branching limits/cost do not support the agent/preview workflow;
- the Workers runtime cannot support required processing after asynchronous alternatives are tested.

## Primary references

- https://neon.com/docs/serverless/serverless-driver
- https://github.com/neondatabase/serverless
- https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/
- https://developers.cloudflare.com/workers/databases/connecting-to-databases/
- https://neon.com/docs/get-started-with-neon/workflow-primer
- https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/
- https://developers.cloudflare.com/queues/reference/delivery-guarantees/
- https://developers.cloudflare.com/workflows/
- https://developers.cloudflare.com/r2/reference/consistency/
