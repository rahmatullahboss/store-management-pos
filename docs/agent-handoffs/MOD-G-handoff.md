# MOD-G — Reporting, Integrations and SaaS Administration Handoff

**Handoff date:** 2026-07-30  
**Git branch:** `module/reporting-integrations-saas-v1`  
**Worktree:** `.worktrees/reporting-integrations-saas`  
**Approved Wave 2 release:** `93f8d98164dc105141a71b85dd2af5a98e9e31e9`  
**Integration base:** `program/integration-v1` at `7c552a6c55844c6437ed4cc60ab85db3d8f8bb76`  
**Neon branch:** `dev/module-reporting-integrations` (`br-mute-band-axbhmsky`)  
**Review PR:** `#45`  
**Verified implementation head:** `3b8b4ae31d11aefd4ac5ae07d88f2351bf8a1c06`  
**State:** `handoff_ready`

## Safety and ownership

- MOD-G was implemented as one complete workpack by one owner.
- No existing dirty work was reset, discarded, overwritten or force-pushed.
- The branch is a strict descendant of the frozen integration base and is not behind it.
- No production database or production customer data was used.
- Credentials remain external references; plaintext credential material is not stored in PostgreSQL, audit events, outbox payloads, logs or public API responses.
- Existing module ledgers remain authoritative. Reporting projections are rebuildable read models and cannot write authoritative business state.
- Mobile application paths and branches remain outside MOD-G and were not modified.
- MOD-F country/compliance contracts are consumed without changing Bangladesh's `limited` legal-validation status.

## Completed workpack

### 1. Reporting contracts and persistence

- Versioned metric catalog, query/result, provenance, projection cursor, reconciliation and export contracts.
- Exact integer-string metric arithmetic, versioned definitions, freshness thresholds and control-total evidence.
- `RPT-0001` reporting foundation and `RPT-0002` command migration.
- Tenant-scoped metric definitions, projection cursors/events, snapshots, reconciliation evidence and export lifecycle.
- Forced RLS, append-only evidence and command-only runtime writes.

### 2. Integration contracts and persistence

- API clients/scopes, signed webhook, delivery/replay, connector mapping/cursor/outcome and credential-reference contracts.
- `INT-0001`–`INT-0004` for integration foundation, commands, persistent API-client credentials and public API directory.
- `INT-0005`–`INT-0007` for SaaS plans/subscriptions/usage/lifecycle and support/rollout/incident controls.
- Advisory locking, idempotent replay checks, optimistic versions, audit/outbox evidence and public execution revocation.

### 3. Workers and asynchronous orchestration

- Bounded tenant-scoped projection batches with applied, duplicate, retry, dead-letter and deferred outcomes.
- Ordered processing prevents cursor gaps after retryable failures.
- Bounded reporting export orchestration with renderer/storage/command ports, row and byte ceilings, safe object keys, expiry windows, SHA-256 storage receipts and explicit failure categories.
- Signed webhook delivery with transient retry, exhausted-attempt dead letter and append-only attempt evidence.
- Connector page orchestration advances a cursor only after every page outcome is recorded.

### 4. Public API and credentials

- Credential-first partner API composition before internal OIDC routes.
- Tenant/client binding, exact scopes, expiry/status checks, rate limits, mutation idempotency and opaque cursor pagination.
- Persistent client registration, rotation, suspension, reactivation and terminal revocation.
- External `secret://`, `vault://`, `kms://` and `provider://` references only.
- Fail-closed credential-provider verification before tenant business reads.
- OpenAPI 3.1 and capabilities discovery without database initialization.
- Implemented partner operations:
  - `GET /public/v1/reporting/metrics`
  - `POST /public/v1/reporting/queries`
  - `POST /public/v1/reporting/exports`
  - `GET /public/v1/reporting/exports/{exportId}`
  - `GET /public/v1/integrations/webhook-deliveries`
  - `POST /public/v1/integrations/webhook-deliveries/{deliveryId}/replay`

### 5. Connectors

- Generic CSV adapter with strict UTF-8, quoted fields, CRLF, header/shape validation, bounded rows, stable identity and deterministic cursoring.
- Generic REST adapter with HTTPS origins, restricted credential headers, bounded JSON-pointer extraction, cursor pagination and retryable/permanent provider categories.
- Shopify GraphQL Admin product/variant adapter with an explicit quarterly API version and a 250-record page ceiling.
- Deterministic mapping transforms, platform/external/manual ownership, explicit conflict evidence and prototype-pollution path rejection.
- Provider outages do not create item outcomes or advance cursors.

### 6. SaaS administration

- Immutable global plan versions and tenant-scoped subscriptions.
- Exact append-only usage events and aggregate counters.
- Hard, soft and observe entitlement enforcement with consistent warnings/denials.
- Provision, suspend, resume, export and offboard lifecycle jobs that preserve tenant business data.
- Deterministic tenant feature rollouts.
- Support incident state machine.
- Independently approved, scope-bound, time-boxed and auditable support impersonation grants.

