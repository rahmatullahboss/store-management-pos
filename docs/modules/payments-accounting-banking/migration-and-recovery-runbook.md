# MOD-E Migration and Recovery Runbook

## Migration order

`tooling/scripts/migration-manifests.mjs` discovers and validates the complete platform registry in deterministic order. The current integrated tree contains 17 manifests and 64 registered migrations spanning Foundation, catalog, pricing, tax, inventory, procurement, customer, sales, fulfillment, payments, accounting, banking, POS, cash, localization, reporting and integration.

`tooling/scripts/apply-migration-registry.mjs` reads and verifies every migration SHA-256 before the first database query, applies the exact registry sequentially, loads the synthetic Foundation seed only after all migrations succeed and requires exact ordered equality with `platform.schema_migrations`. Duplicate migration IDs, checksum drift, missing markers, extra markers and reordered markers fail closed.

## Forward-only corrections

Applied migration files are never edited in place. A defect is corrected by a new prefix-owned migration. Posted financial facts are corrected with reversal or adjustment records, not destructive SQL.

## Preview verification

`ci:neon-preview` uses the shared full-registry executor to apply all 17 manifests and 64 registered migrations to a disposable branch, loads only synthetic Foundation seed data, runs integration tests, records connection/cold-wake performance and deletes the branch. Preview and recovery therefore use one checksum and marker contract rather than separate Foundation-only loops.

## Recovery drill

`ci:neon-recovery` applies the shared 17-manifest/64-migration registry in a disposable project before the point-in-time restore exercise. Its schema-v2 evidence records the checkpoint, destructive mutation, restore request, branch readiness, reconciliation completion, restore-ready duration, reconciliation duration and total recovery duration. Recovery succeeds only when:

- the pre-mutation synthetic marker, audit event, outbox event and idempotency record each reconcile exactly;
- the destructive mutation is observed before restoration;
- the restored tenant state matches the exact checkpoint;
- the complete ordered migration registry matches exactly;
- the disposable project is deleted.

This disposable drill proves migration and PITR mechanics; it is not production backup acceptance. Production retention, encrypted logical export, regional recovery, approved RPO/RTO, monitoring, two-person authorization and a production-class rehearsal remain governed by `docs/architecture/staging/backup-restore-acceptance.md`.

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
