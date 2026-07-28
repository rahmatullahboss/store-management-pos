# Foundation Gate Status

**Checkpoint date:** 2026-07-28
**Git branch:** `program/foundation-v1`
**Assigned worktree:** `.worktrees/foundation-v1`
**Neon branch:** `dev/foundation-v1`
**Verified CI code checkpoint:** `bdcb2b649e63edd74d6db0233471e7b7a16ac6cd`

Foundation remains **active**. MOD-A through MOD-G remain blocked.

| Gate | Status | Evidence / blocker |
|---|---|---|
| Repository layout and module ownership | Pass | Monorepo shells, `tooling/module-boundaries.json`, 7-workpack/16-schema boundary check |
| Direct Neon HTTP and request-scoped WebSocket adapters | Automated baseline pass; final benchmark expansion pending | Pinned `@neondatabase/serverless` adapters and connected CI ran HTTP one-shot, HTTP batch and request-scoped WebSocket transactions; persist exact artifact and add p99, concurrency and genuine cold-wake evidence |
| Tenant/RLS isolation | Pass on dedicated and disposable Neon branches | Alpha/Beta contexts each saw only their own store and user; 23 platform tables use forced RLS |
| Deterministic Foundation migrations | Pass through `FND-0005` from empty parent | Checksummed manifest and migration registry were applied by automated preview CI from the untouched non-production parent |
| Isolated Neon PR branch lifecycle | Pass automated | Foundation CI created an isolated branch, applied `FND-0001`–`FND-0005`, seeded, integrated, benchmarked and deleted it using the configured repository secret |
| Shared exact primitives v1 | Pass | UUIDv7, Money, Quantity, Currency, Locale, Timezone and BusinessDate tests |
| Contract pack v1 | Pass | Typed contracts, JSON schema, fixtures and compatibility tests |
| Identity/RBAC/approval/device/audit baseline | Pass in code/unit/Neon | OIDC/JWKS contract, RS256 verification, issuer/audience/time validation, MFA assurance, separate provider/internal identity and database-backed membership/session/device revocation and function-only revocation writes |
| Audit/outbox/inbox/idempotency | Pass locally and on Neon | Reference replay produced one record/audit/outbox; inbox duplicate claim was rejected; session revocation replay produced one revocation/audit/outbox; direct runtime table insert is denied |
| Architecture boundaries | Pass | No cycles or private persistence imports |
| UI shells and route permissions | Pass | Admin/POS shells and permission filtering tests |
| Core GitHub CI | Pass | Clean `npm ci`, format, lint, boundaries, TypeScript 5.8.3 typecheck, build/tests, secret scan, licence register, SBOM and high-severity dependency audit passed |
| Security/licence/SBOM | Pass | Runtime and development dependencies are exact-pinned, registered, noticed and represented in CycloneDX; TypeScript is development-only/excluded from runtime scope |
| Parent/child schema review | Pass | Neon schema diff contains expected Foundation schemas, tables, functions, constraints, triggers, RLS policies, roles and privileges; parent remains untouched |
| Cloudflare preview/canary | Deployment/runtime pass; CPU/memory pending | Ephemeral Worker deploy, version preview alias, public health probe, authenticated remote-runtime benchmark, bundle metadata and cleanup passed in CI run `30327509153` |
| Benchmarks | Partial | Cloudflare bundle/startup/latency and Neon direct-driver baseline ran; exact Neon artifact, p99/cold-wake/concurrency and Cloudflare per-invocation CPU/memory remain |
| Backup/restore | Partial | Multiple fresh empty-parent rebuilds and cleanup passed; PITR/history restore and reconciliation remain pending |
| Final Foundation handoff | Checkpoint updated | `docs/agent-handoffs/FOUNDATION-handoff.md` |

## Automated preview lifecycle evidence

Foundation CI run `30327509153` completed all three jobs successfully after the Cloudflare rerun:

- core verification passed exact install, formatting, linting, architecture boundaries, typecheck, build/tests, secret and licence checks, SBOM and dependency audit;
- Neon preview created an isolated branch from non-production `main`, applied `FND-0001` through `FND-0005`, loaded fixtures, ran integration and benchmark commands and deleted the branch;
- Cloudflare uploaded and deployed the API Worker, created a version preview alias, validated the health contract on Cloudflare infrastructure, captured bundle/startup/latency evidence and deleted the ephemeral Worker.

Cloudflare evidence from the retained artifact: script 164,831 bytes, gzip upload 52.34 KiB, Wrangler startup 4 ms, sequential p50/p95/max 58.56/85.14/92.76 ms and 20-request concurrent p50/p95/max 165.53/217.20/246.88 ms. The health response reported `healthy`, `api`, `direct-neon` and `cloudflare-global`.

## `FND-0005` live hardening evidence

On `dev/foundation-v1`, the migration registry contains `FND-0001` through `FND-0005`. `store_app_runtime` has `INSERT=false` on `platform.session_revocations` and `EXECUTE=true` on `platform.revoke_identity_session`. A direct insert was rejected, while the function returned first=true, duplicate=false, revoked=true and exactly one revocation/audit/outbox effect. Test writes were rolled back. The published SQL SHA-256 exactly matches manifest value `ff50c6d4f607002540d9e3399ff7523de840ada8c6d0580ecf7f47a7b403ef00`.

## Remaining gate blockers

1. Persist exact Neon benchmark output and extend it with p99, concurrent-load and genuine cold-wake measurements.
2. Capture Cloudflare per-invocation CPU/wall-time and memory evidence, or approve and document a measurable memory-safety substitute.
3. Perform a Neon PITR/history restore drill and reconcile migrations, reference records, audit and outbox.
4. Read and reconcile ignored `.ai-bridge` instructions from the actual mounted worktree when that checkout is available.
