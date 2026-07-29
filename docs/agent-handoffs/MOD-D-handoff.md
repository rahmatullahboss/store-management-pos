# MOD-D — POS, Cash, Offline and Hardware Handoff

**Checkpoint date:** 2026-07-29  
**Repository:** `rahmatullahboss/store-management-pos`  
**Git branch:** `module/pos-cash-offline-v1`  
**Assigned worktree:** `.worktrees/pos-cash-offline`  
**Approved secured Wave 1 baseline:** `6badafe06a9e0013d12ba036160c915b48fe1c13`  
**Neon project:** `twilight-boat-26805962`  
**Neon branch:** `dev/module-pos-cash-offline` (`br-rapid-river-axoz0rfs`)  
**Neon parent branch:** `br-spring-grass-ax3ptydv`  
**Database:** `neondb`  
**Workpack state:** `active`

## Safety and activation evidence

- PR #25 was merged to `main` at `6badafe06a9e0013d12ba036160c915b48fe1c13` after core verification, design verification, Neon preview, Neon recovery and Cloudflare preview/runtime passed.
- The existing remote MOD-D branch contained no module implementation commits and was fast-forwarded to the secured baseline without force.
- The assigned Neon branch is verified as an isolated, non-default child of `br-spring-grass-ax3ptydv`; production credentials and production data are prohibited.
- Required repository, product, design, execution, activation, programme-board and MOD-D workpack instructions were reviewed.
- Existing unrelated work has not been reset, discarded, overwritten or force-pushed.
- MOD-D remains one complete-workpack assignment; no small implementation agents are used.

## Owned implementation

- `modules/pos/**`
- `modules/cash/**`
- `modules/offline/**`
- `apps/pos-web/src/modules/**`
- `apps/hardware-agent/**`
- `database/modules/pos/**`
- `database/modules/cash/**`
- `docs/modules/pos-cash-offline/**`
- PostgreSQL schemas `pos` and `cash`
- local schemas `pos_local` and `operation_log`

## Invariants in force

- Local success is never shown before the operation envelope is durable.
- A device/operation ID is idempotent across sale, stock, payment, cash and journal effects.
- Expected cash is reconstructed exclusively from append-only cash events.
- Unknown payment state blocks blind retry.
- Offline conflicts preserve completed local receipt evidence and require an explicit outcome.
- Projection rebuilds preserve pending operations.
- Application and local-schema updates cannot strand incompatible unsynchronised operations.
- PAN, CVV and reusable provider secrets are never stored locally.
- Offline permissions, risk limits and receipt-number allocations are scoped and expire.

## First implementation checkpoint

1. Publish module-owned checkout, cash-event, offline-operation, sync-result, receipt-snapshot and device-health contracts.
2. Add approved Wave 1 fixtures/simulators without importing unmerged module code.
3. Add deterministic POS/CASH migration manifests with forced RLS, exact values, append-only cash-event enforcement and idempotency keys.
4. Implement the durable local operation-log boundary before presenting local success.
5. Verify clean migration, duplicate replay, lost-response and tenant-isolation behavior before continuing to UI.

## Current checkpoint

Git branch and isolated Neon branch verification are complete. Activation evidence is committed in `docs/architecture/mod-d/activation-checkpoint.md`. Contract publication and deterministic POS/CASH migrations are the next coherent implementation checkpoint.
