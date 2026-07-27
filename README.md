# International Store Management & POS Platform

Documentation-first product and architecture blueprint for a multi-tenant, international store-management SaaS covering POS, inventory, purchasing, sales, accounting, customer management, reporting, integrations, and localization.

**Research date:** 2026-07-27  
**Status:** Planning baseline; implementation has not started.

## Primary decision

Use a **Cloudflare-first hybrid architecture**, not a fully Cloudflare-native database architecture:

- Cloudflare Workers for APIs and edge routing.
- Cloudflare Pages/Workers Static Assets for web applications.
- PostgreSQL as the canonical transactional system of record.
- Neon Serverless PostgreSQL as the managed canonical database, accessed directly from Workers through `@neondatabase/serverless`.
- Hyperdrive is not required in the baseline; retain it only as an optional benchmark/fallback path if direct Neon latency or driver constraints justify it.
- Durable Objects only where serialized coordination is needed, such as register sessions, store-level counters, live stock reservations, and offline sync arbitration.
- Queues and Workflows for asynchronous and durable business processes.
- R2 for product media, imports, exports, invoices, receipts, and archived reports.
- D1 only for bounded auxiliary workloads, prototypes, isolated lightweight tenants, or edge-local projections—not as the default global accounting and inventory ledger.

This gives Cloudflare's global delivery and low-operations model without forcing an international financial platform into SQLite-oriented storage limits or creating avoidable vendor lock-in.

## Product shape

The recommended product is a **multi-tenant modular monolith with event-driven integrations**. It should begin as one deployable backend with hard module boundaries and a single canonical PostgreSQL cluster, rather than premature microservices. Modules may later be extracted when scale, team ownership, regulation, or failure isolation provides a measured reason.

## Documentation map

1. [Executive Summary](docs/00-EXECUTIVE-SUMMARY.md)
2. [Market Research](docs/01-MARKET-RESEARCH.md)
3. [Product Requirements](docs/02-PRODUCT-REQUIREMENTS.md)
4. [Feature Catalogue](docs/03-FEATURE-CATALOGUE.md)
5. [Domain and Data Model](docs/04-DOMAIN-AND-DATA-MODEL.md)
6. [System Architecture](docs/05-SYSTEM-ARCHITECTURE.md)
7. [Cloudflare Architecture Decision](docs/06-CLOUDFLARE-DECISION.md)
8. [POS, Offline and Hardware](docs/07-POS-OFFLINE-HARDWARE.md)
9. [Internationalization and Country Packs](docs/08-INTERNATIONALIZATION.md)
10. [Security, Privacy and Compliance](docs/09-SECURITY-COMPLIANCE.md)
11. [Open-Source Reuse Plan](docs/10-OPEN-SOURCE-REUSE.md)
12. [API and Integration Strategy](docs/11-API-INTEGRATIONS.md)
13. [Delivery Roadmap](docs/12-DELIVERY-ROADMAP.md)
14. [Testing, Observability and SRE](docs/13-TESTING-OBSERVABILITY-SRE.md)
15. [Reporting and Analytics](docs/14-REPORTING-ANALYTICS.md)
16. [Implementation Backlog](docs/15-IMPLEMENTATION-BACKLOG.md)
17. [Source Register](docs/16-SOURCE-REGISTER.md)
18. [ADR-001: Cloudflare + PostgreSQL](docs/adr/ADR-001-CLOUDFLARE-POSTGRES.md)
19. [ADR-002: Modular Monolith](docs/adr/ADR-002-MODULAR-MONOLITH.md)
20. [ADR-003: Immutable Ledgers](docs/adr/ADR-003-IMMUTABLE-LEDGERS.md)
21. [ADR-004: Offline POS Sync](docs/adr/ADR-004-OFFLINE-POS-SYNC.md)
22. [ADR-005: Neon Direct Driver](docs/adr/ADR-005-NEON-DIRECT-DRIVER.md)
23. [Parallel Agent Execution Plan](docs/17-PARALLEL-AGENT-EXECUTION.md)
24. [Module Agent Workpacks](docs/agent-workpacks/README.md)
25. [Open-Source Reuse Register](docs/open-source/reuse-register.yaml)
26. [Foundation Agent One-Shot Prompt](docs/agent-prompts/FOUNDATION-ONE-SHOT-PROMPT.md)

## Non-negotiable product principles

- Every stock movement must be explainable from an immutable stock ledger.
- Every financial balance must be explainable from balanced journal entries.
- Posted sales, payments, stock movements, and journal entries are never silently edited; corrections use reversal or adjustment documents.
- Money is stored as integer minor units or exact decimals with an explicit ISO currency code; never binary floating point.
- Tenant, legal entity, store, warehouse, register, and business date are first-class dimensions.
- Offline POS must be designed as a synchronization protocol, not as a browser-cache afterthought.
- Payment card data should be tokenized by certified payment providers; the platform should not store PAN or sensitive authentication data.
- Country-specific taxation, fiscalization, e-invoicing, receipt rules, and accounting charts are versioned localization packs, not hard-coded global logic.
- Reporting reads from governed projections or an analytics store and must not distort the transactional write model.
- Open-source code reuse requires a documented license review and provenance record before code is copied.

## Recommended first commercial scope

The first sellable release should target general retail and wholesale SMBs with:

- tenant and organization setup;
- product, variant, barcode, price, tax and unit management;
- single/multi-store POS with cash management and offline mode;
- purchasing, receiving, stock transfers and adjustments;
- sales, returns, refunds, quotations and customer accounts;
- basic double-entry accounting and controlled period close;
- operational dashboards and exportable reports;
- roles, approvals, audit trails, imports and integrations;
- locale, currency, timezone and country-pack configuration.

Advanced manufacturing, restaurant kitchen workflows, pharmacy regulation, fuel retail, hospitality, and enterprise workforce management should be separate vertical packs after the general retail core is stable.
