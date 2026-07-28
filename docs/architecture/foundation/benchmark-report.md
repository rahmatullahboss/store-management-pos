# Foundation Benchmark and Verification Report

**Date:** 2026-07-28

## Completed evidence

| Check | Result |
|---|---|
| Clean dependency installation | Passed in connected CI with exact lockfile |
| Format/lint/typecheck/build | Passed locally and in connected CI; compiler is repository-owned TypeScript `5.8.3` |
| Unit, architecture, contract and UI tests | 14 passed, 0 failed |
| Request-scoped Client success/rollback/cleanup simulation | Passed |
| OIDC/JWKS signature and claim validation | Passed unit tests, including issuer, audience, time, algorithm, MFA and revocation failure cases |
| Idempotency duplicate replay | Passed locally and on Neon |
| Inbox duplicate delivery | Passed locally and on Neon |
| Tenant/store/user RLS isolation | Passed on Neon for two synthetic tenants |
| Session/device/membership revocation | Passed on Neon; direct runtime table DML denied and function path preserved |
| Audit/outbox immutability and duplicate effects | Passed on Neon |
| Route permission filtering | Passed |
| Module ownership/cycle enforcement | Passed for 7 workpacks and 16 schemas |
| Secret/licence checks and CycloneDX SBOM | Passed in connected CI; runtime and development dependencies are registered |
| Dependency audit | Passed in connected CI at high severity threshold |
| Dedicated non-production Neon project/branch | Created and migrated |
| Fresh empty-parent rebuild and cleanup | Passed through `FND-0004` on a disposable branch and deleted |
| Parent/child schema diff | Reviewed; expected Foundation and reserved module namespace additions only |

## Live Neon evidence

The long-lived development branch `dev/foundation-v1` contains `FND-0001` through `FND-0005`. It has 23 forced-RLS platform tables and verified two-tenant isolation, idempotent reference effects, inbox duplicate handling and membership/session/device revocation behavior.

A lifecycle run used disposable branch `test/foundation-gate-manual-20260728` (`br-sweet-mode-axxx2970`) created from the untouched non-production `main` parent. `FND-0001` through `FND-0004` and synthetic fixtures were applied from empty state. The run reproduced Alpha/Beta isolation, one-record/one-audit/one-outbox reference replay effects, inbox first/duplicate claims and one-revocation/one-audit/one-outbox session effects. Verification writes were rolled back and the branch was deleted.

That manual lifecycle establishes rebuildability through `FND-0004` and cleanup. `FND-0005` was then applied and verified on the long-lived development branch: runtime direct insert privilege is false, function execution privilege is true, direct insert is rejected and duplicate-safe one/audit/outbox effects remain intact. Its published checksum matches the manifest.

## Connected CI evidence

Commit `742afaa` passed exact dependency installation, format, lint, architecture boundaries, typecheck, build/tests, secret scan, licence register, SBOM generation and dependency audit. The Neon preview job also passed installation and build. It stopped before branch creation because connected CI supplied an empty `NEON_API_KEY`; project and parent branch IDs were present.

## Deferred runtime benchmarks

The local container has no usable outbound DNS path to the Neon endpoint/package registry, so it cannot truthfully produce direct-driver latency numbers. No p50/p95/p99, cold-wake or concurrency result is claimed from that runtime.

`tooling/scripts/benchmark-neon.mjs` and `tooling/scripts/neon-preview-ci.mjs` are committed to run with the pinned `@neondatabase/serverless` dependency. The workflow creates a preview branch from non-production `main`, validates manifest checksums, applies migrations and fixtures, runs direct HTTP/WebSocket integration and latency benchmarks, and deletes the branch in a `finally` cleanup path. Only repository secret `NEON_API_KEY` remains required because project and parent IDs are pinned.

Cloudflare Worker bundle, CPU and memory evidence remains pending because no authorised Cloudflare deployment target is connected. Hyperdrive has not been introduced; any comparison occurs only after the direct Neon baseline is recorded.
