# International Store Management & POS Platform

Documentation-first product and architecture programme for a multi-tenant, international store-management SaaS covering POS, inventory, purchasing, sales, accounting, customer management, reporting, integrations, localisation and a native Store Companion client.

**Research baseline:** 2026-07-27  
**Implementation checkpoint:** 2026-07-29  
**Status:** Foundation complete; MOD-A, MOD-B, MOD-C, MOD-D and MOD-E integrated; MOD-F active; MOD-G dependency-gated; MOB-01 Store Companion documentation and Flutter foundation active in an isolated branch.

## Current implementation phase

The reviewed programme baseline contains Cloudflare application shells, direct Neon adapters, tenant/RLS enforcement, shared exact primitives, versioned contracts, identity/RBAC, audit, idempotency, outbox/inbox, preview automation and the integrated commerce, inventory, sales, POS/offline and finance modules.

Foundation and the integrated modules have recorded Neon, Cloudflare, migration, security, recovery and Impeccable evidence. Small-task agents remain prohibited. Separate agents may own complete ready workpacks in isolated Git worktrees, Git branches and Neon branches; development may be parallel but programme integration remains serial.

MOD-F continues localisation/country/compliance implementation. MOB-01 may proceed in parallel for mobile documentation, Flutter foundation and reviewed-contract operational workflows. MOB-01 final country behaviour depends on MOD-F and governed dashboard/report/OpenAPI behaviour depends on MOD-G. Native POS remains the integrated PWA/MOD-D path and is excluded from Store Companion.

Current machine-readable status and evidence are maintained in `docs/agent-workpacks/program-board.yaml`.

## Primary decision

Use a **Cloudflare-first hybrid architecture**, not a fully Cloudflare-native database architecture:

- Cloudflare Workers for APIs and edge routing.
- Cloudflare Pages/Workers Static Assets for web applications.
- PostgreSQL as the canonical transactional system of record.
- Neon Serverless PostgreSQL as the managed canonical database, accessed directly from Workers through `@neondatabase/serverless`.
- Hyperdrive is optional benchmark/fallback only.
- Durable Objects only where serialised coordination is required.
- Queues and Workflows for asynchronous and durable processes.
- R2 for product media, imports, exports, invoices, receipts and archived reports.
- D1/KV/client storage only for bounded auxiliary or non-authoritative workloads.
- Store Companion consumes versioned Worker APIs; it never connects directly to Neon or introduces a second mobile business database.

This gives Cloudflare's global delivery and low-operations model without forcing an international financial platform into SQLite-oriented storage limits or creating avoidable vendor lock-in.

## Product shape

The product is a **multi-tenant modular monolith with event-driven integrations** and multiple clients:

- POS web/PWA for checkout, cash, offline and hardware workflows;
- admin web for complete operational and financial administration;
- Store Companion Flutter app for mobile management, inventory/procurement, sales, approvals and finance review;
- public/integration clients through governed APIs.

Modules may later be extracted only when scale, team ownership, regulation or failure isolation provides a measured reason.

## Documentation map

1. [Executive Summary](docs/00-EXECUTIVE-SUMMARY.md)
2. [Market Research](docs/01-MARKET-RESEARCH.md)
3. [Product Requirements](docs/02-PRODUCT-REQUIREMENTS.md)
4. [Feature Catalogue](docs/03-FEATURE-CATALOGUE.md)
5. [Domain and Data Model](docs/04-DOMAIN-AND-DATA-MODEL.md)
6. [System Architecture](docs/05-SYSTEM-ARCHITECTURE.md)
7. [Cloudflare Architecture Decision](docs/06-CLOUDFLARE-DECISION.md)
8. [POS, Offline and Hardware](docs/07-POS-OFFLINE-HARDWARE.md)
9. [Internationalisation and Country Packs](docs/08-INTERNATIONALIZATION.md)
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
23. [ADR-006: OIDC/JWKS Identity](docs/adr/ADR-006-OIDC-JWKS-IDENTITY.md)
24. [ADR-007: Store Companion Mobile](docs/adr/ADR-007-STORE-COMPANION-MOBILE.md)
25. [Parallel Agent Execution Plan](docs/17-PARALLEL-AGENT-EXECUTION.md)
26. [Store Companion Parallel Execution Addendum](docs/17A-STORE-COMPANION-PARALLEL-EXECUTION.md)
27. [Module Agent Workpacks](docs/agent-workpacks/README.md)
28. [Module Agent Activation Policy](docs/agent-workpacks/MODULE-AGENT-ACTIVATION-POLICY.md)
29. [MOB-01 Store Companion Workpack](docs/agent-workpacks/MOB-01-STORE-COMPANION.md)
30. [Store Companion Documentation](docs/mobile/README.md)
31. [Foundation Gate](docs/architecture/foundation/foundation-gate.md)
32. [Foundation Checkpoint Handoff](docs/agent-handoffs/FOUNDATION-handoff.md)
33. [Open-Source Reuse Register](docs/open-source/reuse-register.yaml)
34. [Foundation Agent One-Shot Prompt](docs/agent-prompts/FOUNDATION-ONE-SHOT-PROMPT.md)
35. [Impeccable Design Skill Workflow](docs/18-IMPECCABLE-DESIGN-WORKFLOW.md)
36. [Operations Ledger Design System](DESIGN.md)
37. [Foundation Design Evidence](docs/architecture/foundation/design-evidence/README.md)

## Design tooling

Impeccable 4.0.3 is vendored for project-local Codex and GitHub Copilot use. UI agents must read `PRODUCT.md`, `DESIGN.md`, follow `docs/18-IMPECCABLE-DESIGN-WORKFLOW.md`, and pass its UI completion gate. Store Companion additionally follows `docs/mobile/07-DESIGN-SYSTEM.md` for the approved native adaptation of Operations Ledger.

## Non-negotiable product principles

- Every stock movement must be explainable from an immutable stock ledger.
- Every financial balance must be explainable from balanced journal entries.
- Posted sales, payments, stock movements and journal entries are never silently edited; corrections use reversal or adjustment documents.
- Money is stored as integer minor units or exact decimals with an explicit ISO currency code; never binary floating point.
- Tenant, legal entity, store, warehouse, register and business date are first-class dimensions.
- Offline POS and Store Companion pending operations are explicit synchronisation protocols, not invisible cache fallbacks.
- Payment card data is tokenised by certified providers; the platform and Store Companion do not store PAN or sensitive authentication data.
- Country-specific tax, fiscal, document, numbering and accounting behaviour is delivered through versioned localisation packs.
- Reporting reads from governed projections and retains metric definition/freshness/drill-through.
- Mobile never bypasses server authorization or duplicates domain calculations.
- Open-source code/dependency reuse requires documented licence and provenance review.

## Recommended first commercial scope

The first sellable web platform targets general retail and wholesale SMBs with tenant/organisation setup, catalog/pricing/tax, multi-store POS, purchasing/inventory, sales/returns, payments/accounting, reports, roles/approvals/audit and country configuration.

The first Store Companion release adds secure mobile workspace access, barcode/stock lookup, receiving, count, transfer, customer/quote/order workflows, approval inbox and finance exception review. Native mobile POS, payment/fiscal hardware and unrestricted financial administration remain deferred.

Advanced manufacturing, restaurant kitchen workflows, pharmacy regulation, fuel retail, hospitality and enterprise workforce management remain separate vertical packs after the general retail core is stable.
