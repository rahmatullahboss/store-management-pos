# MOD-D Local Schema and Application Upgrade Runbook

## Scope

This runbook covers the browser-local `operation_log`, `operation_log_meta` and `pos_local` IndexedDB stores used by MOD-D. The operation log is durable business evidence; projections are replaceable caches.

## Non-negotiable rules

- Never delete, clear or rewrite a pending operation to make an upgrade succeed.
- Never move the upload cursor past a pending operation.
- Never rebuild `operation_log` from a projection or server response.
- Projection rebuilds may replace `pos_local` content only after the operation log and metadata are readable.
- A browser tab must not overwrite another tab's local transaction. The IndexedDB adapter uses a revision compare-and-swap and raises `ConcurrentLocalStoreMutationError` on conflict.
- Do not show local success until the operation and cursor metadata transaction has committed.

## Pre-upgrade checks

1. Read a durable snapshot containing operations, upload/download cursors, projection version and application version.
2. Count pending operations and record the oldest pending age.
3. Verify every pending `payloadVersion` is readable and writable by the target application version.
4. Verify the device is not revoked and the local clock is within the approved offline tolerance.
5. Confirm storage pressure leaves enough capacity for migration and at least the configured safety reserve.
6. Close duplicate POS tabs or complete their transactions before starting the upgrade.

If any pending operation uses an unsupported payload version, block the upgrade and restore the compatible application. Do not transform the envelope without a reviewed, deterministic migration.

## Clean-state upgrade

1. Open the database at the target schema version.
2. Create missing stores and indexes only inside `upgradeneeded`.
3. Preserve `operation_log` and `operation_log_meta` even when they are empty.
4. Seed the new projection metadata version without inventing an upload/download cursor.
5. Rebuild catalog, barcode, price, tax, permission and country-capability projections from authoritative feeds.
6. Run one local commit, restart the application and confirm the operation remains pending and ordered.

## Upgrade with pending operations

1. Freeze new checkout commands while the compatibility check runs.
2. Keep the current operation records and exact bigint sequences unchanged.
3. Apply additive local schema changes; do not clear an object store.
4. Update application/projection metadata only in a strict-durability transaction.
5. Restart the application and verify:
   - pending count is unchanged;
   - device/operation keys are unchanged;
   - sequence ordering is unchanged;
   - upload cursor did not advance;
   - optional receipt/payment evidence remains present;
   - the next operation receives the next exact sequence.
6. Resume upload in bounded order and record explicit server outcomes.

## Projection corruption

1. Stop checkout actions that depend on the corrupt projection.
2. Preserve `operation_log` and `operation_log_meta`.
3. Record the corrupt projection name, version and content hash without logging customer or payment secrets.
4. Delete and rebuild only the affected `pos_local` projection from the authoritative incremental/full feed.
5. Reassess stale price, tax, promotion, permission and country-capability versions before enabling checkout.
6. Route already completed local operations to reconciliation; never recalculate or rewrite their receipt snapshot.

## Multi-tab conflict

When `ConcurrentLocalStoreMutationError` occurs:

1. Stop the losing tab's command.
2. Refresh its durable snapshot from IndexedDB.
3. Re-evaluate the original intent against the refreshed operation log.
4. Replay only with the same device/operation ID and identical request hash.
5. If content differs, require a new operation ID and explicit cashier confirmation.

## Storage pressure

- Warn before the configured reserve is reached.
- Block new offline operations before IndexedDB quota exhaustion.
- Preserve all committed operations and upload the oldest pending batch first.
- Do not compact or purge unresolved records.
- Move the cashier to a supervised online register when safe capacity cannot be restored.

## Rollback

Roll back the application only to a version that can read every pending payload version. Do not downgrade the local database destructively. If the application cannot read the current schema, restore a compatible build and ship a forward corrective migration.

## Required evidence

- clean-state open and schema creation;
- restart after local commit;
- pending-operation upgrade compatibility block;
- supported upgrade with unchanged pending count and sequence;
- projection rebuild without operation loss;
- storage-pressure refusal with atomic rollback;
- multi-tab revision conflict detection;
- exact sequence serialization beyond JavaScript safe integer range.
