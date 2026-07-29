# MOD-D — POS, Cash, Offline and Hardware

## Purpose

MOD-D owns the store-edge runtime: register sessions, checkout, cash shifts, durable offline operations, device health and the local hardware boundary. It consumes the approved Wave 1 catalog, pricing, tax, inventory, customer, sales, payments and accounting contracts without importing unmerged module implementation.

## Runtime surfaces

- `modules/pos/**` — checkout, carts, receipts, device/register scope and SQL repository boundaries.
- `modules/cash/**` — append-only cash events, shift lifecycle, blind counts, variances and reversals.
- `modules/offline/**` — durable operation envelopes, replay, synchronization outcomes and projection rebuild safety.
- `apps/api/src/modules/pos/**` — authenticated POS, cash and synchronization HTTP endpoints.
- `apps/pos-web/src/modules/register/**` — cashier register surface and explicit offline/unknown/conflict states.
- `apps/hardware-agent/**` — capability-oriented printer, drawer, scanner, scale, display, terminal and fiscal-device boundary.
- PostgreSQL schemas `pos` and `cash`; local logical schemas `pos_local` and `operation_log`.

## Data and migration chain

The assigned isolated Neon branch is `dev/module-pos-cash-offline` (`br-rapid-river-axoz0rfs`). A clean rehearsal applies Foundation, integrated Wave 1 and then MOD-D manifests in deterministic order.

MOD-D migrations currently include:

- `POS-0001` store-edge tables and immutable snapshots;
- `POS-0002` carts and cart lines;
- `POS-0003` offline synchronization and security controls;
- `POS-0004` device/register scope;
- `POS-0005` store/legal-entity scope controls;
- `POS-0006` security-definer runtime commands and sensitive-payment-key rejection;
- `CSH-0001` shifts, append-only cash events, counts and closures;
- `CSH-0002` reversal controls.

All MOD-D tables use forced tenant RLS. `store_app_runtime` receives read access and narrowly scoped command-function execution, not direct table writes.

## Required invariants

1. A local success state is shown only after the operation envelope is durably committed.
2. The same device and operation ID cannot create duplicate sale, payment, stock, cash or journal effects.
3. Expected cash is reconstructed exclusively from append-only cash events.
4. Unknown payment state blocks blind retry and requires status recovery.
5. A rejected or review-required offline operation preserves the completed local receipt and explicit outcome evidence.
6. Projection rebuilds and application upgrades preserve pending operation envelopes.
7. PAN, CVV, track data, provider secrets and reusable payment tokens are rejected from local and server snapshots.
8. Offline permissions, limits and receipt allocations are signed, scoped and expiring.
9. Device, register, store and legal-entity scope must remain consistent across sessions, checkouts and offline authorization.

## Verification

The repository gate covers format, lint, architecture boundaries, strict TypeScript, build/tests, secret scanning, licence register, SBOM and dependency audit. MOD-D additionally runs an assigned Neon rehearsal that applies the complete migration chain twice, verifies all expected migration IDs, forced RLS and zero direct runtime writes.

See:

- `operations-runbook.md` for incident and recovery procedures;
- `permissions.md` for authorization boundaries;
- `docs/agent-handoffs/MOD-D-handoff.md` for checkpoint evidence and remaining gates.
