# Foundation Benchmark and Verification Report

**Date:** 2026-07-28
**Verified CI code checkpoint:** `bdcb2b649e63edd74d6db0233471e7b7a16ac6cd`
**Successful Foundation CI run:** `30327509153`

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
| Automated empty-parent Neon lifecycle | Passed `FND-0001` through `FND-0005`, fixtures, integration, benchmark and cleanup |
| Parent/child schema diff | Reviewed; expected Foundation and reserved module namespace additions only |
| Cloudflare Worker upload/deploy/version preview | Passed using Wrangler `4.114.0`; ephemeral Worker and preview alias created and cleaned up |
| Cloudflare API health | Passed with `status=healthy`, `service=api`, `databaseMode=direct-neon`, `region=cloudflare-global` |

## Automated Neon lifecycle evidence

Connected Foundation CI used repository secret `NEON_API_KEY` with project `twilight-boat-26805962` and empty parent `br-spring-grass-ax3ptydv`. The preview job created an isolated branch, validated migration checksums, applied `FND-0001` through `FND-0005`, loaded synthetic fixtures, ran integration and direct-driver benchmark commands, and deleted the branch in cleanup. The long-lived development branch and untouched parent were not reset or replaced.

The committed benchmark currently records p50, p95 and maximum latency for HTTP one-shot, HTTP transaction batch and request-scoped WebSocket transactions. A durable artifact containing the exact Neon values, plus explicit p99, concurrency and genuine cold-wake measurements, remains to be added before the benchmark gate is final.

## Cloudflare runtime evidence

The successful rerun of Foundation CI run `30327509153` produced a retained Cloudflare evidence artifact and then deleted the ephemeral Worker.

| Measurement | Result |
|---|---:|
| Wrangler version | `4.114.0` |
| Uploaded script | 164,831 bytes |
| Reported gzip upload | 52.34 KiB |
| Source map | 402,328 bytes |
| Wrangler Worker startup time | 4 ms |
| Public preview first probe | 823.15 ms |
| Remote Cloudflare preview first request | 2,288.97 ms |
| Sequential requests | 20 |
| Sequential p50 / p95 / max | 58.56 / 85.14 / 92.76 ms |
| Concurrent requests | 20 |
| Concurrent p50 / p95 / max | 165.53 / 217.20 / 246.88 ms |

The benchmark used an authenticated `wrangler dev --remote` proxy so execution occurred on Cloudflare infrastructure even when public preview routing was intermittently unavailable during earlier attempts. In the successful run, the public version-preview alias was also reachable. CI now serializes Foundation runs, supervises Wrangler process groups and removes stale `store-pos-fnd-*` Workers.

Wrangler's 4 ms startup figure is build/runtime startup evidence, not per-invocation CPU time. Per-invocation CPU/wall-time telemetry and a defensible memory measurement or documented platform substitute remain pending. Preview URLs do not expose normal Worker logs, so CPU evidence should be captured from the deployed ephemeral Worker or Workers Observability before cleanup.

## Remaining benchmark work

1. Persist exact Neon benchmark output as a CI artifact and add p99, concurrent-load and genuine cold-wake measurements.
2. Capture Cloudflare per-invocation CPU/wall time and memory evidence or document an approved measurable proxy.
3. Keep Hyperdrive optional; compare it only after the direct Neon benchmark is complete.
