# MOD-B Inventory and Procurement Execution Tracker

- Repository: `rahmatullahboss/store-management-pos`
- Approved Foundation SHA: `57f21e8c14e27ce3ad96a862cf6de82c2c6cd27c`
- Git branch: `module/inventory-procurement-v1`
- Fixed worktree: `.worktrees/inventory-procurement`
- Neon branch: `dev/module-inventory-procurement`
- GitHub tracker: issue #4

## Guardrails

- The branch started from the exact approved Foundation SHA.
- No unrelated dirty work was reset, discarded, overwritten, or imported.
- MOD-A unmerged implementation is not referenced. Catalog items and variants remain frozen-contract UUID references.
- Inventory quantity is represented as an exact scaled integer. Money uses exact minor-unit integers.
- Stock ledger, cost consumptions, receipt lineage, supplier-return lineage, and landed-cost allocations are append-only.
- Purchase orders never create stock. Only posted receiving movements create on-hand inventory.

## Checkpoints

### CP0 — Baseline, contracts, and module skeleton — complete

- Verified Foundation ancestry, activation policy, program board, and MOD-B workpack.
- Created isolated branch/worktree.
- Added `modules/inventory` and `modules/procurement` public module boundaries.
- Reused frozen Foundation contracts for scope, quantity, money, stock posting, accounting instructions, audit metadata, and catalog references.

### CP1 — Warehouse, ledger, availability, and costing — complete

- Warehouse, zone, and bin model.
- Append-only stock ledger with idempotent operations.
- Negative-stock deny/approve/allow policy.
- Availability projection and reconciliation.
- FIFO cost layers, exact cost consumption, and landed-cost revaluation.
- PostgreSQL RLS, indexes, append-only triggers, projection trigger, audit/outbox hooks, and permissions.

### CP2 — Reservations, transfers, adjustments, and counts — complete

- Full/partial reservation, consume, release, and expiry states.
- Two-leg transfers through in-transit stock with damaged/missing receipt accounting.
- Approval-required negative adjustments.
- Blind count, recount, approval, variance posting, and reconciliation.
- Reorder-policy persistence model.

### CP3 — Suppliers, requisitions, and purchase orders — complete

- Supplier, contact, supplier-item mapping, optimistic versioning.
- Requisition submit/approve/reject/convert states.
- Purchase order create/submit/approve/amend/cancel states.
- Receiving tolerance and immutable revision/history evidence.

### CP4 — Receiving, supplier returns, matching, and landed cost — complete

- Partial goods receipt with accepted, quarantine, damaged, and rejected disposition.
- Batch/serial/expiry lineage.
- Supplier return posting back through the stock ledger.
- Supplier bill three-way match and balanced accounting instruction.
- Quantity/value/manual landed-cost allocation and inventory revaluation.
- Replenishment proposal generation from available plus incoming stock.

### CP5 — API, admin UI, security, imports/exports, and observability — complete

- Permissioned inventory and procurement HTTP routes with strict validation, tenant-scoped transactions, optimistic versioning and idempotency keys.
- Production SQL adapters for stock posting, reservations, transfers, counts, requisitions, purchase orders, receiving, supplier returns, three-way matching and landed cost.
- Admin Inventory Operations Ledger and Procurement Operations surfaces built on the existing shell and design tokens.
- Formula-safe CSV import/export for movement, balances, reorder policies, suppliers, orders and receipts.
- Operational health, reconciliation, reservation-expiry and replenishment surfaces.
- Audit and outbox evidence emitted in the same transaction as business writes.
- API route and error contract documentation in `docs/modules/inventory-procurement/api-contracts.md`.

### CP6 — Migration rehearsal, full verification, documentation, and final handoff — complete

- Repository-secret-backed workflow `.github/workflows/mod-b-neon-rehearsal.yml` creates or verifies the persistent Neon branch `dev/module-inventory-procurement` without deleting it.
- The workflow provisions a read-write compute endpoint when required, applies Foundation → Inventory → Procurement migrations, repeats the run to prove replay safety, and asserts RLS, append-only triggers, permission seeds and the frozen MOD-A boundary.
- GitHub Actions run `30419646024` completed successfully on commit `97ee74d`.
- Local full `npm run verify` passes and final handoff evidence is recorded.

## Verification evidence

Current verification:

- `npm run verify` — pass
- `npm run typecheck` — pass
- `npm run db:validate` — pass, 3 MOD-B migrations checksum-verified
- `npm test` — pass, 24/24 tests
- New deterministic MOD-B domain/API/UI tests — 9/9 pass
- Neon migration rehearsal — pass, run `30419646024`
- Persistent Neon branch — verified as `dev/module-inventory-procurement`

## Environment note

Neon credentials remain repository-secret-backed. The non-sensitive project identifier is stored as the repository variable `NEON_PROJECT_ID`; no credential was exposed or committed.
