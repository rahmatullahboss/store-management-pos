# Backup and restore acceptance policy

Status: disposable full-registry rehearsal implemented; production acceptance pending
Date: 2026-07-31
Owner candidate: platform-sre

## Purpose

This policy defines the evidence required before the Store Management platform can claim that production backup and restore is accepted. It separates the automated disposable Neon CI drill from production retention, portability, regional recovery, access-control and operational approval.

The current CI drill is useful evidence, but it is not a production backup policy and it does not authorize a production restore.

## Current disposable CI capability

`npm run ci:neon-recovery` creates a disposable Neon project and:

1. discovers all manifest-registered platform migrations in deterministic order;
2. verifies every migration SHA-256 before database access;
3. applies all 17 manifests and 64 registered migrations sequentially;
4. loads only the synthetic Foundation seed;
5. verifies the exact `platform.schema_migrations` sequence;
6. creates a synthetic reference record with matching immutable audit, outbox and idempotency evidence;
7. records an exact database checkpoint;
8. performs a destructive mutation only inside the disposable project;
9. restores the root branch to the checkpoint while preserving the corrupted branch under a temporary backup name;
10. proves the restored tenant marker, audit event, outbox event, idempotency record and migration registry reconcile exactly;
11. records restore-ready, reconciliation and total recovery timing;
12. deletes the disposable project and fails the job when cleanup cannot be confirmed.

The companion generic Neon preview uses the same shared migration-registry executor, so preview and recovery no longer have separate Foundation-only migration semantics.

The schema-v2 recovery artifact contains bounded timing, manifest/migration/module totals, aggregate marker controls and disposable lifecycle identifiers required for cleanup audit. It must never contain a database connection URI, API key, SQL contents, production row values or raw provider failure payload.

## Candidate production objectives

The following are candidate acceptance targets and require product, platform, security, finance and operations approval before they become contractual:

| Objective | Candidate target | Acceptance evidence |
|---|---:|---|
| Database recovery point objective | 5 minutes or less | provider retention configuration and checkpoint-to-restore proof |
| Database recovery time objective | 30 minutes or less | measured restore-ready plus reconciliation time |
| Logical export recovery point | 24 hours or less | encrypted scheduled export and successful isolated import |
| Recovery rehearsal frequency | quarterly and before material data-model launch | retained signed evidence and owner acceptance |
| Evidence retention | at least 12 months | immutable access-controlled archive |
| Emergency acknowledgement | 15 minutes | paging and escalation test |

A stricter legal, fiscal, contractual or regional requirement overrides these candidate targets.

## Required production backup controls

Production launch requires an approved record of:

- Neon project, branch, region, retention window and responsible owner;
- point-in-time recovery coverage and any plan-tier limitations;
- encrypted scheduled logical exports for provider-independent portability;
- encryption key ownership, rotation, revocation and recovery;
- least-privilege backup/export identity separated from application runtime identity;
- immutable evidence retention and access-review schedule;
- deletion schedule, legal hold and incident-preservation procedure;
- regional recovery target and data-residency approval;
- monitoring for backup/export failure, retention drift and restore failure;
- production maintenance, communication and change-approval procedure.

Production credentials must not be available to pull-request workflows. Staging credentials must not be capable of restoring or deleting production resources.

## Restore authorization

A production restore requires:

1. an incident or approved change record;
2. two-person authorization from platform operations and the designated business/data owner;
3. an isolated new recovery project or branch—never an in-place overwrite of the live production branch;
4. confirmation of the intended recovery point and expected data-loss window;
5. read-only validation before any traffic cutover;
6. explicit cutover approval and rollback plan;
7. preservation of the prior production branch until post-cutover acceptance and retention policy permit deletion.

Finance-impacting restoration also requires finance-operations acceptance. Security-impacting restoration requires security-operations acceptance.

## Mandatory post-restore controls

The recovery target cannot receive production traffic until all applicable controls pass:

- exact 17-manifest/64-migration registry equality and checksum evidence;
- tenant and row-level-security isolation;
- identity, session, step-up, recovery and MFA table consistency without reactivating expired sessions;
- immutable inventory ledger to projection reconciliation;
- inventory reservation and availability reconciliation;
- balanced journal headers and lines in transaction and base currency;
- payment, settlement, receivable, payable and bank-reconciliation control totals;
- audit, outbox, inbox and idempotency consistency;
- document/object references and integrity hashes where applicable;
- application health, protected reads and approved synthetic command journeys;
- privacy-safe observability and alert delivery.

Posted journals, immutable ledgers, audit events and outbox envelopes must not be edited or deleted to make reconciliation pass. Corrections use approved forward fixes, reversals, adjustments or projection rebuilds.

## Rehearsal evidence

Every accepted rehearsal records:

- source Git SHA and verified migration registry;
- recovery point and destructive mutation observation;
- restore request, branch-ready and reconciliation timestamps;
- measured restore-ready, reconciliation and total recovery durations;
- aggregate control results and exact-registry status;
- cleanup status for temporary resources;
- artifact digest, workflow run and reviewer acceptance;
- deviations, remediation owner and due date.

Evidence summaries must not display project/branch/marker IDs, database URLs, provider credentials, customer identifiers, SQL row values or raw error payloads.

## Failure and escalation

A rehearsal fails when:

- any checksum or migration marker differs;
- the destructive mutation is not observed;
- the restore does not return the exact checkpoint state;
- audit, outbox or idempotency marker evidence differs;
- inventory or financial reconciliation fails;
- a temporary recovery resource cannot be deleted;
- evidence contains credentials or production row values;
- measured objectives exceed the approved threshold without an accepted exception.

On failure, production promotion remains blocked. Platform-sre owns containment and evidence preservation; inventory-operations, finance-operations and security-operations join according to the affected control. A rerun is not acceptance until the root cause and corrective action are documented.

## Production acceptance checklist

Production backup/restore remains **not accepted** until all of the following are approved:

- [ ] production retention and PITR window;
- [ ] encrypted logical export and isolated import proof;
- [ ] RPO/RTO targets and escalation ownership;
- [ ] regional recovery and data-residency plan;
- [ ] production monitoring and paging;
- [ ] two-person restore authorization workflow;
- [ ] full production-class isolated rehearsal;
- [ ] inventory and finance reconciliation acceptance;
- [ ] evidence retention and legal-hold policy;
- [ ] controlled launch approval.
