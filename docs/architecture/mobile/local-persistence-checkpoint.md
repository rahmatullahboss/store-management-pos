# MOB-01 Encrypted Local Persistence Checkpoint

- **Checkpoint date:** 2026-07-29
- **Branch:** `module/store-companion-mobile-v1`
- **Canonical formatted source head:** `3bedec23e812677203af6a00169e73523dba701f`
- **Status:** implementation and runtime tests complete; exact canonical-head CI reconciliation in progress

## Purpose

This checkpoint establishes the non-authoritative local persistence boundary for Store Companion. It does not create a second business database and does not permit direct access to Neon or module-owned PostgreSQL tables.

The local database may retain only:

- rebuildable server projections;
- user drafts;
- committed pending operations;
- authoritative operation results already returned by an owning server module;
- incremental-sync cursors;
- local schema migration evidence.

Price, tax, stock, legal numbering, payment, accounting and fulfilment effects remain server-authoritative.

## Encryption and key boundary

- `sqlite3` `3.5.0` is pinned and its workspace build hook selects `sqlite3mc`.
- SQLite3MultipleCiphers is verified at runtime through `PRAGMA cipher` before any local schema is opened.
- The cipher probe uses an isolated file-backed database because encrypted in-memory databases are unsupported by the selected native library.
- Database key material is exactly 32 random bytes encoded as 64 lowercase hexadecimal characters.
- Keys are generated with `Random.secure`, stored only through `flutter_secure_storage` `10.3.1`, and re-read after first write before use.
- Public key diagnostics are always `LocalEncryptionKey(redacted)`.
- Key values are not returned by any public API, stored in SQLite, written to logs or included in exception messages.
- Android application backup is disabled to prevent restoring encrypted preferences into a different platform keystore.
- Opening an encrypted file with the wrong key fails closed.

## Physical schema separation

Schema version `1` creates separate strict tables:

| Table | Classification | Purge rule |
|---|---|---|
| `local_projections` | rebuildable server snapshots | may be independently purged and refetched |
| `local_drafts` | unsent user work | never removed by projection cleanup |
| `pending_operations` | durable idempotent commands | retained until terminal server outcome or explicit governed discard |
| `operation_results` | immutable authoritative server outcomes | retained separately from commands; mismatched replay rejected |
| `sync_cursors` | opaque incremental-sync positions | partition scoped; reset only by an explicit resync workflow |
| `local_schema_migrations` | local migration evidence | append-only by schema version |

Tables use strict typing, JSON validity checks, composite partition keys, idempotency uniqueness, result-to-operation foreign keys and dispatch/query indexes.

## Partition boundary

Every row includes an opaque user/tenant/workspace partition reference. The same encrypted file can contain multiple partitions without allowing one partition to read another partition's draft, operation, result, cursor or projection.

Workspace changes remain governed by the session boundary:

1. stop synchronization;
2. clear presentation state;
3. lock or purge restricted data as required;
4. resolve the new opaque partition;
5. fetch a fresh server-validated bootstrap before presenting data.

## Operation invariants

- Operation IDs and idempotency keys are unique per partition.
- Payloads and results must be JSON objects and are canonicalized before storage.
- Transition validation reuses `LocalOperationTransitions` from the sync engine.
- Attempt counts cannot move backwards.
- A terminal operation cannot return to upload.
- Authoritative results are stored transactionally with the operation state update.
- Exact duplicate authoritative replay is accepted without mutation.
- A replay with different status, payload or trace evidence fails closed.
- Unknown external state is never converted into blind retry.
- Destructive local migration is blocked while any non-terminal pending operation exists.

## Executable evidence produced before canonical formatting

Mobile Foundation run `30471343735`, job `90642110046`, on source head `b0d5beea54bb507f5762af90d9c0bb77bf528bd0` proved:

- dependency resolution passed;
- canonical formatter completed;
- `flutter analyze` passed;
- all unit, widget, cipher, restart, wrong-key, partition, purge, idempotency, transition, replay, migration-guard and JSON-validation tests passed;
- the only failed step was the intentional committed-source comparison because two newly added Dart files required canonical formatting.

The trusted formatter then produced commit `3bedec23e812677203af6a00169e73523dba701f`. Its diff from the reviewed human checkpoint contained only:

- `mobile/packages/local_data/lib/src/local_database.dart` formatting;
- `mobile/apps/store_companion/test/local_database_test.dart` formatting.

No schema semantics, dependencies, platform source or programme-owned files changed in that formatter commit.

## Required reconciliation before marking complete

The checkpoint becomes complete only after a human-authored follow-up head confirms:

- exact pinned Flutter/Dart toolchain;
- committed lockfile unchanged;
- canonical formatting has no diff;
- analyzer passes;
- all local persistence and existing mobile tests pass;
- Android development, staging and production-identity debug builds still pass with SQLite3MultipleCiphers native assets;
- root format/lint/architecture/typecheck/tests/security/licence/SBOM/audit gates pass;
- Cloudflare and Neon non-production evidence remains green.

## Remaining M3 work after reconciliation

- application-support path adapter and validated per-partition filename mapping;
- explicit storage-pressure policy and projection eviction limits;
- attachment staging with checksums and resumable upload state;
- migration rehearsal from future schema versions while preserving pending work;
- revocation-driven database lock/purge orchestration;
- background scheduling adapters with bounded retries and platform constraints;
- crash/interruption testing around transaction boundaries and file replacement;
- repository/view-model wiring without exposing raw SQLite rows to UI code.