### 7. Admin web surfaces

- Five reporting audiences: owner, store manager, finance, inventory and platform.
- Explainable metric cards with period, timezone, currency, version, freshness, control total and drill-through provenance.
- Integration health console for connector state, redacted credential labels, webhook queues, retries and DLQ.
- SaaS console for subscriptions, usage, lifecycle jobs, rollouts, incidents and visible support access.
- Permission-filtered navigation and actions.
- Explicit ready, loading, empty, error and denied states.
- Responsive desktop/tablet/mobile layouts, Arabic RTL support, semantic landmarks, keyboard skip navigation and scrollable table regions.

### 8. Final operational controls

- Checkout-protecting workload admission for large reports and projection rebuilds.
- Recursive integration diagnostic redaction.
- Tenant-bound export object keys and bounded artifacts.
- Rebuildable projections and deterministic migration replay.
- Final machine-readable readiness artifact generated only after core, MOD-G Neon replay, Neon recovery and Cloudflare gates succeed.

## Migrations

Deterministic MOD-G migration order:

1. `RPT-0001-reporting-foundation.sql`
2. `RPT-0002-reporting-commands.sql`
3. `INT-0001-integration-foundation.sql`
4. `INT-0002-integration-commands.sql`
5. `INT-0003-api-client-credentials.sql`
6. `INT-0004-public-api-directory.sql`
7. `INT-0005-saas-platform-foundation.sql`
8. `INT-0006-saas-platform-commands.sql`
9. `INT-0007-saas-support-controls.sql`

## Exact verification evidence

### Foundation CI

Run `30494381767` on implementation head `3b8b4ae31d11aefd4ac5ae07d88f2351bf8a1c06` passed:

- verify job `90719681926`;
- format, lint and architecture boundaries;
- strict TypeScript build;
- `343/343` unit and architecture tests;
- secret scan, licence register, SBOM and dependency audit;
- MOD-G complete-chain and deterministic replay job `90719767445`;
- Neon recovery job `90719767378`;
- Cloudflare preview, runtime metrics and cleanup job `90719767091`;
- final readiness job `90720435656`.

### Design CI

Foundation Design run `30494381587`, evidence job `90719681447`, passed:

- Foundation browser evidence;
- MOD-G browser evidence `7/7`;
- zero WCAG axe violations;
- zero unexpected clipping or viewport overflow;
- desktop, RTL tablet and mobile scenarios;
- one main landmark, skip-link keyboard flow, reduced motion and 200% text scaling.

### Final readiness artifact

Artifact `mod-g-final-30494381767` (`8741086120`) reports:

- 9 MOD-G migrations;
- 4 forced-RLS statements covering module table groups;
- 17 append-only triggers;
- 28 security-definer functions and 28 explicit execute grants;
- zero unsafe business-data deletes;
- zero unsafe credential columns;
- OpenAPI `3.1.0`, 8 paths and all 6 required partner paths;
- 20,000 synthetic workload-admission decisions;
- synthetic p95 decision time of 3 microseconds;
- large exports/rebuilds deferred under checkout pressure;
- recursive credential redaction, tenant delete guard and command-only runtime writes.

## Documentation

- `docs/architecture/mod-g/activation-checkpoint.md`
- `docs/architecture/mod-g/contracts-migrations-checkpoint.md`
- `docs/architecture/mod-g/worker-orchestration-checkpoint.md`
- `docs/architecture/mod-g/public-api-control-plane-checkpoint.md`
- `docs/architecture/mod-g/api-client-credentials-checkpoint.md`
- `docs/architecture/mod-g/partner-api-routes-checkpoint.md`
- `docs/architecture/mod-g/connectors-checkpoint.md`
- `docs/architecture/mod-g/saas-lifecycle-checkpoint.md`
- `docs/architecture/mod-g/admin-consoles-checkpoint.md`
- `docs/architecture/mod-g/final-operational-readiness.md`
- `docs/architecture/mod-g/design-evidence/`

## Known boundaries

- Country-specific legal, tax, privacy or accounting claims remain subject to separately approved country-pack validation.
- Shopify synchronization requires an explicitly configured supported API version and externally resolved access token.
- Connector/provider-specific production certification is separate from the generic adapter contract and synthetic evidence.
- Projections and exports are read-side products; authoritative corrections remain reversals/commands in the owning module.
- Main release must follow controlled serial integration; this handoff does not authorize parallel merging with another module.

## Serial integration instructions

1. Confirm `program/integration-v1` still equals or is an ancestor of this branch and no competing module merge is in progress.
2. Confirm PR `#45` expected head matches the reviewed handoff head.
3. Merge without force-push and retain the module branch until integration verification finishes.
4. Run combined Foundation, Design, migration/replay, recovery and Cloudflare gates on `program/integration-v1`.
5. Record the integration merge SHA and exact push-run jobs in a separate integration handoff.
6. Only then advance MOD-G from `handoff_ready` to `integrated` and consider a controlled release PR to `main`.
