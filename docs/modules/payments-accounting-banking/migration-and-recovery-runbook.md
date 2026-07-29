# MOD-E Migration and Recovery Runbook

## Migration order

`tooling/scripts/migration-manifests.mjs` discovers and validates manifests in deterministic order:

1. Foundation (`FND-*`)
2. Payments (`PAY-*`)
3. Accounting (`ACC-*`)
4. Banking (`BNK-*`)

The runner verifies every file SHA-256 before execution and requires the expected `platform.schema_migrations` marker after execution. Duplicate migration IDs fail before database access.

## Forward-only corrections

Applied migration files are never edited in place. A defect is corrected by a new prefix-owned migration. Posted financial facts are corrected with reversal or adjustment records, not destructive SQL.

## Preview verification

`ci:neon-preview` now applies every discovered platform manifest to a disposable branch, loads only synthetic Foundation seed data, runs Foundation and MOD-E integration tests, records connection/cold-wake performance, and deletes the branch.

## Recovery drill

`ci:neon-recovery` now rebuilds every discovered platform migration in a disposable project before the point-in-time restore exercise. Recovery succeeds only when:

- the synthetic marker, audit event, outbox event and idempotency record reconcile exactly;
- the restored tenant state matches the checkpoint;
- the complete migration ID sequence matches the pre-mutation sequence;
- the disposable project is deleted.

## Local database proof

For a disposable PostgreSQL database containing all manifests:

```sh
DATABASE_URL='postgresql://...' npm run test:database:mod-e
```

The script uses `psql`, performs all assertions inside one transaction and ends with `ROLLBACK`. It must never be pointed at production.

## Emergency response

1. Stop new finance commands at the API boundary; reads remain available where safe.
2. Preserve provider request IDs, attempt IDs, payment intent IDs, posting group IDs and trace IDs.
3. Recover ambiguous provider state by status query before retrying any monetary command.
4. Compare payment captures/refunds, settlement gross-fee-adjustment-net, journal control totals and bank matches.
5. Correct accounting with a reversal or adjustment journal and reconciliation with a reversal record.
6. Restore from Neon history only for infrastructure/data-loss incidents, then rerun exact reconciliation controls before reopening writes.
