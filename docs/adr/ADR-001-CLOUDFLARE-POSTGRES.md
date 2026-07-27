# ADR-001: Cloudflare-First Application with Canonical PostgreSQL

- **Status:** Superseded by ADR-005 for connectivity; PostgreSQL canonical-store decision remains accepted
- **Date:** 2026-07-27
- **Decision owners:** Product/Architecture

## Supersession note

This ADR preserves the original decision to use PostgreSQL rather than D1/Durable Objects as the canonical transactional store. Its Hyperdrive connectivity choice is historical and must not be implemented. ADR-005 replaces that portion with direct Neon Serverless driver connectivity; Hyperdrive is optional benchmark-only.

## Context

The product must serve international stores with low-latency web/POS access while maintaining a durable relational source of truth for accounting, inventory, payments, procurement and audit.

Candidate approaches were:

1. fully Cloudflare-native Workers + D1/Durable Objects;
2. Cloudflare edge/application + PostgreSQL through Hyperdrive;
3. conventional hyperscaler application/managed PostgreSQL;
4. backend-platform hybrid.

The workload contains append-only ledgers, exact accounting, relational constraints, rich reporting, multi-location transactions and long-term portability needs.

## Decision

Use:

- Cloudflare Workers for API/BFF and integration execution;
- Cloudflare static assets/CDN/WAF for clients;
- regional PostgreSQL as the canonical transactional database;
- Hyperdrive for application database pooling/connectivity;
- Durable Objects only for narrow serialized coordinators and realtime sessions;
- Queues with transactional outbox for asynchronous work;
- Workflows for long-running orchestration;
- R2 for files/documents/media;
- D1/KV only for bounded auxiliary data/projections/caches.

Each tenant is assigned a home regional data plane. The global control plane stores minimal routing/subscription metadata.

## Rationale

PostgreSQL provides mature transactions, constraints, exact numerics, RLS, partitioning, backups and a broad data/BI ecosystem. Cloudflare provides global delivery and integrated edge services. The hybrid preserves these strengths without forcing the global financial system of record into per-database D1 limits or distributed Durable Object joins.

## Consequences

### Positive

- strong fit for accounting and inventory ledgers;
- globally fast application edge;
- database/provider portability;
- simpler relational transactions and migrations;
- familiar reporting/backup ecosystem;
- Cloudflare-native queues/workflows/object storage remain available.

### Negative

- database is a separate operational dependency/vendor;
- latency/capacity between Workers/Hyperdrive/PostgreSQL must be measured;
- pooled transaction/RLS behavior needs discipline;
- regional data-plane operations are more complex than one D1 database;
- Cloudflare and database observability must be correlated.

## Guardrails

- No fallback authoritative writes to D1/KV when PostgreSQL is unavailable.
- Hyperdrive query caching is disabled or narrowly governed for stock, payment, permission and finance data.
- Transactions are short and tenant context is set explicitly per transaction.
- Durable Object state is recoverable from PostgreSQL or explicitly classified auxiliary.
- Queue consumers are idempotent because delivery is at least once.
- D1 responsibility cannot expand into canonical ledgers without a new ADR and benchmark.
- Framework/ORM selection requires Workers transaction and bundle/runtime tests.

## Validation required

- Workers/Hyperdrive/PostgreSQL latency and concurrency across target regions;
- RLS tenant context under pooling;
- checkout transaction with FIFO, tax, journal and outbox;
- database failover and retry behavior;
- large import/report/document workload;
- backup/restore/outbox replay;
- cost at small, growing and large tenant profiles.

## Reconsider when

- runtime/database latency fails approved budgets;
- regulation/customer contract requires another hosting model;
- Workers limits block essential processing after viable asynchronous/external alternatives are tested;
- D1 proves materially better for the real workload without unacceptable scale/migration/tooling constraints;
- dedicated enterprise deployment is required.

## Related documents

- `docs/05-SYSTEM-ARCHITECTURE.md`
- `docs/06-CLOUDFLARE-DECISION.md`
- `docs/13-TESTING-OBSERVABILITY-SRE.md`
