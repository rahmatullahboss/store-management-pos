# ADR-002: Start with a Modular Monolith

- **Status:** Accepted
- **Date:** 2026-07-27
- **Decision owners:** Product/Architecture

## Context

The system contains many business capabilities, but most sale, purchase, stock, payment and accounting flows require strong transactional consistency and are being built by one product organization. Starting with microservices would add distributed transactions, event/version coordination, deployment overhead and debugging complexity before module boundaries are proven.

A single unstructured monolith would be simpler initially but would create shared-table coupling and prevent later extraction.

## Decision

Build one principal transactional backend deployment as a modular monolith with explicit bounded modules:

- identity and tenancy;
- catalog;
- pricing and tax;
- inventory;
- procurement;
- sales and fulfillment;
- POS and cash;
- payments;
- customers/loyalty;
- accounting;
- localization;
- integrations;
- reporting.

Each module owns its domain model, application interfaces and database tables. Cross-module writes occur only through published commands/interfaces. Stable outbox events support asynchronous integrations and future extraction.

## Rationale

This structure provides:

- local ACID transactions for critical posting flows;
- one deployment and operational model during early development;
- faster refactoring while the domain is learned;
- enforceable ownership instead of shared CRUD;
- a clear path to extract modules later based on evidence.

## Consequences

### Positive

- lower operational and cognitive overhead;
- easier atomic checkout/purchase posting;
- simpler testing and debugging;
- consistent tenant/security context;
- fewer distributed failure modes;
- faster delivery for a small-to-medium team.

### Negative

- the deployment scales as a larger unit initially;
- poor discipline can still create coupling;
- module-specific failures may affect the shared process;
- extraction later requires migration work;
- build size/runtime limits must be monitored on Workers.

## Boundary rules

- Module persistence internals are private.
- Direct cross-module table writes are forbidden.
- Cyclic imports/dependencies fail architecture tests.
- Shared packages contain technical primitives, not business rules.
- Accounting receives explicit posting instructions/events and does not infer meaning from arbitrary tables.
- Reporting may use governed read projections but cannot become a write path.
- Cross-module contracts and events are versioned.
- Modules cannot be split into separate services until data ownership and consistency strategy are documented.

## Extraction criteria

A module may become a service when measured evidence shows:

- materially independent scale/resource profile;
- distinct compliance/data-residency boundary;
- independent team/release ownership;
- required failure isolation;
- incompatible runtime/technology need;
- contractual dedicated deployment;
- stable APIs/events and owned data.

Extraction requires a new ADR, migration/rollback plan, distributed consistency model and operational ownership.

## Rejected alternatives

### Microservices from day one

Rejected because the domain and team boundaries are not yet stable and key workflows benefit from local transactions.

### Unstructured monolith

Rejected because it creates shared ownership and makes international/vertical extension and later extraction unsafe.

### Separate database per module from day one

Rejected because it introduces distributed consistency without current benefits. Logical ownership is enforced before physical separation.

## Validation

- architecture tests enforce package dependencies;
- table ownership documented in schema/migrations;
- end-to-end checkout and purchase flows use explicit interfaces;
- build/runtime size remains within Workers limits;
- module-specific metrics and errors are distinguishable.

## Related documents

- `docs/04-DOMAIN-AND-DATA-MODEL.md`
- `docs/05-SYSTEM-ARCHITECTURE.md`
- `docs/12-DELIVERY-ROADMAP.md`
