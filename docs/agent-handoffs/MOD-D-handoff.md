# MOD-D — POS, Cash, Offline and Hardware Handoff

**Checkpoint date:** 2026-07-29  
**Repository:** `rahmatullahboss/store-management-pos`  
**Git branch:** `module/pos-cash-offline-v1`  
**Assigned worktree:** `.worktrees/pos-cash-offline`  
**Approved secured Wave 1 baseline:** `6badafe06a9e0013d12ba036160c915b48fe1c13`  
**Draft review:** PR `#27` targeting `program/integration-v1`  
**Neon project:** `twilight-boat-26805962`  
**Neon branch:** `dev/module-pos-cash-offline` (`br-rapid-river-axoz0rfs`)  
**Neon parent branch:** `br-spring-grass-ax3ptydv`  
**Database:** `neondb`  
**Workpack state:** `active`

## Safety and activation evidence

- PR #25 was merged to `main` at `6badafe06a9e0013d12ba036160c915b48fe1c13` after core verification, design verification, Neon preview, Neon recovery and Cloudflare preview/runtime passed.
- The MOD-D branch was fast-forwarded to the secured Wave 1 baseline without force, reset or rebase.
- The assigned Neon branch is an isolated, non-default child of `br-spring-grass-ax3ptydv`; production credentials and production data are prohibited.
- Required repository, product, design, execution, activation, programme-board and MOD-D workpack instructions were reviewed.
- Existing unrelated work has not been reset, discarded, overwritten or force-pushed.
- MOD-D remains one complete-workpack assignment; no small implementation agents are used.

## Implemented checkpoints

### Contracts and domain

- POS checkout, cart, register-session, receipt, device-health and provider-neutral hardware contracts.
- Exact-money cash shift and append-only cash-event contracts with reversal and approval controls.
- Offline operation envelopes, deterministic outcomes, synchronization contracts and durable local operation-log boundaries.
- Frozen cross-module references preserve Wave 1 contract boundaries without importing unmerged module implementations.

### Database and persistence

- Deterministic `POS-0001` through `POS-0005` and `CSH-0001` through `CSH-0002` migration chains.
- Forced tenant RLS, command-only runtime access, migration checksums, transactional markers and orphan-file validation.
- Immutable receipt, checkout identity, offline outcome, device-health, cash-event, cash-count and shift-closure evidence.
- Scoped, expiring offline authorization, device/register/store controls and receipt-delivery evidence.
- POS and cash SQL repositories with exact-value validation, idempotent replay, approval validation and reconciliation reads.

### Application surfaces

- POS API routes for devices, sessions, carts, checkout, offline upload and reconciliation.
- Cash APIs for shift open, event append/list and blind close with variance approval.
- Keyboard-accessible POS register surface with barcode/search, cart, tender, offline-state and unknown-payment blocking cues.
- Provider-neutral local hardware-agent runtime with tenant/store/register/device scope, command expiry, revocation, capability/action allowlists and concurrent idempotency.
- Sensitive PAN/CVV/PIN/track/provider-secret fields are rejected before adapter execution and from adapter output.

### Offline safety

- Durable operation commit precedes local success.
- Pending operations survive restart, projection rebuild and supported schema/application upgrades.
- Duplicate, changed replay, out-of-order, rejected, deferred and review-required outcomes remain explicit.
- Offline conflicts do not rewrite completed receipt evidence.
- Unknown payment state blocks blind retry.

## Verification evidence

- Repository-wide migration validation includes MOD-D manifests and enforces contiguous IDs, checksums, transactions, forced RLS and invariant triggers.
- Unit and architecture coverage includes exact totals, immutable replay envelopes, cash reconstruction, durable restart/rebuild, device scope, hardware failure and POS accessibility states.
- GitHub Foundation CI run `30438276187`: format, lint, architecture boundaries, strict TypeScript, migration validation, build/tests, secret scan, licence register, SBOM and high-severity dependency audit passed.
- GitHub Foundation Design CI run `30438276177`: browser, accessibility and deterministic design evidence passed.
- Neon preview, Neon recovery, Cloudflare preview/runtime and isolated MOD-D Neon rehearsal remain required on a stable final head; superseded runs cancelled by later pushes do not count as final evidence.

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

## Remaining completion gates

1. Complete a stable-head Neon preview, Neon recovery, Cloudflare preview/runtime and isolated MOD-D Neon rehearsal.
2. Finish the required outage-volume, final-unit stock, stale projection, receipt exhaustion, local-storage pressure and low-end performance evidence.
3. Complete POS reconciliation/admin operational surfaces where required by the workpack.
4. Publish operations, recovery, hardware support and local-schema upgrade runbooks under `docs/modules/pos-cash-offline/`.
5. Record final performance, accessibility, recovery and database evidence; update the program board and this handoff.
6. Keep PR #27 draft until every completion gate is satisfied, then perform controlled serial integration after review.
