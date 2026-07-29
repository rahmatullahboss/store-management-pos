# MOD-D Operations and Recovery Runbook

## Safety rules

- Never delete or rewrite a committed local operation, receipt snapshot, cash event or synchronization outcome.
- Never blindly retry a payment whose provider result is unknown.
- Never repair a cash variance by editing historical events; use an approved adjustment or reversal.
- Preserve request ID, trace ID, device ID, operation ID, business date and original timestamps in every recovery action.
- Use the assigned non-production Neon branch for rehearsal. Do not apply module migrations directly to a production branch.
- Do not treat a cancelled or superseded workflow as release evidence; all required gates must pass on the exact stable release commit.

## Release gate

Before MOD-D can leave draft review, the exact head must pass:

1. `npm run verify`.
2. `npm run design:verify`.
3. `npm run ci:neon-preview`.
4. `npm run ci:neon-recovery`.
5. `npm run ci:neon-mod-d` against `dev/module-pos-cash-offline`.
6. `npm run ci:cloudflare-preview` and `npm run metrics:cloudflare-runtime`.

The MOD-D Neon rehearsal must confirm the complete Foundation through MOD-D migration chain, forced RLS on POS/CASH tables and zero direct runtime table-write grants.

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
4. Record each server outcome as accepted, duplicate, rejected, deferred or review-required.
5. Preserve rejected operations and their receipt snapshots; route them to reconciliation.
6. Rebuild projections only from authoritative feeds while retaining the operation log and pending envelopes.
7. Do not remove a pending envelope until a durable terminal or review outcome is stored.

## Receipt range exhaustion

1. Block further offline receipt issuance when the assigned range is exhausted, expired or revoked.
2. Preserve every already allocated receipt number and immutable snapshot.
3. Never recycle, renumber or overwrite a completed receipt.
4. Reconnect and obtain a new signed allocation before resuming offline issuance.
5. Escalate when country or fiscal rules require continuous numbering and connectivity cannot be restored.

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
5. Replay a hardware command only with the same idempotency key and identical content.
6. Reject expired, revoked, changed or out-of-scope commands.
7. Do not store provider secrets or card data in hardware-agent logs.

## Migration and recovery

1. Verify manifest identity, ordering and SHA-256 checksums.
2. Apply Foundation, MOD-A, MOD-B, MOD-C, MOD-E, then MOD-D POS/CASH manifests in deterministic order.
3. Run the same apply command again; it must be replay-safe and report all expected migration IDs.
4. Confirm every POS/CASH table has enabled and forced RLS.
5. Confirm `store_app_runtime` has zero direct write grants.
6. Verify security-definer command functions deny `PUBLIC` and grant only reviewed runtime execution.
7. Validate store/register/device/legal-entity scope triggers and append-only triggers.
8. Record evidence in the MOD-D handoff and preserve the rehearsal artifact.

## Observability

Use low-cardinality metric attributes such as module, operation, outcome, capability and status. Never use tenant IDs, customer IDs, checkout IDs, receipt numbers, payment references, device serials or free-text errors as metric attributes.

Monitor and retain redacted evidence for:

- durable local commit latency;
- pending-operation count and oldest age;
- synchronization outcomes and reconciliation backlog;
- unknown-payment age;
- device health, revocation, clock drift and storage pressure;
- hardware command outcome and duration;
- cash variance count and exact approved reporting totals.

## Deployment sequence

1. Confirm the candidate descends from secured Wave 1 SHA `6badafe06a9e0013d12ba036160c915b48fe1c13`.
2. Run manifest/checksum validation and the complete ordered migration rehearsal.
3. Run core, design, Neon preview/recovery, MOD-D Neon and Cloudflare gates on the exact stable commit.
4. Deploy the API and POS surfaces.
5. Deploy or update the signed hardware agent only after its capability profile is approved.
6. Exercise one online checkout, one approved offline checkout/replay, one cash open/close, one receipt reprint and one hardware degradation path using non-production data.
7. Confirm no pending operation, unknown payment or cash variance is silently suppressed.

## Rollback and correction

Do not use destructive reverse migrations. Roll the application back to a compatible version while preserving append-only POS, receipt, offline and cash evidence. Ship forward corrective migrations for schema defects. Correct business effects through approved reversal or adjustment operations linked to the original evidence.

## Escalation evidence

Capture only non-secret evidence:

- environment, region and exact commit SHA;
- tenant, store, register and device IDs;
- operation/idempotency key and request/trace IDs;
- migration IDs and checksums;
- explicit payment/sync/cash states;
- sanitized error code and phase;
- queue depth, oldest pending age, clock drift and storage pressure;
- hardware capability and health state.

Never capture PAN, CVV/CVC, PIN, track data, reusable provider tokens, client secrets, raw credentials or unrestricted terminal payloads.
