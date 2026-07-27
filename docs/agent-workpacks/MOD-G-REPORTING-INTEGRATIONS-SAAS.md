# MOD-G: Reporting, Integrations and SaaS Administration

## Assignment

One agent owns reporting projections, public integrations and platform SaaS administration as one complete outer-platform workpack. Do not split dashboards, webhooks, connectors or subscription administration among separate agents.

```text
Git branch:   module/reporting-integrations-saas-v1
Worktree:     .worktrees/reporting-integrations-saas
Neon branch:  dev/module-reporting-integrations
Base:         program/foundation-v1
```

## Mission

Turn authoritative module events and ledgers into explainable operational reporting, stable external integration contracts and a controlled multi-tenant SaaS operating layer.

## Owned paths and schemas

```text
modules/reporting/**
modules/integrations/**
modules/saas-admin/**
database/modules/reporting/**
database/modules/integrations/**
apps/admin-web/src/modules/reporting/**
apps/admin-web/src/modules/integrations/**
apps/admin-web/src/modules/saas-admin/**
docs/modules/reporting-integrations-saas/**
PostgreSQL schemas: reporting, integration
Platform subscription tables only through approved foundation extension
```

## Complete scope

- metric catalog with owner, formula, version, dimensions, freshness and control total;
- operational projections for sales, margin, stock, procurement, cash, payment, finance and exceptions;
- owner, store manager, finance, inventory and platform dashboards;
- drill-through from KPI to documents and stock/payment/journal sources;
- projection rebuild, high-water cursor, freshness and reconciliation;
- scheduled and asynchronous CSV/XLSX/PDF/JSON exports through R2/Workflows;
- analytics-warehouse export contract without making analytics authoritative;
- public REST API conventions, scopes, pagination and idempotency support;
- API keys/OAuth clients and partner sandbox controls;
- signed outbound webhooks, retries, DLQ, replay and tenant console;
- connection/mapping/cursor framework for payment-adjacent, ecommerce, marketplace, shipping, messaging and accounting connectors;
- one priority ecommerce connector selected by launch demand;
- generic CSV/REST connector and integration health/reconciliation console;
- provider error normalization, rate limits and observability;
- plans, entitlements, usage meters and subscription status administration;
- tenant provisioning/suspension/offboarding orchestration hooks;
- feature rollout, support health, incidents and approved impersonation views;
- tenant export and operational support tools;
- admin UI, APIs, events, audit, runbooks and developer documentation.

## Contract responsibilities

Produce:

- metric definitions and reporting query contracts;
- projection freshness/reconciliation result;
- public API/OpenAPI and webhook schemas;
- integration connection/mapping/sync status;
- plan/entitlement/usage records and tenant lifecycle jobs.

Consume:

- domain events and read contracts from every module;
- immutable source references for drill-through;
- country/currency/timezone and privacy policy;
- foundation identity, entitlement, R2, Queue and Workflow primitives.

## Required invariants

- dashboard metrics reconcile to documented control totals;
- reporting projections are rebuildable and never authoritative writes;
- every metric shows period, timezone, currency, version and freshness;
- webhook/event replay never duplicates external or internal business effects;
- connector field ownership prevents synchronization loops;
- integration credentials are encrypted and redacted;
- one tenant's report, export or connector cannot read another tenant;
- subscription suspension never corrupts or deletes business data;
- support impersonation remains visible, approved and audited;
- large reports do not degrade checkout workloads.

## Required tests

- gross-to-net sales and margin control totals;
- stock/payment/accounting projection reconciliation;
- dashboard drill-through and preserved filters;
- delayed/duplicate/out-of-order domain events;
- full projection rebuild;
- large report/export performance and formula-injection safety;
- API scopes, rate limits, idempotency and pagination;
- webhook signature, retry, DLQ and replay;
- ecommerce mapping, loop prevention and conflict reconciliation;
- tenant plan/entitlement transition and suspension;
- tenant isolation for reports, exports and connectors;
- integration outage and cursor recovery;
- privacy/retention-aware export cleanup.

## Open-source reuse guidance

Medusa MIT integration concepts/code may be used after provenance review. OpenTelemetry and other Apache/MIT libraries are preferred. GPL/AGPL connector code must not be copied into the proprietary integration core.

## Completion gate

- every P0 KPI has a metric definition, control total and source drill-through;
- projections rebuild and reconcile after delayed/duplicate events;
- public API/webhook sandbox and developer documentation are complete;
- priority connector passes mapping, loop and outage tests;
- large exports use asynchronous jobs without checkout degradation;
- tenant plan, entitlement and lifecycle controls are auditable;
- admin reporting/integration/platform UI is complete;
- migrations run on a fresh foundation Neon branch;
- security, tenant isolation, performance and recovery tests pass;
- runbooks and handoff are complete;
- handoff path: `docs/agent-handoffs/MOD-G-handoff.md`.
