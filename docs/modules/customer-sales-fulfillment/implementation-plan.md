# MOD-C Customer, Sales and Fulfillment Implementation Plan

Status: complete — handoff ready
Owner: single complete-workpack agent
Foundation Git SHA: `57f21e8c14e27ce3ad96a862cf6de82c2c6cd27c`
Git branch: `module/customer-sales-fulfillment-v1`
Worktree: `.worktrees/customer-sales-fulfillment`
Neon branch: `dev/module-customer-sales-fulfillment` (`br-muddy-star-axo1uogc`)
Neon parent: `dev/foundation-v1` (`br-autumn-pine-axuo502u`)

## Guardrails

- Implement only MOD-C-owned customer, sales, fulfillment, module UI and documentation paths, plus uniquely named MOD-C test/evidence files.
- Do not import MOD-A, MOD-B or MOD-E implementation code. Consume frozen `packages/contracts/src/v1` types and module-owned deterministic simulators.
- Keep payment, invoice, fulfillment, order and return states independent.
- Preserve immutable calculation snapshots and original return allocation provenance.
- Require explicit tenant, legal entity, store, warehouse and business-date scope.
- Use idempotent commands, optimistic versions, outbox events, append-only audit and narrow permissions.

## Checkpoints

1. **Activation and architecture** — verify exact baseline, isolated Git/worktree/Neon branches, publish this plan, set tracker active, establish handoff log.
2. **Customer domain** — person/company profiles, contacts, addresses, tags/groups, consent history, duplicate detection/merge, credit profile and import/export contracts; customer migrations and tests.
3. **Sales domain** — quote versioning/conversion, order lifecycle, immutable price/tax snapshots, operational invoices/credit notes, deposits/layaway/preorder/backorder representation, credit approvals, document numbering and tests.
4. **Fulfillment and returns** — reservation orchestration, split pickup/delivery/shipping, picking/packing/shipping/delivery proof, return authorization/disposition/exchange/refund orchestration and tests.
5. **Application surfaces** — module API router/handlers, sales/customer/fulfillment admin views, permissions, approvals, audit/events, jobs, observability and dependency consumer fixtures.
6. **Database and live evidence** — apply CUS/SAL/FUL migrations to the isolated Neon branch; verify RLS, immutability, idempotency, concurrency, tenant isolation and query plans.
7. **Finish and handoff** — full verification, performance/accessibility evidence, tracker `handoff_ready`, final handoff, commits/push and draft integration PR.

## Test matrix

- Quote-to-order conversion and stale version rejection.
- Partial fulfillment/payment and backorder state separation.
- Return, exchange and partial refund allocation.
- Pickup, ship-from-store and split fulfillment transitions.
- Reservation conflict and duplicate command/event replay.
- Credit-limit approval and cancellation edge cases.
- Duplicate-customer merge with preserved historical identities.
- Concurrent document numbering.
- Tenant/location permission and RLS isolation.
- Large customer/order query indexes and bounded pagination.
- Frozen catalog/pricing/tax, inventory, payment, accounting and receipt contract fixtures.
- Responsive, keyboard, RTL and resilient admin UI states.

## Evidence policy

Every checkpoint ends with focused tests, `npm run verify`, a coherent commit, push, tracker evidence update and this handoff log update. Completion claims require fresh command output and live database evidence where applicable.
