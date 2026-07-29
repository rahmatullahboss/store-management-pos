# MOD-D — POS, Cash, Offline and Hardware Handoff

**Checkpoint date:** 2026-07-29  
**Repository:** `rahmatullahboss/store-management-pos`  
**Git branch:** `module/pos-cash-offline-v1`  
**Assigned worktree:** `.worktrees/pos-cash-offline`  
**Activation baseline:** `6badafe06a9e0013d12ba036160c915b48fe1c13`  
**Neon branch:** `dev/module-pos-cash-offline`  
**Workpack state:** `active`

## Activation evidence

- PR #25 was merged to `main` at `6badafe06a9e0013d12ba036160c915b48fe1c13` after core, design, Neon preview/recovery and Cloudflare gates passed.
- The remote branch `module/pos-cash-offline-v1` exists and compares identical to the exact secured `main` activation baseline: zero commits ahead and zero commits behind.
- Required `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, programme execution plan, activation policy, programme board, MOD-D workpack and POS/offline/hardware architecture were reviewed.
- MOD-D remains one whole-workpack assignment. POS, cash, offline sync, hardware, migrations, APIs, UI, tests, observability and documentation are not delegated to small implementation agents.
- Existing unrelated work has not been reset, discarded, overwritten or force-pushed.

## Verification still required in the execution workspace

- Verify or create the fixed local worktree `.worktrees/pos-cash-offline` without touching dirty unrelated work.
- Verify or create the isolated non-production Neon branch `dev/module-pos-cash-offline` and record its branch ID.
- Bootstrap the assigned Neon branch from the approved integrated Wave 1 schema and run clean migration validation before database implementation.

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

## First implementation checkpoint

1. Define checkout, cash-event and offline-operation state machines with exact, append-only invariants.
2. Publish module-owned POS checkout, shift/cash event, operation envelope, sync result, receipt snapshot and device-health contracts.
3. Add deterministic POS/CASH migrations and tenant/RLS/idempotency tests.
4. Implement the durable local operation-log boundary before presenting local success.
5. Build online checkout first, then controlled offline acceptance, reconciliation and hardware capability adapters.

## Current checkpoint

Remote activation is complete. Execution-workspace and Neon verification are the only activation prerequisites still unverified; implementation must preserve that distinction until evidence is committed.
