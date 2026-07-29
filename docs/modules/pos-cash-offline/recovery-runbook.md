# MOD-D Recovery Runbook

## Recovery objective

Recover POS, cash, offline synchronization and hardware delivery without deleting or rewriting durable business evidence. Every recovery action must preserve the original device/operation ID, request hash, receipt snapshot, cash-event chain, request/trace IDs and business date.

## First response

1. Stop only the unsafe action; do not shut down a readable local operation log unnecessarily.
2. Capture the exact application commit, device/register/store scope, operation ID, current state and sanitized error code.
3. Determine whether the failure occurred before local commit, after local commit, during upload, after server application or during receipt/hardware delivery.
4. Preserve browser-local IndexedDB and server audit/outbox evidence.
5. Route unknown, rejected, deferred and review-required states to reconciliation rather than inventing success.

## Crash or refresh around local commit

- Before commit: the cashier may retry with a new operation only after confirming no durable record exists.
- After commit: reload the IndexedDB snapshot and replay with the same device/operation ID and identical request hash.
- A changed replay is an idempotency conflict and must not overwrite the existing record.
- Do not show success until the durable record is visible after transaction completion.

## Lost server response

1. Keep the local operation pending.
2. Upload again with the same device/operation ID, sequence, payload hash and authorization reference.
3. Treat a duplicate server outcome as successful replay evidence, not a second business effect.
4. Store the terminal outcome before advancing the upload cursor.
5. Never skip a pending sequence when moving the cursor.

## Unknown payment state

1. Block checkout retry and new payment intent creation.
2. Query MOD-E payment status with the original idempotency key/provider reference.
3. If accepted or captured, resume sale, stock, cash and journal orchestration idempotently.
4. If declined, persist the explicit rejection while retaining the local receipt evidence.
5. If still unknown, keep reconciliation blocked and alert on age; never assume failure.

## Final-unit or stale-projection conflict

- Reconcile competing stock claims in deterministic server order.
- Accept the claim that consumes the available unit; reject later claims explicitly with `FINAL_UNIT_STOCK_CONFLICT`.
- Preserve the rejected register's local receipt snapshot.
- Stale price/tax/promotion may enter explicit review according to policy.
- Stale permission or country-capability projection blocks the operation.
- Do not silently recalculate and replace a completed local receipt.

## Receipt allocation failure

- Exhausted, expired, wrong-scope or revoked allocation blocks new offline receipt issuance.
- Country capability requiring online fiscalization blocks offline issuance.
- Never recycle or renumber an allocated receipt.
- Obtain a new signed scoped range before resuming.

## Offline backlog

1. Confirm pending count, oldest age, storage pressure, authorization expiry, receipt capacity, clock drift and revocation.
2. Upload in bounded sequence order.
3. Persist per-operation accepted, duplicate, rejected, deferred or review-required outcomes.
4. Advance the cursor only through operations with durable non-pending outcomes.
5. Rebuild projections independently; pending operation envelopes remain untouched.

## Cash recovery

- Reconstruct expected cash exclusively from append-only events.
- Never edit or delete an event to repair a variance.
- Use a linked reversal for an incorrect historical event.
- Use an approved adjustment for a valid manual correction.
- A non-zero close variance requires the reviewed approval contract and immutable blind count.
- Preserve shift, currency and scale consistency.

## IndexedDB corruption or multi-tab conflict

- On revision conflict, stop the losing command and refresh the durable snapshot.
- On projection corruption, rebuild only `pos_local` from authoritative feeds.
- If `operation_log` cannot be read, preserve the browser profile/storage image and escalate; do not create a replacement log that hides pending operations.
- Restore only with a compatible application that can read all pending payload versions.

## Hardware delivery recovery

- Printer failure is a delivery failure, not checkout rollback.
- Reprint from the immutable semantic receipt snapshot with the same receipt number.
- Unknown terminal result follows payment-status recovery.
- Revoked, expired, changed or out-of-scope hardware commands must not execute.
- Never include card or provider secrets in support evidence.

## Database and migration recovery

1. Verify manifest order and checksums.
2. Apply the complete Foundation → Wave 1 → MOD-D chain on the assigned non-production branch.
3. Re-run the chain to prove replay safety.
4. Verify forced RLS, append-only triggers, command-function execution grants and zero direct runtime writes.
5. Use forward corrective migrations; do not destructively reverse immutable evidence.

## Completion evidence

A recovery drill is complete only when:

- pending operations and receipt snapshots are preserved;
- no duplicate sale/payment/stock/cash/journal effect was created;
- upload and download cursors are consistent;
- every unresolved operation is visible in reconciliation;
- cash reconstructs from immutable events;
- audit/outbox and sanitized trace evidence exist;
- the exact tested commit passes core, design, Neon preview/recovery, MOD-D Neon and Cloudflare gates.
