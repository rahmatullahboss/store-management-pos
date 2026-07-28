# Foundation Gate Status

**Checkpoint date:** 2026-07-28
**Git branch:** `program/foundation-v1`
**Assigned worktree:** `.worktrees/foundation-v1`
**Neon branch:** `dev/foundation-v1`

Foundation remains **active**. MOD-A through MOD-G remain blocked.

| Gate | Status | Evidence / blocker |
|---|---|---|
| Repository layout and module ownership | Pass | Monorepo shells, `tooling/module-boundaries.json`, 7-workpack/16-schema boundary check |
| Direct Neon HTTP and request-scoped WebSocket adapters | Code/build/unit pass; credentialed benchmark pending | Pinned `@neondatabase/serverless` adapters include HTTP one-shot, HTTP batch and request-scoped Client/Pool cleanup/failure handling; p50/p95/p99 and concurrency evidence still require the automated credentialed run |
| Tenant/RLS isolation | Pass on dedicated and disposable Neon branches | Alpha/Beta contexts each saw only their own store and user; 23 platform tables use forced RLS |
| Deterministic Foundation migrations | Pass through `FND-0004` | Checksummed manifest and migration registry; fresh empty-parent branch applied `FND-0001`–`FND-0004` plus synthetic fixtures |
| Isolated Neon PR branch lifecycle | Manual pass; automated CI pending | Disposable branch `test/foundation-gate-manual-20260728` (`br-sweet-mode-axxx2970`) was created from empty non-production `main`, migrated, verified and deleted; repository secret `NEON_API_KEY` is still required for the PR workflow |
| Shared exact primitives v1 | Pass | UUIDv7, Money, Quantity, Currency, Locale, Timezone and BusinessDate tests |
| Contract pack v1 | Pass | Typed contracts, JSON schema, fixtures and compatibility tests |
| Identity/RBAC/approval/device/audit baseline | Pass in code/unit/Neon | OIDC/JWKS contract, RS256 verification, issuer/audience/time validation, MFA assurance, separate provider/internal identity and database-backed membership/session/device revocation |
| Audit/outbox/inbox/idempotency | Pass locally and on Neon | Reference replay produced one record/audit/outbox; inbox duplicate claim was rejected; session revocation replay produced one revocation/audit/outbox |
| Architecture boundaries | Pass | No cycles or private persistence imports |
| UI shells and route permissions | Pass | Admin/POS shells and permission filtering tests |
| Security/license/SBOM | Pass | Secret/license checks, pinned lockfile, CycloneDX SBOM and connected dependency audit |
| Cloudflare preview/canary | Skeleton only | No authorised non-production Worker deployment, bundle, CPU or memory run is available in this execution environment |
| Benchmarks | Partial | Functional database evidence is complete; direct-driver p50/p95/p99, cold wake, concurrency and Worker limits remain pending |
| Backup/restore | Partial | Multiple fresh empty-parent rebuilds and cleanup passed; PITR/history restore and reconciliation remain pending |
| Final Foundation handoff | Checkpoint updated | `docs/agent-handoffs/FOUNDATION-handoff.md` |

## Manual preview lifecycle evidence

The disposable Neon branch `test/foundation-gate-manual-20260728` (`br-sweet-mode-axxx2970`) was created from the untouched non-production parent `main` (`br-spring-grass-ax3ptydv`). It applied `FND-0001` through `FND-0004` and synthetic development fixtures, then verified:

- migration registry exactly `FND-0001`, `FND-0002`, `FND-0003`, `FND-0004`;
- 23 forced-RLS platform tables;
- Alpha store/user visibility `LON-01` / `Alpha Owner`;
- Beta store/user visibility `DHK-01` / `Beta Owner`;
- first reference command not replayed, second replayed with the same ID;
- exactly one reference record, audit event and outbox event;
- inbox first claim true and duplicate claim false;
- active session not revoked, first revocation true, duplicate revocation false and revoked session true;
- exactly one session revocation, audit event and outbox event.

All verification effects were rolled back and the disposable branch was deleted. The parent branch was not migrated.

## Remaining gate blockers

1. Configure repository secret `NEON_API_KEY`; project `twilight-boat-26805962` and empty parent `br-spring-grass-ax3ptydv` are pinned in CI. Run automated preview create → migrate → seed → integration → benchmark → delete.
2. Capture direct Neon HTTP, HTTP batch and request-scoped WebSocket p50/p95/p99, cold-wake, failure and concurrency measurements from the committed benchmark runner.
3. Deploy non-production Cloudflare API/jobs shells and capture bundle size, CPU and memory evidence.
4. Perform a Neon PITR/history restore drill and reconcile migrations, reference records, audit and outbox.
5. Read and reconcile ignored `.ai-bridge` instructions from the actual mounted worktree when that checkout is available.
