# Foundation Benchmark and Verification Report

**Date:** 2026-07-28
**Technical evidence checkpoint:** `ca37a707f05452456a56215371d89562fa68f5f8`
**Successful Foundation CI run:** `30329600694`

## Completed evidence

| Check | Result |
|---|---|
| Clean dependency installation | Passed in connected CI with exact lockfile |
| Format/lint/typecheck/build | Passed; compiler is repository-owned TypeScript `5.8.3` |
| Unit, architecture, contract and UI tests | 14 passed, 0 failed |
| OIDC/JWKS and revocation validation | Passed unit and live Neon checks |
| Tenant/store/user RLS isolation | Passed for two synthetic tenants across 23 forced-RLS tables |
| Idempotency, audit, outbox and inbox effects | Passed locally and on Neon |
| Automated empty-parent Neon lifecycle | Passed `FND-0001` through `FND-0005`, fixtures, integration, benchmark and cleanup |
| Direct Neon benchmark artifact | Passed with p50/p95/p99, concurrent load, scale-to-zero cold wake and rollback recovery |
| Disposable Neon PITR drill | Passed destructive mutation, historical restore, reconciliation and project cleanup |
| Cloudflare deploy/runtime lifecycle | Passed deploy, preview, health, latency, GraphQL runtime metrics and cleanup |
| Cloudflare bundle/runtime limits evidence | Passed bundle, CPU, wall-time and memory collection |
| Parent/child schema diff | Reviewed; expected Foundation and reserved module namespace additions only |

## Neon direct-driver evidence

Foundation CI run `30329600694` created branch `preview/pr-program-foundation-v1-30329600694` from the untouched non-production parent, applied checksummed migrations `FND-0001` through `FND-0005`, loaded fixtures, ran integration tests, waited until the compute reached scale-to-zero, measured the wake request, ran the direct-driver benchmark and deleted the branch. The lifecycle report recorded `cleanupDeleted=true`.

| Measurement | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|
| HTTP one-shot, 30 sequential | 16.05 ms | 17.38 ms | 17.82 ms | 17.82 ms |
| HTTP transaction batch, 30 sequential | 16.42 ms | 17.77 ms | 17.94 ms | 17.94 ms |
| WebSocket transaction, 30 sequential | 90.55 ms | 117.10 ms | 161.62 ms | 161.62 ms |
| HTTP one-shot, 20 concurrent | 61.37 ms | 70.85 ms | 77.96 ms | 77.96 ms |
| WebSocket transaction, 10 concurrent | 107.49 ms | 125.80 ms | 125.80 ms | 125.80 ms |

Additional results:

- initial compute connection: 73.36 ms;
- genuine scale-to-zero first query: 601.28 ms;
- intentional transaction failure, rollback and connection reuse: passed in 60.74 ms;
- PostgreSQL: `17.10 (4f20678)`.

## Neon PITR and reconciliation evidence

The CI recovery job created disposable project `store-pos-fnd-recovery-30329600694` (`old-dust-80137345`), applied all five migrations and fixtures, then created one reference record with one matching audit event, outbox event and completed idempotency record. It captured a checkpoint timestamp, changed the synthetic tenant name to a corruption marker and deleted the reference record.

The root branch was restored to the captured timestamp while the corrupted branch state was preserved under `before-recovery-30329600694`. After restore, reconciliation confirmed:

- tenant name returned to `Synthetic Alpha Retail`;
- reference record count returned from 0 to 1;
- audit, outbox and idempotency counts remained exactly 1;
- migration registry remained exactly `FND-0001` through `FND-0005`;
- the disposable project was deleted with `cleanupDeleted=true`.

## Cloudflare runtime evidence

Foundation CI run `30329600694` deployed ephemeral Worker `store-pos-fnd-30329600694` using Wrangler `4.114.0`, created the `gate` version-preview alias, validated health and latency, queried `workersInvocationsAdaptive` while the Worker still existed, then deleted the Worker in an unconditional cleanup step.

| Measurement | Result |
|---|---:|
| Script bundle | 164,831 bytes |
| Source map | 402,328 bytes |
| Public preview probe | 294.21 ms |
| Remote-runtime first request | 1,275.42 ms |
| Sequential 20-request p50 / p95 / max | 30.89 / 47.77 / 59.26 ms |
| Concurrent 20-request p50 / p95 / max | 87.65 / 119.60 / 119.82 ms |
| Invocation CPU p99 | 1,117 microseconds |
| Invocation wall-time p99 | 1,512 microseconds |
| Invocation memory p99 | 1,740,822 bytes |
| Analytics request count / errors | 2 / 0 |

The health response reported `healthy`, `api`, `direct-neon` and `cloudflare-global`. CPU, wall-time and memory values come from Cloudflare GraphQL analytics, not client-side latency inference.

## Operational cleanup

Canceled CI attempts had left disposable `preview/pr-*` Neon branches because process cancellation can prevent application-level `finally` cleanup. Seven stale branches were identified and deleted manually. The latest successful lifecycle deleted its own branch, and the Neon project now contains only `main` and `dev/foundation-v1`. Cloudflare runs are serialized, stale `store-pos-fnd-*` Workers are removed before deployment and the active Worker is deleted with an `always()` cleanup step.

## Benchmark conclusion

The direct Neon baseline and Cloudflare Worker runtime evidence are complete for the Foundation Gate. Hyperdrive remains optional and may be evaluated later as a benchmark comparison; it is not required to activate module workpacks.
