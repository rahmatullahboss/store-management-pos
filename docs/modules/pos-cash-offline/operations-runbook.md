# MOD-D Operations and Recovery Runbook

## Safety rules

- Never delete or rewrite a committed local operation, receipt snapshot, cash event or synchronization outcome.
- Never blindly retry a payment whose provider result is unknown.
- Never repair a cash variance by editing historical events; use an approved adjustment or reversal.
- Preserve request ID, trace ID, device ID, operation ID, business date and original timestamps in every recovery action.
- Use the assigned non-production Neon branch for rehearsal. Do not apply module migrations directly to a production branch.

## Unknown payment result

1. Stop checkout completion and show the unknown state explicitly.
2. Keep the original operation envelope and provider reference durable.
3. Query payment status through the MOD-E recovery contract using the original idempotency key.
4. If captured/accepted, resume downstream sale, stock, cash and journal orchestration idempotently.
5. If declined, mark the explicit outcome without deleting the local receipt evidence.
6. If still unknown, keep the operation blocked and expose it in reconciliation; do not create another payment intent.

## Offline backlog or synchronization failure

1. Confirm the local operation log remains readable and pending operations are durable.
2. Check authorization expiry, receipt-range availability, device revocation, clock drift and storage pressure.
3. Upload in operation order with stable device/operation IDs; accept duplicate server outcomes as replay evidence.
4. Record each server outcome as accepted, rejected or review-required.
5. Preserve rejected operations and their receipt snapshots; route them to reconciliation.
6. Rebuild projections only from authoritative feeds while retaining the operation log and pending envelopes.

## Cash variance

1. Freeze shift closure changes and retain the blind count.
2. Reconstruct expected cash from append-only events: opening float, cash sales/refunds, paid-in/out, safe drops and reversals.
3. Confirm currency and scale match the shift.
4. Investigate missing source references, duplicate idempotency keys and unpaired reversal events.
5. For a valid non-zero variance, obtain a separate `cash.variance` approval before closing.
6. Correct historical mistakes with an approved reversal/adjustment event; never update or delete the original event.

## Device revocation, drift or storage pressure

- Revoked device: block new operations immediately, preserve pending envelopes and allow controlled export/recovery only.
- Excess clock drift: block time-sensitive offline authorization and receipt allocation until the clock is corrected and health is acknowledged.
- Storage pressure: stop new offline operations before durable capacity is exhausted; upload pending operations or move to a supervised online register.
- Register reassignment: close/suspend active sessions first and enforce device/register/store scope consistency.

## Printer or hardware-agent failure

1. Treat printing as a render/delivery failure, not a checkout rollback.
2. Preserve the immutable semantic receipt snapshot and content hash.
3. Retry through a compatible printer profile or request a reprint with `pos.receipt.reprint`.
4. Drawer, scanner, scale, display, terminal and fiscal-device failures must degrade by declared capability; unsupported actions remain blocked.
5. Do not store provider secrets or card data in hardware-agent logs.

## Migration and recovery

1. Verify manifest identity, ordering and SHA-256 checksums.
2. Apply Foundation, MOD-A, MOD-B, MOD-C, MOD-E, then MOD-D POS/CASH manifests in deterministic order.
3. Run the same apply command again; it must be replay-safe and report all expected migration IDs.
4. Confirm every POS/CASH table has enabled and forced RLS.
5. Confirm `store_app_runtime` has zero direct write grants.
6. Verify security-definer command functions deny `PUBLIC` and grant only reviewed runtime execution.
7. Validate store/register/device/legal-entity scope triggers and append-only triggers.
8. Record evidence in the MOD-D handoff and preserve the rehearsal artifact.

## Escalation evidence

Capture only non-secret evidence:

- tenant, store, register and device IDs;
- operation/idempotency key and request/trace IDs;
- migration IDs and checksums;
- explicit payment/sync/cash states;
- sanitized error code and phase;
- queue depth, oldest pending age, clock drift and storage pressure;
- hardware capability and health state.

Never capture PAN, CVV/CVC, track data, reusable provider tokens, client secrets or raw credentials.
