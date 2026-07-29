# MOD-D Activation Checkpoint

## Status

MOD-D — POS, Cash, Offline and Hardware is active for isolated Wave 2 execution.

## Approved baseline

- Repository: `rahmatullahboss/store-management-pos`
- Git branch: `module/pos-cash-offline-v1`
- Git baseline: `6badafe06a9e0013d12ba036160c915b48fe1c13`
- Baseline meaning: Wave 1 integrated on `main`, followed by reviewed immutable GitHub Actions and trusted CI gate hardening.
- Worktree contract: `.worktrees/pos-cash-offline`
- Neon project: `twilight-boat-26805962`
- Neon branch: `dev/module-pos-cash-offline`
- Neon branch ID: `br-rapid-river-axoz0rfs`
- Neon parent branch ID: `br-spring-grass-ax3ptydv`

No production credentials, production data or production database branch is used.

## Ownership

This agent owns the complete workpack without sub-agents:

- register, session, cart and checkout;
- cash shifts and append-only cash events;
- durable local operation log and idempotent synchronization;
- signed offline authorization and risk limits;
- receipt snapshots and rendering requests;
- device/register enrollment, health and revocation;
- printer, drawer, scanner, scale, display, terminal and fiscal-device abstractions;
- APIs, UI, permissions, audit/events, migrations, tests, observability and runbooks.

Owned PostgreSQL schemas are `pos` and `cash`. Client-local schemas are `pos_local` and `operation_log`.

## Frozen dependencies

MOD-D consumes the integrated Wave 1 contracts from MOD-A, MOD-B, MOD-C and MOD-E. Shared contracts are not edited directly. Any missing or incompatible shared contract must use the documented contract-change request process; approved fixtures and simulators are used until serial integration.

## Non-negotiable invariants

1. A locally accepted operation is durable before success is shown.
2. The same device and operation ID cannot create duplicate business effects.
3. Expected cash is reconstructed exclusively from append-only cash events.
4. Unknown payment state blocks blind retry.
5. Offline conflict never silently rewrites or discards a completed local receipt.
6. Client projections remain rebuildable without deleting pending operations.
7. Application updates cannot strand incompatible unsynchronized operations.
8. Card PAN, CVV and reusable provider secrets are never stored locally.
9. Offline permissions, risk limits and receipt allocations expire and are scope-bound.

## First execution sequence

1. Publish module-owned POS, cash, offline, receipt and device contracts plus approved dependency simulators.
2. Add deterministic POS/CASH migrations with forced RLS, grants, immutable cash-event enforcement and idempotency keys.
3. Implement exact-value domain logic for register sessions, carts, checkout orchestration, shifts and reconciliation.
4. Implement the durable local operation log, projection versioning, upload/download cursors and conflict outcomes.
5. Compose authenticated APIs, worker jobs, permission-scoped POS/admin routes and hardware capability interfaces.
6. Complete online/offline cashier journeys, reconciliation console and resilient UI states under the shared Operations Ledger design system.
7. Run crash/replay, outage, conflict, payment-unknown, upgrade, device, hardware, performance and accessibility gates.

## Activation evidence

- Wave 1 release checkpoint: `30df99faf37278d5d6346a88f6fd0f5ced1c049b`
- CI hardening merge: `6badafe06a9e0013d12ba036160c915b48fe1c13`
- PR #25 gates: core verification, design verification, Neon preview, Neon recovery and Cloudflare preview/runtime passed.
- Git branch verified and fast-forwarded without force.
- Neon branch verified as an isolated non-default child of the approved parent.
