# Store Companion Mobile Documentation

This directory is the product, architecture, security, design and delivery authority for the Flutter Store Companion application.

## Decision summary

- One multi-role Flutter companion application for Android and iOS.
- Native POS is excluded; the integrated POS PWA remains the checkout and hardware surface.
- Flutter development may run in parallel with the web programme under the isolated MOB-01 workpack.
- Neon PostgreSQL remains authoritative; mobile never connects to Neon directly.
- Device SQLite is bounded, encrypted where sensitive, non-authoritative and rebuildable.
- Final country behaviour depends on integrated MOD-F contracts.
- Governed KPI dashboards, reporting and generated public API contracts depend on MOD-G.

## Reading order

1. [Product and execution decision](00-STORE-COMPANION-DECISION.md)
2. [Personas, workspaces and capabilities](01-PERSONAS-CAPABILITIES.md)
3. [Feature catalogue and release scope](02-FEATURE-CATALOGUE.md)
4. [System architecture](03-SYSTEM-ARCHITECTURE.md)
5. [API and contract design](04-API-CONTRACTS.md)
6. [Offline and synchronisation protocol](05-OFFLINE-SYNC.md)
7. [Security and privacy](06-SECURITY-PRIVACY.md)
8. [Mobile design system](07-DESIGN-SYSTEM.md)
9. [Testing, release and operations](08-TESTING-RELEASE.md)

## Related programme documents

- `docs/adr/ADR-007-STORE-COMPANION-MOBILE.md`
- `docs/agent-workpacks/MOB-01-STORE-COMPANION.md`
- `docs/contracts/change-requests/CCR-0003-MOBILE-FIRST-PARTY-CONTRACTS.md`
- `docs/architecture/mobile/activation-checkpoint.md`
- `PRODUCT.md`
- `DESIGN.md`
- `docs/05-SYSTEM-ARCHITECTURE.md`
- `docs/09-SECURITY-COMPLIANCE.md`
- `docs/11-API-INTEGRATIONS.md`
- `docs/13-TESTING-OBSERVABILITY-SRE.md`

## Authority and conflict rule

Existing domain module contracts remain authoritative for catalog, pricing, tax, inventory, procurement, customer, sales, fulfilment, POS, payments, accounting, banking, localisation and reporting. Mobile documents define client composition and device behaviour only. When a mobile requirement needs a shared or module-owned API extension, MOB-01 records a contract-change request rather than duplicating business logic.
