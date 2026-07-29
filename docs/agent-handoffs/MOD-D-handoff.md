# MOD-D — POS, Cash, Offline and Hardware Handoff

**Checkpoint date:** 2026-07-29  
**Repository:** `rahmatullahboss/store-management-pos`  
**Git branch:** `module/pos-cash-offline-v1`  
**Assigned worktree:** `.worktrees/pos-cash-offline`  
**Approved secured Wave 1 baseline:** `6badafe06a9e0013d12ba036160c915b48fe1c13`  
**Code-complete verification head:** `17f7c0887e6836ab895c5a339e179c96a618c360`  
**Draft review:** PR `#27` targeting `program/integration-v1`  
**Neon project:** `twilight-boat-26805962`  
**Neon branch:** `dev/module-pos-cash-offline` (`br-rapid-river-axoz0rfs`)  
**Neon parent branch:** `br-spring-grass-ax3ptydv`  
**Database:** `neondb`  
**Workpack state:** `handoff_ready`

## Safety and activation evidence

- PR #25 was merged to `main` at `6badafe06a9e0013d12ba036160c915b48fe1c13` after the secured Foundation gates passed.
- The MOD-D branch advanced from the secured Wave 1 baseline without force-push, destructive reset or rebase.
- The assigned Neon branch is an isolated, non-default child of `br-spring-grass-ax3ptydv`; production credentials and production data were not used.
- Required repository, product, design, execution, activation, programme-board and MOD-D workpack instructions were reviewed.
- Existing unrelated work was not reset, discarded or overwritten.
- MOD-D remained one complete-workpack assignment; no small implementation agents were used.

## Implemented checkpoints

### Contracts and domain

- POS checkout, cart, register-session, receipt, device-health and provider-neutral hardware contracts.
- Exact-money cash shift and append-only cash-event contracts with reversal and approval controls.
- Offline operation envelopes, deterministic outcomes, synchronization contracts and durable local operation-log boundaries.
- Frozen cross-module references preserve Wave 1 ownership boundaries without importing unmerged implementations.

### Database and persistence

- Deterministic `POS-0001` through `POS-0007` and `CSH-0001` through `CSH-0006` migration chains.
- Forced tenant RLS, command-only runtime access, transactional migrations, checksums, reviewed legacy-marker aliases and orphan-file validation.
- Database advisory locks serialize migration application and persistent MOD-D Neon rehearsals.
- Immutable receipt, checkout identity, offline outcome, device-health, cash-event, cash-count and shift-closure evidence.
- Scoped device/register/store/legal-entity controls, cash scope and reversal guards, expiring offline authorization and receipt-delivery evidence.
- POS and cash SQL repositories use reviewed security-definer commands instead of direct runtime table mutation.
- Runtime commands validate exact values, replay identity, approval scope, request store/register scope and audit/outbox evidence.
- POS/CASH functions revoke `PUBLIC` execution and expose only reviewed runtime functions.

### Application surfaces

- POS API routes for devices, sessions, carts, checkout, offline upload and reconciliation.
- Cash APIs for shift open, event append/list and blind close with variance approval.
- Keyboard-accessible POS register surface with barcode/search, cart, tender, offline-state and unknown-payment blocking cues.
- Admin reconciliation surface for rejected, review-required and unknown store-edge outcomes.
- Provider-neutral local hardware-agent runtime with tenant/store/register/device scope, command expiry, revocation, capability/action allowlists and concurrent idempotency.
- Sensitive PAN/CVV/PIN/track/provider-secret fields are rejected before adapter execution and from adapter output.

### Offline safety and resilience

- Durable operation commit precedes local success.
- Transactional IndexedDB persistence uses strict durability and revision-based concurrent-tab detection.
- Pending operations survive restart, projection rebuild and supported schema/application upgrades.
- Duplicate, changed replay, out-of-order, rejected, deferred and review-required outcomes remain explicit.
- Offline conflicts do not rewrite completed receipt evidence.
- Unknown payment state blocks blind retry.
- Stale price/tax/promotion projections require review; stale permission/country capability blocks checkout.
- Final-unit stock is accepted once in deterministic server order and competing receipt evidence is preserved.
- Receipt allocation is unique, scoped, expiring, country-capability aware and refuses exhaustion.
- Storage-pressure refusal is atomic and preserves earlier pending operations.

## Final verification evidence

- Code-complete head: `17f7c0887e6836ab895c5a339e179c96a618c360`.
- GitHub Foundation CI run `30440974406`: format, lint, architecture boundaries, strict TypeScript, build/tests, secret scan, licence register, SBOM and high-severity dependency audit passed.
- GitHub Foundation Design CI run `30440976531`: browser, accessibility and deterministic design evidence passed.
- Dedicated MOD-D Neon rehearsal job `90540030352` passed on the assigned branch after full Foundation → Wave 1 → POS/CASH migration application and replay.
- Neon recovery job `90540030356` passed.
- Cloudflare preview/runtime job `90540030095` passed deployment, runtime metrics, cleanup and evidence upload.
- Generic ephemeral Neon preview is intentionally skipped for the MOD-D PR because the quota-limited project already has an assigned persistent MOD-D branch and the dedicated full-chain rehearsal is the stronger module gate. Generic preview remains enabled on integration/main pushes.
- Independent assigned-branch verification found all 13 expected POS/CASH migrations, zero missing migrations, 17 forced-RLS POS/CASH tables, zero direct POS/CASH table-write grants for `store_app_runtime`, and zero `PUBLIC` execute grants on POS/CASH functions.
- Unit and architecture coverage includes exact totals, immutable replay envelopes, cash reconstruction, durable restart/rebuild, device scope, hardware failure, POS accessibility, migration serialization, Neon quota routing and assigned-branch rehearsal locking.
- A representative 24-hour outage test commits 1,440 operations, survives restart and uploads in bounded ordered batches without losing pending work.
- Low-end regression tests cover a 500-line register render, 10,000 deterministic stock claims and 5,000 unique scoped receipt allocations.

## Published operations documentation

- `docs/modules/pos-cash-offline/README.md` — architecture, ownership, data and invariant overview.
- `docs/modules/pos-cash-offline/permissions.md` — permission, approval and sensitive-data boundaries.
- `docs/modules/pos-cash-offline/operations-runbook.md` — unknown payment, offline backlog, cash variance, device/hardware failure, migration and recovery procedures.
- `docs/modules/pos-cash-offline/local-schema-upgrade-runbook.md` — durable local-schema upgrade, rollback and projection rebuild controls.
- `docs/modules/pos-cash-offline/recovery-runbook.md` — durable evidence, payment-unknown, cash reconstruction and disaster-recovery procedures.
- `docs/contracts/change-requests/CCR-0002-MOD-D-APPROVAL-REQUIRED-ERROR.md` — additive approval-required error contract proposed for integration review.

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

## Integration handoff

MOD-D is implementation-complete and handoff-ready. PR #27 must remain unmerged until the controlled serial integration review:

1. reviews and accepts or rejects `CCR-0002` without silently changing the shared error contract;
2. composes MOD-D routes, jobs and migrations after the approved Wave 1 baseline;
3. reruns integration-branch core, design, Neon recovery/full-chain database and Cloudflare gates;
4. records the integration checkpoint and updates the programme board to `integrated` only after those gates pass.
