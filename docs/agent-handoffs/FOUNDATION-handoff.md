# FOUNDATION Checkpoint Handoff

**Checkpoint date:** 2026-07-28
**Repository:** `rahmatullahboss/store-management-pos`
**Git branch:** `program/foundation-v1`
**Assigned worktree:** `.worktrees/foundation-v1`
**Base SHA:** `1e9b2dbbb5a88ffd17a66a0d1df6f300b004f298`
**Current verified code checkpoint:** `742afaa1973a4a8d80a76a44b0638f825adc666a`
**Neon project:** `store-management-pos-nonprod` (`twilight-boat-26805962`)
**Neon branch:** `dev/foundation-v1` (`br-autumn-pine-axuo502u`)
**Neon parent:** `main` (`br-spring-grass-ax3ptydv`)
**Database:** `neondb`

## Safety and instruction review

- Root `AGENTS.md`, Foundation workpack, program board, architecture/security/testing documents and ADR-002 through ADR-006 were reviewed or created as applicable.
- `program/foundation-v1` was verified identical to `main` at the base SHA before implementation.
- The current execution environment did not expose the repository's real local checkout/worktree or ignored `.ai-bridge` files. No existing local state was reset, discarded or overwritten. GitHub remained the authoritative branch source.
- No production or unrelated Neon project was used. All database work used the dedicated non-production project.
- MOD-A through MOD-G were not started and remain blocked.

## Delegation and execution decision

- Foundation remains owned by one exclusive agent until every Foundation Gate item passes.
- Small-task agents are prohibited; Foundation work is not split into infrastructure, database, identity, UI, testing or documentation subagents.
- After Foundation is complete, one separate agent may own each complete MOD-A through MOD-G workpack.
- Module agents use isolated Git branches, worktrees and Neon branches and may not spawn internal subagents.
- Parallel development is allowed only after Foundation completion; integration and merging remain serial in the order MOD-A, MOD-B, MOD-C, MOD-E, MOD-D, MOD-F, MOD-G.
- Activation, ownership, blockers, checkpoints and evidence are tracked in `docs/agent-workpacks/program-board.yaml` and governed by `docs/agent-workpacks/MODULE-AGENT-ACTIVATION-POLICY.md`.

## Checkpoint implementation

- Production monorepo/workspace layout with API, jobs, admin and POS shells.
- Cloudflare Worker bindings/ports for R2, Queue, Workflow, KV/configuration and narrow coordination.
- Direct Neon HTTP, HTTP transaction-batch and request-scoped WebSocket Client/Pool adapters with transaction-local tenant context, timeouts, rollback and cleanup.
- Shared UUIDv7/opaque identifiers, exact Money/Currency/Quantity, Locale/Timezone/BusinessDate, actor/scope, optimistic concurrency, errors and pagination foundations.
- Contract pack v1 for catalog, pricing/tax, inventory, customer/sales, payment/refund, accounting, receipt/fiscal, event/inbox, file/job, health and reconciliation boundaries.
- Foundation PostgreSQL schema for tenancy hierarchy, users/memberships/RBAC, approvals, devices/register bindings, entitlements, support impersonation, audit, idempotency, outbox, inbox, DLQ, workflows, reference records and session revocations.
- Forced RLS and runtime/migration/reporting privilege separation; append-only audit, immutable outbox content and append-only session revocations.
- OIDC/JWKS identity baseline with RS256 allow-listing, exact issuer/audience validation, bounded token lifetime, MFA assurance, separate provider subject/internal user ID and fail-closed database revocation checks.
- Function-only session revocation writes with active actor/tenant-target membership validation and coupled audit/outbox effects.
- Repository-owned TypeScript `5.8.3` compiler pin with exact lock integrity, provenance, notice and SBOM representation.
- Disposable reference vertical slice: authenticated tenant command → request-scoped transaction/RLS → reference record → audit → outbox → inbox-backed consumer fixture → admin readback contract.
- Architecture boundary enforcement, unit/contract/UI tests, secret/licence checks, SBOM, preview branch lifecycle workflow, release-canary skeleton and operational documentation.

## Migrations

| Migration | SHA-256 | Purpose |
|---|---|---|
| `FND-0001-platform.sql` | `d1e88fc41fb94fab4e77aebd53a723288a212d4133aea6b7b9412f53e94581d2` | Schemas, roles, tenancy/RBAC/audit/event/job baseline |
| `FND-0002-rls.sql` | `b2789ce56ff1e31f731765b6d18bc7acd92d587ae178a4831cd7a42f927698dd` | Transaction context, forced RLS, append-only protections and privilege hardening |
| `FND-0003-reference-slice.sql` | `3e51f91fe005b5cf6d976bcd473ac902bd03e4423a9f764c8eafbec9719f1a34` | Reference record, idempotent posting kernel and inbox claim/complete functions |
| `FND-0004-identity-revocation.sql` | `485e579520910e16df9f6a076e579246da5d372ded3dc966a0c701571289d6a3` | Session revocation table, RLS, revocation checks and audit/outbox effects |
| `FND-0005-session-revocation-privilege-hardening.sql` | `ff50c6d4f607002540d9e3399ff7523de840ada8c6d0580ecf7f47a7b403ef00` | Function-only runtime write path, membership validation and direct DML revocation |

