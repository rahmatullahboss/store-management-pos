# Foundation Benchmark and Verification Report

**Date:** 2026-07-28

## Completed in this checkpoint

| Check | Result |
|---|---|
| Format/lint/typecheck/build | Passed locally |
| Unit, architecture, contract and UI tests | 11 passed, 0 failed |
| Request-scoped Client success/rollback/cleanup simulation | Passed |
| Idempotency duplicate replay | Passed locally and on Neon |
| Inbox duplicate delivery | Passed locally and on Neon |
| Tenant/store/user RLS isolation | Passed on Neon for two synthetic tenants |
| Audit/outbox immutability | Passed on Neon |
| Route permission filtering | Passed |
| Module ownership/cycle enforcement | Passed for 7 workpacks and 16 schemas |
| Secret/license checks and CycloneDX SBOM | Passed locally and in CI |
| Dedicated non-production Neon project/branch | Created and migrated |
| Fresh empty-database recovery rebuild | Passed in temporary project; verified and deleted |

## Live Neon evidence

Foundation migrations `FND-0001` through `FND-0003`, synthetic fixtures, 22 forced-RLS tables, reference-slice duplicate replay and inbox duplicate claim were executed against `dev/foundation-v1`. Exact query results are recorded in `docs/agent-handoffs/FOUNDATION-handoff.md`.

The parent Neon branch was not migrated. Schema comparison shows expected Foundation/module namespace additions on the child branch. A separate temporary project rebuilt the complete Foundation schema and synthetic evidence from empty state, verified RLS/idempotency/audit/outbox behavior, and was deleted.

## Deferred runtime benchmarks

Connected GitHub Actions installed the pinned dependency from the committed lockfile, passed the complete verification suite and passed `npm audit --audit-level=high`. The current execution runtime still cannot deploy a Cloudflare Worker. Therefore p50/p95/p99 direct-driver latency, cold compute wake-up, Worker CPU/memory and bundle limits are not claimed as passed.

`tooling/scripts/benchmark-neon.mjs` and the isolated preview branch CI workflow are committed. CI must install dependencies, create a preview branch from `dev/foundation-v1`, run migrations, fixtures, HTTP/WebSocket integration and latency benchmarks, then delete the branch. Missing CI secrets now fail rather than silently skip the database gate.

Hyperdrive was not introduced. Any comparison follows only after the direct Neon baseline is measured.
