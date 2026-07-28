# Testing, Observability and SRE Plan

## 1. Quality strategy

This product manages money, tax, inventory and legal documents. Quality cannot rely mainly on UI testing. The test strategy must prove domain invariants, transaction recovery, tenant isolation, offline replay and operational restoration.

Frontend quality also follows `docs/18-IMPECCABLE-DESIGN-WORKFLOW.md`. Deterministic Impeccable detection is a required UI check but does not replace browser rendering, accessibility, responsive, localisation or user-task testing.

Use layered tests:

- pure domain/unit tests;
- property-based invariant tests;
- database integration tests;
- module/application tests;
- API and provider contract tests;
- POS offline/device tests;
- end-to-end business scenarios;
- performance and resilience tests;
- security and isolation tests;
- backup/restore and disaster-recovery exercises.

## 2. Golden business scenarios

Maintain accountant-approved, versioned scenarios with exact expected documents and ledgers.

Minimum set:

1. cash sale with exclusive tax;
2. card sale with inclusive tax and provider fee;
3. line/order discount allocation;
4. split tender;
5. full and partial return/refund;
6. exchange with price difference;
7. purchase receipt and supplier bill;
8. partial receipt/backorder;
9. supplier return;
10. FIFO cost consumption;
11. weighted-average cost update;
12. transfer dispatch/in-transit/receipt;
13. physical-count loss/gain;
14. batch/serial movement;
15. gift card/store credit liability;
16. customer credit and collection;
17. multi-currency sale/payment and FX difference;
18. closed-period reversal/adjustment;
19. offline sale replay;
20. payment timeout followed by webhook recovery.

Each scenario verifies business documents, stock ledger, payment/cash ledger, journal entries, balances, reports and audit events.

## 3. Property-based tests

Generate many combinations and assert:

- journal debits always equal credits;
- stock projection equals ledger sum;
- return quantity/value never exceeds allowed source amounts without explicit override;
- discount/tax allocations sum exactly to document totals;
- repeated idempotent command has one effect;
- reversal plus original nets to zero by defined dimensions;
- FIFO consumes oldest eligible layers;
- serial ownership is unique;
- cash expected balance equals cash events;
- document number uniqueness holds under concurrency;
- tenant context never changes another tenant’s rows;
- currency rounding remains within defined adjustment accounts.

## 4. Database tests

Use real PostgreSQL in CI for:

- constraints, indexes and migrations;
- transaction isolation/concurrency;
- RLS tenant context through the selected Neon HTTP/WebSocket transaction mode;
- deadlock and lock timeout behavior;
- outbox atomicity;
- partition and archival behavior;
- projection rebuild/reconciliation;
- point-in-time restore compatibility.

SQLite mocks are not sufficient for canonical database behavior.

## 5. Module and architecture tests

Automate rules:

- modules cannot import another module’s persistence internals;
- direct cross-module table writes are prohibited;
- domain packages do not depend on Cloudflare/provider implementation packages;
- accounting/inventory posting interfaces are explicit;
- shared utilities contain no tenant/business state;
- cycles fail CI;
- public event/API schemas are versioned.

## 6. API and contract tests

- OpenAPI schema conformance.
- Authentication, scope and location permission cases.
- Idempotency and request-hash mismatch.
- Pagination/filter/sort stability.
- optimistic concurrency/version conflict.
- unknown enum/forward-compatible clients.
- provider sandbox and recorded contract fixtures.
- signed webhook verification, replay and stale timestamp.
- retry, timeout and partial provider failure.
- backward compatibility for supported API/event versions.

Provider adapters run against both a deterministic simulator and real sandbox where available.

## 7. POS and offline tests

Automate browser/device scenarios using controlled network and clock simulation:

