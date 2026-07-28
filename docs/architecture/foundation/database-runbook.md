# Foundation Database Runbook

## Migration order

1. Create an isolated Neon branch from the approved parent.
2. Apply `FND-0001`, `FND-0002`, `FND-0003`, `FND-0004`, then `FND-0005` from `database/foundation/manifest.json`.
3. Optionally load `database/foundation/seeds/dev.sql` only in non-production.
4. Verify migration registry, schemas, roles and RLS policies.
5. Run tenant-isolation, idempotency, outbox/inbox, identity-revocation privilege, duplicate-effect and reference-slice checks.
6. Compare schema against the approved parent before integration.

## Failure handling

- Do not edit a partially applied migration in place after review.
- Preserve the failed branch for diagnosis or create a fresh branch and rerun from the parent.
- Production uses forward-fix/expand-contract migrations; no destructive automatic rollback.
- Never reset a shared branch or copy production personal data into preview/test branches.

## Health checks

Monitor connection latency, transaction duration, lock/statement timeouts, outbox age, inbox failures, RLS errors, migration drift and storage growth.

## Restore validation

Restore into an isolated branch/environment, verify schema registry and checksums, reconcile authoritative records with projections, then replay unpublished outbox events. A backup is not verified until restoration and reconciliation complete.
