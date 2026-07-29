# MOD-G — Contracts and Migration Foundation Checkpoint

**Checkpoint date:** 2026-07-29  
**Git branch:** `module/reporting-integrations-saas-v1`  
**Checkpoint head:** `14eab07c3812d7bc29df082d6e6cd102f0df34b8`  
**Review PR:** `#45`  
**Neon project:** `twilight-boat-26805962`  
**Assigned Neon branch:** `dev/module-reporting-integrations` (`br-mute-band-axbhmsky`)  
**CI run:** `30463780467`  
**Dedicated MOD-G Neon job:** `90616506836`

## Published contracts and domain invariants

### Reporting

- Versioned metric definitions identify owner, formula, dimensions, source event types, control metric and freshness threshold.
- Metric values use exact integer strings plus scale, unit and optional currency; binary floating point is not accepted.
- Query results carry period, dimensions, source count/cursor, freshness, health, control total and drill-through references.
- Projection cursors are tenant-scoped and monotonic.
- Exact event replay returns `duplicate`; out-of-order events require explicit rebuild/reconciliation instead of silent application.
- Projection reconciliation computes an exact difference and records whether the projection agrees with its control total.
- Export requests are asynchronous and versioned.

### Integrations

- API clients expose scopes, rate limits and credential references without credential material.
- Webhook subscriptions require HTTPS, event filters, signing-key references and bounded attempts.
- Webhook deliveries use tenant/subscription/event identity, payload hashes and terminal delivery/DLQ/cancelled states.
- Connector mappings encode field ownership and direction; platform-owned fields are outbound and external-owned fields are inbound, preventing synchronization loops.
- Diagnostic fields redact secrets/tokens/credentials/signatures.
- Spreadsheet cells beginning with formula-control characters are escaped before export.

### SaaS administration

- Plans and entitlements are versioned and effective-dated.
- Boolean and exact integer entitlements support hard, soft and observe enforcement.
- Subscription transitions are explicit and preserve tenant/business identity through suspend/resume.
- Usage events use exact integer strings and idempotent event identity.
- Support impersonation requires independent approval, reason, scoped permissions and an unexpired grant window.

## Deterministic database foundation

### `RPT-0001`

Creates:

- `reporting.metric_definitions`
- `reporting.projection_cursors`
- `reporting.projection_event_receipts`
- `reporting.metric_snapshots`
- `reporting.projection_reconciliations`
- `reporting.export_requests`
- `reporting.export_events`

The schema uses exact `numeric(78,0)` values, versioned metric identities, source cursors, control-total constraints, append-only receipts/snapshots/reconciliation/export events, forced tenant RLS and read-only runtime table grants.

### `INT-0001`

Creates:

- `integration.api_clients`
- `integration.webhook_subscriptions`
- `integration.webhook_deliveries`
- `integration.webhook_delivery_attempts`
- `integration.webhook_replay_requests`
- `integration.connector_connections`
- `integration.connector_field_mappings`
- `integration.connector_cursors`
- `integration.connector_sync_outcomes`

The schema stores credential references only, deduplicates webhook events and connector operations, preserves append-only attempt/replay/outcome evidence, constrains field ownership/direction, forces tenant RLS and revokes direct runtime writes.

## Verification evidence

The exact checkpoint passed:

- format, lint, architecture boundaries and strict TypeScript;
- deterministic migration manifests/checksums and no orphan SQL files;
- unit and architecture tests;
- secret scan, licence register, SBOM and dependency audit;
- Foundation Design CI;
- Neon recovery;
- Cloudflare preview, runtime metrics and cleanup;
- dedicated assigned-branch complete-chain Neon rehearsal;
- a second deterministic migration replay against the same branch.

The MOD-G rehearsal artifact `neon-mod-g-30463780467` records:

- 48 reviewed migrations present through `RPT-0001` and `INT-0001`;
- 7 reporting tables;
- 9 integration tables;
- 16 of 16 MOD-G tables with forced RLS;
- 0 direct `store_app_runtime` write grants;
- 0 `PUBLIC` execute grants in MOD-G schemas;
- 0 unsafe credential-value columns;
- advisory-lock acquisition and clean release;
- status `passed`.

## Next coherent checkpoint

1. Add security-definer runtime commands and repositories for metric publication, event receipt/cursor advancement, reconciliation and export lifecycle.
2. Add webhook enqueue/attempt/retry/DLQ/replay commands and connector cursor/outcome commands.
3. Add SaaS plan/subscription/usage/lifecycle persistence and migration foundation.
4. Add projection, webhook, connector and export worker orchestration with audit/outbox evidence.
5. Verify tenant isolation, duplicate/lost-response recovery and rebuild behavior before UI implementation.
