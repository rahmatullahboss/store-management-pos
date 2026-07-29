# MOD-A Local Recovery Evidence

**Generated:** 2026-07-28T19:06:54.357Z
**Status:** passed

A disposable fresh PostgreSQL database exercised controlled failure and replay paths under `store_app_runtime`. The database was removed after capture.

| Check | Expected | Observed | Result | Detail |
|---|---|---|---|---|
| append_only_trigger | 55000 | 55000 | Pass | ERROR:  55000: price_tax_snapshots is append-only |
| effective_window_overlap | 23P01 | 23P01 | Pass | effective price list scope overlaps an existing published version |
| idempotency_hash_mismatch | P0001 | P0001 | Pass | idempotency key payload mismatch |
| idempotent_replay | replayed=true | replayed=t | Pass | Existing immutable snapshot returned |
| optimistic_version_conflict | 40001 | 40001 | Pass | price list version conflict |
| runtime_snapshot_mutation_denied | 42501 | 42501 | Pass | permission denied for table price_tax_snapshots |
| runtime_tenant_isolation | 0 rows | 0 rows | Pass | Beta tenant cannot see Alpha snapshot |

Machine-readable results are in [recovery-evidence.json](recovery-evidence.json).
