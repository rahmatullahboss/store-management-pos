# MOD-G — Reporting, Integrations and SaaS Administration Handoff

**Checkpoint date:** 2026-07-30  
**Git branch:** `module/reporting-integrations-saas-v1`  
**Worktree:** `.worktrees/reporting-integrations-saas`  
**Approved Wave 2 release:** `93f8d98164dc105141a71b85dd2af5a98e9e31e9`  
**Neon branch:** `dev/module-reporting-integrations` (`br-mute-band-axbhmsky`)  
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

## Completed checkpoint 3 — public API control plane

- Added API-client validation, tenant/client binding, explicit and namespace-wildcard scopes, status/expiry checks and fail-closed mutation idempotency requirements.
- Added deterministic per-client/per-minute rate-limit windows with duplicate request protection and reset metadata.
- Added exact SHA-256 idempotency state handling for new, in-progress, replay, failed and payload-conflict requests.
- Added bounded opaque-cursor pagination and safe deterministic sort validation, including camelCase API fields.
- Added database-free OpenAPI 3.1 and capabilities discovery routes before OIDC/database initialization.
- Documented API-key and OAuth2 client-credentials conventions without exposing credential values.
- Preserved every existing internal OIDC-authenticated business route unchanged.

Checkpoint evidence is recorded in `docs/architecture/mod-g/public-api-control-plane-checkpoint.md`.

## Completed checkpoint 4 — persistent API clients and credential verification

- Added `INT-0003` with idempotent API-client registration, exact credential-version rotation and active/suspended/revoked status transitions.
- Added append-only `integration.api_client_security_events` with forced tenant RLS and command-only runtime writes.
- Credential material remains outside PostgreSQL; only namespaced `secret://`, `vault://`, `kms://` or `provider://` references are accepted.
- Added optimistic version checks, advisory locks, idempotency conflict detection and terminal revocation.
- Added transactional audit/outbox evidence without including credential references or presented key material in metadata or payloads.
- Added a fail-closed credential provider port that checks tenant, client, authentication, status and validity before secret-provider access.
- Added deterministic binding rotation that retires the old binding and increments the credential version.
- Added unit and architecture coverage for reference safety, provider failure, rotation, migration order/checksum, forced RLS and absence of secret-value columns.

Checkpoint evidence is recorded in `docs/architecture/mod-g/api-client-credentials-checkpoint.md`.

## Completed checkpoint 5 — scoped partner REST routes and OpenAPI catalog

- Added `INT-0004` with a pre-authentication API-client directory and service-principal actor mapping.
- The directory function is security-definer, revoked from `PUBLIC` and returns only safe client metadata plus an external credential reference.
- Added credential-first and rate-limit-first route composition before internal OIDC route handling.
- Added tenant-RLS reporting metric list/query routes with freshness, source cursor and reconciliation provenance.
- Added asynchronous export request/status routes backed by `reporting.request_export` and database idempotency.
- Added webhook delivery health and dead-letter replay routes backed by `integration.request_webhook_replay`.
- Webhook payloads, signatures and signing references remain excluded from public responses.
- Added a complete OpenAPI 3.1 catalog for all implemented partner operations, authentication alternatives, scopes, pagination, idempotency, rate-limit headers and standard problem responses.
- Added behavioural tests for authenticated tenant context, service-principal actor propagation, scope denial before business reads, fail-closed missing bindings, mutation idempotency and OpenAPI completeness.

Checkpoint evidence is recorded in `docs/architecture/mod-g/partner-api-routes-checkpoint.md`.

## Completed checkpoint 6 — connector framework and ecommerce adapter

- Published connector configuration on the versioned connection contract without embedding secret values.
- Added a bounded generic CSV adapter with strict UTF-8, quoted-field, CRLF, header, row-shape, identity and deterministic cursor controls.
- Added a generic REST adapter with credential-free HTTPS origins, restricted credential headers, bounded JSON-pointer extraction, cursor pagination and retryable/permanent provider error categories.
- Selected Shopify GraphQL Admin API as the first launch-priority ecommerce adapter and required an explicit quarterly API version.
- Added Shopify product and variant pagination with a 250-record ceiling and external access-token resolution.
- Added deterministic inbound mapping transforms, external/manual ownership decisions, explicit manual conflicts and prototype-pollution path rejection.
- Preserved the outcome-before-cursor invariant; provider outages produce no item outcomes and no cursor movement.
- Added tests for CSV parsing, duplicate identities, REST pagination/outage recovery, Shopify GraphQL cursoring, mapping conflicts and safe paths.

Checkpoint evidence is recorded in `docs/architecture/mod-g/connectors-checkpoint.md`.

## Verification evidence

### Contracts and migration foundation

GitHub run `30463780467` passed core, Design, MOD-G Neon full-chain/replay, Neon recovery and Cloudflare preview/runtime/cleanup gates. The assigned-branch artifact reports 48 applied migrations, 7 reporting tables, 9 integration tables, forced RLS on all 16 MOD-G tables, zero direct runtime writes, zero `PUBLIC` function execution and zero unsafe credential-value columns.

### Runtime commands and workers

Implementation head `abae858f7861c49b3de0397971af9d21bd3c56c6` passed Foundation CI run `30478165369`, verify job `90665021102`, including format, lint, boundaries, strict TypeScript, `306/306` tests, secret scan, licence register, SBOM and dependency audit. Its Design run encountered an isolated Chrome startup timeout; the next exact public-API head passed Design without source changes to existing visual surfaces.

### Public API control plane

Implementation head `b308f5f1653e9c6a41b6e10bab849a59866893ef` passed Foundation CI run `30479261530`, `311/311` tests, MOD-G Neon replay, Neon recovery, Cloudflare preview/runtime/cleanup and Foundation Design CI.

### API-client credential lifecycle

Implementation head `0929798c81dc2994e2cff4510a9ed0f1756f62b1` passed Foundation CI run `30481850859`, `314/314` tests, complete MOD-G Neon replay, Neon recovery, Cloudflare preview/runtime/cleanup and Foundation Design CI.

### Scoped partner routes

Implementation head `13ed32f3ec8c1f92f9f9bc5e86ff08f043113acb` passed Foundation CI run `30483170747`, `319/319` tests, complete MOD-G Neon replay, Neon recovery, Cloudflare preview/runtime/cleanup and Foundation Design CI.

### Connector framework

Implementation head `67f9771804432ae79143d862d68a37e2b0e6f18f` passed:

- Foundation CI run `30484495094`;
- verify job `90686647684` with `325/325` tests;
- format, lint, architecture boundaries and strict TypeScript;
- secret scan, licence register, SBOM and dependency audit;
- MOD-G complete-chain and deterministic replay job `90686733818`;
- Neon recovery job `90686733744`;
- Foundation Design CI run `30484495340`;
- Cloudflare preview/runtime/cleanup under the same Foundation run.

## Current checkpoint

Generic CSV/REST connectors, launch-priority Shopify GraphQL product synchronization, mapping conflict controls and outage/cursor recovery evidence are complete. The next coherent checkpoint is persistent SaaS plans, entitlements, exact usage meters, tenant lifecycle orchestration, rollout/incidents and approved support controls, followed by reporting/integration/SaaS admin web surfaces.
