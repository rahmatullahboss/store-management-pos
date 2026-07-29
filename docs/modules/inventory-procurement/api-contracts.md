# MOD-B API Contracts

All routes are under `/v1`, require the Foundation-authenticated request context, run inside a tenant-scoped transaction, and return JSON unless `.csv` is present. Write commands require caller-generated UUIDs or stable operation IDs so retries are idempotent. Quantity values use `{ amount, unit, scale }`; money uses `{ amountMinor, currency, scale }`.

## Inventory

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET | `/inventory/availability?variantId=&warehouseId=` | `inventory.stock.read` | Derived on-hand, reserved, and available stock. |
| GET | `/inventory/movements` | `inventory.stock.read` | Immutable stock movement history. |
| GET | `/inventory/movements.csv` | `inventory.stock.read` | Formula-safe CSV movement export. |
| POST | `/inventory/stock-postings` | `inventory.stock.post` | Idempotent controlled stock posting. Loss/count movements additionally require `inventory.stock.adjust`. |
| POST | `/inventory/reservations` | `inventory.reservation.manage` | Create all-or-nothing or partial reservation. |
| POST | `/inventory/reservations/{id}/consume` | `inventory.reservation.manage` | Consume reserved quantities with optimistic versioning. |
| POST | `/inventory/reservations/{id}/release` | `inventory.reservation.manage` | Release remaining reservation quantity. |
| POST | `/inventory/transfers` | `inventory.transfer.manage` | Create a two-warehouse transfer. |
| POST | `/inventory/transfers/{id}/approve` | `inventory.transfer.approve` | Bind an approved Foundation approval request. |
| POST | `/inventory/transfers/{id}/dispatch` | `inventory.transfer.manage` | Move source sellable stock to destination in-transit. |
| POST | `/inventory/transfers/{id}/receive` | `inventory.transfer.manage` | Receive as sellable/damaged or account for missing quantity. |
| POST | `/inventory/counts` | `inventory.count.manage` | Freeze a blind physical-count snapshot. |
| POST | `/inventory/counts/{id}/submit` | `inventory.count.manage` | Submit first count or recount observations. |
| POST | `/inventory/counts/{id}/approve-post` | `inventory.count.approve` | Post approved count variance to immutable ledger. |
| GET | `/inventory/reconciliation` | `inventory.stock.reconcile` | Compare ledger-derived dimensions with projections. |
| POST | `/inventory/jobs/reconcile` | `inventory.stock.reconcile` | Persist a reconciliation run and evidence. |
| POST | `/inventory/jobs/expire-reservations` | `inventory.reservation.manage` | Release expired reservations using locked, skip-locked work. |
| POST | `/inventory/reorder-policies/import` | `inventory.replenishment.manage` | Validate and upsert reorder policies from CSV. |
| GET | `/inventory/replenishment-proposals` | `inventory.replenishment.read` | Propose order quantities using available plus incoming stock. |
| GET | `/inventory/health` | `inventory.stock.read` | Projection cursor lag, expired reservation backlog, and latest reconciliation state. |

## Procurement

| Method | Route | Permission | Purpose |
|---|---|---|---|
| GET/POST | `/procurement/suppliers` | `procurement.supplier.read/manage` | List or create suppliers. |
| POST | `/procurement/suppliers/import` | `procurement.supplier.manage` | Validate and import suppliers from CSV. |
| POST | `/procurement/requisitions` | `procurement.requisition.manage` | Create purchase requisition. |
| POST | `/procurement/requisitions/{id}/submit` | `procurement.requisition.manage` | Submit requisition. |
| POST | `/procurement/requisitions/{id}/approve` | `procurement.requisition.approve` | Bind approved Foundation approval request. |
| GET/POST | `/procurement/purchase-orders` | `procurement.purchase_order.read/manage` | List open or create draft purchase orders. |
| POST | `/procurement/purchase-orders/{id}/submit` | `procurement.purchase_order.manage` | Submit draft PO. |
| POST | `/procurement/purchase-orders/{id}/approve` | `procurement.purchase_order.approve` | Approve PO with Foundation approval evidence. |
| POST | `/procurement/goods-receipts` | `procurement.receipt.manage` | Partial receipt with accepted/quarantine/damaged/rejected inspection disposition. |
| POST | `/procurement/supplier-returns` | `procurement.return.manage` | Return received stock to supplier through immutable stock posting. |
| POST | `/procurement/supplier-bills` | `procurement.bill.match` | Register supplier bill references. |
| POST | `/procurement/supplier-bills/{id}/match` | `procurement.bill.match` | Persist three-way-match result and balanced accounting instruction when matched. |
| POST | `/procurement/landed-costs` | `procurement.landed_cost.manage` | Allocate landed cost by quantity, value, or validated manual allocation. |
| POST | `/procurement/landed-costs/{id}/post` | `procurement.landed_cost.manage` | Revalue receipt cost layers and inventory value. |
| GET | `/procurement/reports/supplier-performance` | `procurement.report.read` | Supplier receipt lead-time and exception evidence. |
| GET | `/procurement/health` | `procurement.report.read` | Approval queue, overdue lines, unmatched bills, and receipt exceptions. |

## Error model

The API uses the Foundation `PlatformError` envelope and fails closed:

- `400 VALIDATION_FAILED` — malformed UUID, quantity, money, state input, CSV, body size, or unsupported enum.
- `403 PERMISSION_DENIED` — missing permission or persisted approval.
- `404 NOT_FOUND` — tenant-scoped resource absent.
- `409 CONFLICT` / `VERSION_CONFLICT` — invalid state transition, quantity/tolerance breach, or stale optimistic version.
- `500 INTERNAL_ERROR` — unexpected failure; request/trace IDs remain available in logs and audit evidence.

## Frozen MOD-A boundary

`itemId` and `variantId` are UUID values from `CatalogItemReferenceV1`. MOD-B does not import or foreign-key to unmerged MOD-A tables. Contract fixtures/simulators may provide these identifiers until the approved catalog integration is merged.
