# MOD-G — Reporting, Integrations and SaaS Administration Handoff

**Checkpoint date:** 2026-07-29  
**Git branch:** `module/reporting-integrations-saas-v1`  
**Worktree:** `.worktrees/reporting-integrations-saas`  
**Approved Wave 2 release:** `93f8d98164dc105141a71b85dd2af5a98e9e31e9`  
**Neon branch:** `dev/module/reporting-integrations` (`br-mute-band-axbhmsky`)  
**Review PR:** `#45`  
**State:** `active`

## Activation safety

- Git branch and Neon branch are isolated and verified.
- No existing implementation was reset, discarded, overwritten or force-pushed.
- All upstream module contracts are integrated; country/privacy behavior consumes MOD-F contracts without changing the Bangladesh pack's `limited` validation status.
- The whole MOD-G workpack is owned by one implementation stream; no small task agents are used.
- Mobile application paths and branches are not part of this workpack and were not modified.

## Planned checkpoint sequence

1. Metric catalog, immutable event-consumption cursor and control-total contracts.
2. Reporting/integration schemas, forced RLS, append-only delivery/replay evidence and runtime commands.
3. Projection workers, freshness/reconciliation, drill-through and rebuild controls.
4. Public REST/OpenAPI, API clients/scopes, signed webhooks, retries, DLQ and replay.
5. Connector framework, generic CSV/REST connector and one demand-selected ecommerce adapter.
6. SaaS plans, entitlements, usage meters, tenant lifecycle and approved support controls.
7. Admin dashboards, reporting/integration/SaaS consoles, asynchronous exports and developer documentation.
8. Performance, tenant isolation, recovery, security, observability and final handoff evidence.

## Completed checkpoint 1 — contracts and migration foundation

- Published versioned reporting metric/query/result, source provenance, projection cursor/event/reconciliation and export contracts.
- Added exact metric/control-total arithmetic, duplicate replay handling, monotonic cursor enforcement and stale/fresh evaluation.
- Published public API client, signed webhook, replay, connector mapping/cursor/outcome contracts.
- Added HTTPS enforcement, terminal webhook lifecycle, connector ownership loop prevention, credential redaction and spreadsheet formula-injection protection.
- Published versioned SaaS plan/entitlement, subscription, exact usage, lifecycle job and support impersonation contracts.
- Added hard/soft entitlement decisions, explicit subscription transitions, exact/idempotent usage aggregation and independently approved time-boxed support access.
- Added deterministic `RPT-0001` and `INT-0001` migrations after MOD-F.
- Added 7 reporting and 9 integration tables with forced tenant RLS, exact values, append-only evidence and direct runtime write revocation.
- Added dedicated `ci:neon-mod-g` complete-chain and deterministic replay rehearsal on the assigned Neon branch.

## Completed checkpoint 2 — runtime commands and worker orchestration

### Database command layer

- Added `RPT-0002` and `INT-0002` command migrations.
- Reporting commands cover metric publication, projection event consumption, metric snapshots, export requests and export transitions.
- Integration commands cover webhook subscriptions/deliveries/attempts/replay and connector connections/mappings/sync outcomes.
- Commands use security-definer functions, explicit execute grants, advisory locking, idempotent replay checks and transactional audit/outbox evidence.
- Runtime roles retain no direct table insert/update/delete privileges.

### Reporting workers

- Added bounded tenant-scoped projection batches with explicit applied, duplicate, retry, dead-letter and deferred results.
- Ordered processing stops on retryable infrastructure failure so later events cannot silently skip a cursor gap.
- Added bounded asynchronous export orchestration through renderer, storage and command ports.
- Export completion requires matching format/content type, exact row and byte counts, tenant-scoped object keys and a non-empty storage receipt.

### Integration workers

- Added signed outbound webhook execution with active-subscription checks, tenant/event isolation, attempt evidence, transient retry classification and exhausted-attempt dead letter.
- Added connector page orchestration with loop-safe mappings, bounded reads, scoped cursors, append-only outcome evidence and cursor advancement only after the full page is recorded.
- Provider/internal errors are normalized to bounded categories without exposing credentials or raw secret values.

Checkpoint evidence is recorded in `docs/architecture/mod-g/worker-orchestration-checkpoint.md`.

## Verification evidence

### Contracts and migration foundation

GitHub run `30463780467` passed:

- core verification, tests and supply-chain/security gates;
- Foundation Design CI;
- dedicated MOD-G Neon full-chain and replay job `90616506836`;
- Neon recovery;
- Cloudflare preview, runtime metrics and cleanup.

The assigned-branch artifact reports 48 applied migrations, 7 reporting tables, 9 integration tables, forced RLS on all 16 MOD-G tables, zero direct runtime writes, zero `PUBLIC` function execution and zero unsafe credential-value columns.

### Runtime commands and workers

Implementation head `abae858f7861c49b3de0397971af9d21bd3c56c6` passed Foundation CI run `30478165369`, verify job `90665021102`:

- format, lint and architecture boundaries;
- strict TypeScript typecheck;
- build and `306/306` unit and architecture tests;
- secret scan, licence register, SBOM and dependency audit.

The exact checkpoint run also executes MOD-G Neon replay, Neon recovery and Cloudflare preview/runtime gates. Foundation Design CI run `30478174548` covers the unchanged visual surfaces.

## Current checkpoint

Runtime commands and core projection/export/webhook/connector worker orchestration are implemented. The next coherent checkpoint is the public REST/OpenAPI layer with client scopes, rate limits, pagination and idempotency, followed by concrete generic connector adapters, SaaS lifecycle orchestration and the reporting/integration/SaaS admin web surfaces.
