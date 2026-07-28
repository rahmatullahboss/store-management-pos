# Foundation Gate Status

**Checkpoint date:** 2026-07-28
**Git branch:** `program/foundation-v1`
**Assigned worktree:** `.worktrees/foundation-v1`
**Neon branch:** `dev/foundation-v1`

Foundation remains **active**. MOD-A through MOD-G remain blocked.

| Gate | Status | Evidence / blocker |
|---|---|---|
| Repository layout and module ownership | Pass | Monorepo shells, `tooling/module-boundaries.json`, 7-workpack/16-schema boundary check |
| Direct Neon HTTP and request-scoped WebSocket adapters | Code + unit pass; live driver pending | Adapters and cleanup/failure tests pass; package installation/outbound driver execution unavailable in this runtime |
| Tenant/RLS isolation | Pass on dedicated Neon branch | Alpha/Beta each saw only their own tenant, store, legal entity and user; 22 forced-RLS tables |
| Deterministic Foundation migrations | Pass on dedicated Neon branch | `FND-0001`–`FND-0003`, checksummed manifest and migration registry |
| Isolated Neon PR branch lifecycle | Implemented; CI execution pending | `.github/workflows/foundation-ci.yml` and `neon-preview-ci.mjs`; required CI secrets must be configured |
| Shared exact primitives v1 | Pass locally | UUIDv7, Money, Quantity, Currency, Locale, Timezone, BusinessDate tests |
| Contract pack v1 | Pass locally | Typed contracts, JSON schema, fixture and compatibility test |
| Identity/RBAC/approval/device/audit baseline | Implemented | Foundation schema and permission-filtered app shells |
| Audit/outbox/inbox/idempotency | Pass locally and on Neon | One reference record/audit/outbox under replay; inbox duplicate claim rejected |
| Architecture boundaries | Pass locally | No cycles or private persistence imports |
| UI shells and route permissions | Pass locally | Admin/POS shells and permission test |
| Security/license/SBOM | Pass | Secret/license checks, pinned lockfile, CycloneDX SBOM and connected `npm audit` pass |
| Cloudflare preview/canary | Skeleton only | No authorized Cloudflare deployment/bundle/CPU/memory run in this runtime |
| Benchmarks | Partial | Functional DB evidence complete; HTTP/WS p50/p95/p99, cold wake and Worker limits pending |
| Backup/restore | Documented only | Restore drill remains pending |
| Final Foundation handoff | Checkpoint written | `docs/agent-handoffs/FOUNDATION-handoff.md` |

## Gate blockers

1. Configure `NEON_API_KEY`, `NEON_PROJECT_ID=twilight-boat-26805962`, and `NEON_PARENT_BRANCH_ID=br-autumn-pine-axuo502u`; execute preview create → migrate → seed → integration → benchmark → delete.
2. Run direct Neon HTTP, HTTP batch and request-scoped WebSocket latency/concurrency/cold-wake benchmarks.
3. Deploy non-production Cloudflare API/jobs shells and capture bundle, CPU and memory evidence.
4. Perform a Neon restore/history drill and reconcile migrations, reference records, audit and outbox.
5. Replace the development token verifier with the approved production identity-provider adapter and test MFA/session/device revocation before production readiness.
