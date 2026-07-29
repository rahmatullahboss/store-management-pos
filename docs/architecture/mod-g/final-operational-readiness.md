# MOD-G Final Operational Readiness

**Date:** 2026-07-30  
**Branch:** `module/reporting-integrations-saas-v1`  
**Review PR:** `#45`

## Workload isolation

Reporting workload admission distinguishes interactive queries, projection batches, large exports and full rebuilds. Large reporting work is deferred when checkout latency, active checkout requests, export queue depth, projection lag or concurrent heavy-job ceilings are exceeded. Interactive queries remain higher priority but are also deferred under severe checkout pressure.

Export rendering validates row count, byte count, format, content type, tenant object key and storage receipt before completion. Oversized results are rejected before storage or completion evidence.

## Tenant isolation and data preservation

- reporting projections reject cross-tenant events before cursor advancement;
- public partner routes authenticate before tenant business reads;
- reporting, integrations and SaaS tenant tables use forced RLS;
- runtime roles use approved command functions rather than direct writes;
- lifecycle suspension/offboarding updates operating state only after completed jobs;
- migrations contain no tenant/business-record deletion path;
- subscription suspension and cancellation do not mutate domain ledgers.

## Recovery and replay

- projection, export, public mutation, webhook, connector, subscription, usage and lifecycle commands are idempotent;
- connector outcomes are recorded before cursor advancement;
- provider outage leaves the last durable cursor unchanged;
- complete Neon migration replay is deterministic;
- Neon rollback and snapshot-restore recovery remain mandatory CI gates;
- webhook DLQ replay remains explicit and cannot duplicate delivered effects.

## Security

- credential material stays in external providers; PostgreSQL stores references only;
- integration diagnostics recursively remove secret, token, password, authorization, signature and API-key fields;
- diagnostic depth, collection size and string size are bounded;
- support impersonation is independently approved, scoped, visible and time-boxed;
- public webhook responses exclude payloads and signing evidence;
- spreadsheet exports protect formula-leading cells;
- secret scan, licence register, SBOM and dependency audit are mandatory.

## Observability

MOD-G emits bounded low-cardinality evidence for:

- operation starts, completions, failures and duration;
- projection, export, webhook, connector and lifecycle backlog depth/age;
- reconciliation status and absolute difference;
- normalized failure category without raw provider errors or credentials.

## Machine-readable evidence

`npm run mod-g:final:verify` produces `artifacts/mod-g-final/readiness.json` and a human-readable summary. The job runs only after core verification, MOD-G Neon rehearsal/replay, Neon recovery and Cloudflare preview/runtime/cleanup have passed. Evidence includes migration registry, forced RLS, append-only triggers, security-definer commands, runtime grants, OpenAPI paths, workload admission behavior and recursive redaction results.

## Release gate

MOD-G may transition from draft implementation to integration review only when the exact final head passes:

- core verify and all tests;
- Design CI and MOD-G browser evidence;
- complete MOD-G Neon migration/replay;
- Neon recovery;
- Cloudflare preview/runtime/cleanup;
- final machine-readable readiness job;
- final handoff, program board and PR evidence update.