All five migrations and synthetic development fixtures are applied to `dev/foundation-v1`. The parent branch remains unmigrated.

## Live Neon evidence

- Migration registry: `FND-0001`, `FND-0002`, `FND-0003`, `FND-0004`, `FND-0005`.
- Registered module/schema ownership entries: 17.
- Forced-RLS platform tables: 23.
- Tenant Alpha runtime context sees store `LON-01` and user `Alpha Owner` only.
- Tenant Beta runtime context sees store `DHK-01` and user `Beta Owner` only.
- Reference replay creates exactly 1 record, 1 audit event and 1 outbox event.
- Inbox first claim returns true and duplicate claim returns false.
- Active session is not revoked; first revocation returns true, duplicate returns false and the session then returns revoked.
- Session revocation creates exactly 1 revocation row, 1 audit event and 1 outbox event.
- `store_app_runtime` direct insert privilege on session revocations is false; direct insert is rejected while audited function execution remains allowed.
- Runtime role cannot delete reference records, mutate audit records or change migration metadata; audit and outbox protections reject content mutation.
- Parent/child schema diff contains expected Foundation schemas, functions, tables, constraints, triggers, RLS policies, roles and privileges plus reserved module namespaces; no parent migration was applied.

## Fresh rebuild and preview lifecycle evidence

- Earlier temporary recovery project `broad-cloud-22671424` rebuilt `FND-0001`–`FND-0003`, synthetic fixtures, 22 forced-RLS tables and reference effects from an empty database, then was deleted.
- Temporary branch `test/foundation-fnd0004-manual` (`br-rapid-cloud-ax97f9ic`) rebuilt `FND-0001`–`FND-0004`, synthetic fixtures, 23 forced-RLS tables and reference/revocation effects, then was deleted.
- Disposable branch `test/foundation-gate-manual-20260728` (`br-sweet-mode-axxx2970`) was created from empty non-production `main`, applied `FND-0001`–`FND-0004` plus seed, reproduced migration/RLS/isolation/reference/inbox/revocation evidence, rolled back verification writes and was deleted.
- `FND-0005` was applied and live-tested on `dev/foundation-v1`; automated fresh application of all five remains part of preview CI.

## Verification results

- Local full verification passed with 14 tests and no failures.
- Connected core CI passed on commit `742afaa`:
  - exact `npm ci --ignore-scripts`;
  - format and lint;
  - 7-workpack/16-schema architecture boundaries;
  - repository-owned TypeScript `5.8.3` typecheck;
  - build and 14 tests;
  - secret scan;
  - runtime/development dependency licence register;
  - CycloneDX SBOM;
  - `npm audit --audit-level=high`.
- Migration manifest SHA-256 values match all five SQL files.
- Connected Neon preview installed and built successfully, then failed before branch creation because `NEON_API_KEY` was empty. Project and parent IDs were present.

## Open-source provenance

- `@neondatabase/serverless` is pinned to `1.1.0`, recorded as MIT and included as a required SBOM component.
- `typescript` is pinned to `5.8.3`, recorded as Apache-2.0, noticed and included as an excluded-runtime/development SBOM component.
- No GPL/AGPL/custom-licence implementation was copied into the proprietary core.

## Foundation Gate status and blockers

Foundation is **not complete** and the PR must remain draft. MOD-A through MOD-G remain blocked.

1. Configure repository secret `NEON_API_KEY`. Project `twilight-boat-26805962` and empty parent `br-spring-grass-ax3ptydv` are pinned in the workflow; execute automated preview create/migrate/seed/integration/benchmark/delete.
2. Capture direct HTTP, HTTP-batch and request-scoped WebSocket p50/p95/p99, cold-wake, failure and concurrency measurements.
3. Deploy non-production Cloudflare API/jobs shells and capture bundle size, CPU and memory evidence.
4. Perform a Neon PITR/history restore and reconciliation drill.
5. Read ignored local `.ai-bridge` instructions when the actual `.worktrees/foundation-v1` checkout is mounted.

## Exact continuation action

Continue Foundation under the single assigned owner. Configure the missing Neon API-key secret, execute the automated preview benchmark lifecycle, then complete Cloudflare and PITR evidence. Do not activate a module agent until `program-board.yaml` marks FOUNDATION `complete` and selected module workpacks `ready`.