- first install and full snapshot;
- incremental sync;
- network loss during checkout stages;
- refresh/crash after local commit;
- duplicate/out-of-order upload;
- 24-hour operation volume;
- local clock/timezone changes;
- user/device revocation;
- stale price/tax/promotion;
- final-unit oversell conflict;
- app/local schema upgrade with pending operations;
- printer/terminal/agent unavailable;
- local database corruption and projection rebuild;
- receipt range exhaustion;
- shift close and reconciliation.

Maintain a physical hardware lab for supported printer, scanner, drawer, scale and terminal profiles.

## 8. End-to-end test journeys

- tenant signup to first sale;
- product import to purchase receipt to sale;
- multi-store transfer;
- quote to order to partial fulfillment/payment;
- return/exchange/refund;
- daily shift close and bank/settlement reconciliation;
- period close and financial statements;
- country-pack activation and legal document generation;
- large import/export;
- privacy export/anonymization;
- tenant offboarding/export.

E2E tests are fewer than domain tests but cover the highest-value workflows.

## 9. Performance testing

### Workload profiles

- small store: 5,000 variants, two registers;
- growing chain: 250,000 variants, 50 stores, 200 registers;
- large tenant envelope: millions of variants/ledger entries and burst traffic;
- platform multi-tenant noisy-neighbor workload;
- month-end reporting/close;
- mass catalog update and ecommerce sync;
- offline reconnect burst.

### Critical measurements

- POS local search and cart interaction;
- checkout p50/p95/p99;
- database query/lock time;
- Neon query latency, connection/session count, compute wake-up and transaction duration;
- ledger posting throughput;
- queue lag/retries;
- projection freshness;
- report latency;
- import/export throughput;
- client memory/local DB size;
- Workers CPU, memory and subrequests.

Performance budgets are release gates, not after-launch observations.

## 10. Resilience and chaos testing

Inject:

- PostgreSQL failover/unavailability;
- high database latency and lock contention;
- queue delay/duplicate delivery;
- R2 timeout;
- payment/fiscal provider timeout or malformed callback;
- Workers deployment rollback/mixed versions;
- Durable Object restart;
- client network packet loss;
- clock skew;
- partial regional dependency outage.

Verify that business state remains explainable and recovery tools work. Do not run destructive production experiments without authorization and guardrails.

## 11. Security testing

- SAST, dependency, secret and license scans on every change.
- DAST/API tests in staging.
- tenant isolation and IDOR test suite.
- authorization matrix tests.
- rate-limit/abuse cases.
- SSRF and webhook destination tests.
- file upload/import attacks.
- XSS/CSP/CSRF checks.
- session/token/device revocation.
- sensitive log scanning.
- independent penetration test before GA.
- annual/material-change retest based on risk.

## 12. Test data

Use synthetic, deterministic data. Include:

- diverse scripts and long names;
- multiple currencies/precisions;
- inclusive/exclusive/compound taxes;
- DST and non-DST timezones;
- very large quantities and tiny unit prices;
- returns exceeding normal paths;
- batch/serial/expiry;
- duplicated external IDs/webhooks;
- large catalogs/files;
- corrupted/partial provider payloads.

Production personal/payment data must not be copied into development environments without an approved anonymization process.

## 13. Observability model

Use traces, metrics and structured logs with a shared context:

- trace/request ID;
- tenant ID and region;
- actor/device/register where safe;
- command/query/event name;
- module;
- entity/posting group reference;
- deployment version;
- outcome/error code;
- latency and retry count.

Do not record sensitive payloads. Operators need references that lead to authorized support views rather than raw customer data in logs.

## 14. Metrics

### Platform

- request rate/error/latency by route/region/version;
- Workers CPU/memory/subrequest usage;
- deployment/canary errors;
- authentication failures and rate-limit events.

### Database

- query latency/throughput;
- connection/wait utilization;
- locks/deadlocks/timeouts;
- replication/backup status;
- storage growth and slow queries;
- transaction duration.

### Business correctness

