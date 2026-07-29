# MOD-A Admin UI Checkpoint

**Date:** 2026-07-28  
**Visual system:** Operations Ledger  
**Mode:** Operate

## Delivered surfaces

### Catalog operations

- barcode/SKU/name search and status/kind/locale filters;
- dense product/variant ledger with version and lifecycle state;
- sticky product inspector with identifiers, units, variant axes and version trail;
- dry-run import control and issue-export workflow;
- append-only unit conversion status and management entry point;
- module-owned permission-scoped route descriptors.

### Pricing and tax control

- effective price-list ledger with location/channel/customer-group scope;
- resolution inspector explaining winning list, quantity tier and minimum margin;
- promotion and coupon simulation with stacking rejection and exact allocation;
- controlled manual discount approval with reason and audit action;
- tax snapshot with jurisdiction, treatment, versions, net/tax/gross reconciliation;
- immutable configuration timeline and publish entry point.

All displayed values are clearly labelled synthetic fixtures. GBP examples use `en-GB` formatting.

## Shared-boundary handling

The Foundation admin shell currently has a static route registry. MOD-A did not edit it. The additive route-provider request is recorded in:

- `docs/contracts/change-requests/CCR-0001-MOD-A-ADMIN-ROUTE-PROVIDERS.md`

Module exports remain independently testable until serial shared-shell integration.

## Automated evidence

`tests/unit/mod-a-admin-ui.test.mjs` verifies:

- task hierarchy, calculation provenance and controlled actions;
- nine unique permission-scoped module route descriptors;
- English, Bengali, Arabic RTL and Japanese rendering;
- ready, loading, empty, error, denied, conflict and offline states;
- shared design tokens and absence of a parallel type/palette system.

The unit suite passed 31/31 tests at this checkpoint.

`npm run mod-a:design:verify` generated browser evidence under `docs/architecture/mod-a/design-evidence/`:

- scenarios passed: 6/6;
- Axe WCAG 2 A/AA and WCAG 2.1 AA violations: 0;
- Impeccable deterministic findings: 0;
- viewport overflow and unexpected clipping: 0;
- desktop, tablet and mobile coverage;
- Bengali, Arabic RTL and Japanese fixtures;
- reduced-motion and 200% text coverage;
- visible skip-link and single-main-landmark keyboard contract.

## Design decision

MOD-A extends the existing Operations Ledger world. It introduces no module palette, web font, parallel component library or shared durable primitive. The surface prioritises effective state, immutable versions, approval risk and drill-through provenance over generic dashboard cards.
