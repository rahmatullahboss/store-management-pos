# MOD-B Inventory and Procurement Handoff

## Status

Implementation is active on `module/inventory-procurement-v1`. CP0 through CP4 are complete; CP5 and CP6 remain in progress.

## Foundation and isolation

- Exact approved base: `57f21e8c14e27ce3ad96a862cf6de82c2c6cd27c`
- Worktree: `.worktrees/inventory-procurement`
- No unmerged MOD-A code imported.
- Frozen `CatalogItemReferenceV1` values are treated as opaque item/variant IDs.

## Completed capabilities

- Warehouses, zones, bins, stock statuses, batches, serial lineage, and expiry.
- Immutable, idempotent stock posting and derived balances.
- FIFO cost layers and exact minor-unit valuation.
- Reservations, transfers, adjustments, physical counts, and reconciliation.
- Suppliers, contacts, supplier-item mappings, requisitions, and purchase orders.
- Partial receiving, inspection dispositions, supplier returns, three-way matching, landed cost, and replenishment.
- Tenant RLS, permission seeds, approval references, append-only enforcement, audit evidence, and outbox events.
- Checksum-verified module migration manifests and deterministic migration ordering.

## Invariants

1. Purchase order approval does not create stock.
2. Goods receipt posting is the procurement-to-inventory stock boundary.
3. Ledger rows are never updated or deleted; corrections are compensating entries.
4. Reservations reduce available quantity but do not mutate on-hand quantity.
5. Transfer dispatch moves sellable stock to destination in-transit; receipt reclassifies it.
6. Negative sellable stock obeys warehouse policy and may require a persisted approval ID.
7. Receipt, return, cost, audit, and event lineage retains posting-group and source-document references.
8. Exact scaled integers are used for quantity and minor-unit integers for money.

## Current verification

- TypeScript strict typecheck: pass
- Module migration validator: pass
- Unit and architecture tests: 19/19 pass

## Pending before final handoff

- Complete HTTP API and procurement SQL write adapter.
- Complete admin UI routes and design verification.
- Add safe CSV import/export, jobs, metrics, health, and alert surfaces.
- Create/verify `dev/module-inventory-procurement` through repository secrets and execute Neon migration/recovery checks.
- Run full `npm run verify`, commit/push final checkpoint, open draft PR, and attach final evidence.