- posting failures/exceptions;
- unbalanced journal attempts;
- stock projection mismatches;
- payment unknown states;
- unreconciled settlements/cash variances;
- duplicate operation detections;
- document sequence gaps/collisions;
- fiscal submission pending/rejected.

### Async/integrations

- outbox age;
- queue lag, retry and DLQ volume;
- workflow duration/failure;
- webhook success/latency;
- provider error category;
- projection freshness.

### POS devices

- last sync/offline duration;
- pending/rejected operations;
- application/schema version;
- hardware/terminal health;
- clock drift and local storage capacity.

## 15. Service level objectives

Initial proposed SLOs, subject to pilot validation:

- core online API availability: 99.95% monthly after GA;
- successful online checkout excluding provider declines: 99.9% or better;
- POS local interaction available during configured offline window;
- p95 standard API read under 400 ms under normal load;
- p95 standard internal write under 700 ms excluding external providers;
- critical projection freshness under two minutes;
- fiscal/payment recovery queues monitored continuously during supported hours;
- no loss of acknowledged posted transactions.

Define SLIs precisely and exclude only documented causes. Error budgets drive release/risk decisions.

## 16. Alerting

Page only for actionable urgent conditions:

- widespread checkout failure;
- canonical database unavailable or failover failure;
- financial/stock invariant breach;
- payment duplicate/unknown-state spike;
- fiscal rejection/outage above threshold;
- queue/outbox lag threatening business operations;
- cross-tenant/security indicator;
- backup/PITR failure;
- regional routing failure.

Ticket or dashboard lower urgency issues such as individual connector failures, slow reports or isolated device health.

Every alert has owner, severity, runbook, suppression policy and validation test.

## 17. Runbooks

Required before GA:

- PostgreSQL unavailable/failover;
- high latency/connection saturation;
- failed migration;
- queue/DLQ backlog;
- payment unknown/duplicate concern;
- fiscal provider outage;
- R2/document generation outage;
- offline-sync conflict spike;
- stock/journal reconciliation mismatch;
- compromised user/device/API key;
- tenant data export/deletion;
- backup restore and regional migration;
- deployment rollback/feature disable.

Runbooks include verification and reconciliation, not only service restart.

## 18. Backup and restore

- PostgreSQL point-in-time recovery with defined retention.
- Encrypted logical/portable exports for disaster and tenant portability where required.
- R2 checksums/version/retention policies for documents.
- Infrastructure/configuration stored as code.
- Queue recovery through transactional outbox.
- Analytics/search projections rebuildable.
- Restore into isolated environment and reconcile counts/checksums/ledgers.
- Regular restore drills with measured RPO/RTO.

A backup that has not been restored and reconciled is not considered verified.

## 19. Release observability

Each deployment provides:

- version and migration compatibility;
- canary cohort/region;
- error/latency comparison to baseline;
- business event/posting success;
- queue/provider health;
- feature-flag exposure;
- rollback/forward-fix decision window.

Use progressive delivery. Schema changes follow expand/contract so old/new application versions can overlap safely.

## 20. Production readiness review

Checklist:

- architecture and dependency map;
- capacity/performance evidence;
- SLO/SLI/dashboard/alerts;
- runbooks and on-call ownership;
- backup/restore/DR results;
- security/privacy review;
- tenant isolation results;
- ledger golden/invariant results;
- provider/offline failure tests;
- support and escalation model;
- country-pack validation;
- data migration/cutover plan;
- known limitations and rollback path.

## 21. Acceptance criteria

- Golden and property suites cover every P0 posting flow.
- Real PostgreSQL integration tests run in CI.
- Offline duplicates/out-of-order operations are proven safe.
- Tenant-isolation/security tests are mandatory.
- Performance tests meet approved budgets with representative data.
- Queue/provider/DB failure recovery is exercised.
- Dashboards and alerts lead to tested runbooks.
- Backup restore and projection/ledger reconciliation pass.
- Release canary and rollback/forward-fix are rehearsed.
- No production launch occurs without country, security and financial readiness sign-off.
