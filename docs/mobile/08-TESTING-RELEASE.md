# Store Companion — Testing, Release and Operations Plan

## 1. Quality strategy

Store Companion operates on inventory, purchasing, customer, sales and financial information. UI rendering alone is not evidence of correctness. The mobile quality model proves:

- server contract compatibility;
- tenant/workspace isolation;
- exact data representation;
- durable local drafts and operations;
- idempotent replay and conflict recovery;
- local migration and update safety;
- authentication/device revocation;
- accessibility and localisation;
- performance on representative low-end devices;
- privacy-safe observability;
- signed, staged release and rollback.

## 2. Test layers

### Pure unit tests

- exact amount/quantity transport and formatting adapters;
- view-model state transitions;
- error/recovery mapping;
- capability/navigation composition;
- cursor and operation state machines;
- retry/backoff classification;
- localisation and business-date presentation;
- data classification/TTL rules.

### Repository/data tests

- remote/local merge behaviour;
- cached-read/stale states;
- queued operation persistence;
- transaction rollback on local failure;
- projection rebuild preserving pending operations;
- tenant/workspace partition;
- logout/revocation purge;
- unknown enum compatibility;
- attachment dependency handling.

### Local database tests

- migrations from every supported schema version;
- migration interruption/retry;
- encryption/key lifecycle approach;
- indexed lookup and bounded query plans;
- storage pressure;
- integrity failure and rebuild;
- no binary floating point for money/quantities;
- pending operations never removed by cache eviction.

### Widget/component tests

- loading, stale, offline, denied, conflict and partial-success states;
- phone and tablet navigation;
- workspace switch;
- scan/manual lookup;
- receiving/count/approval forms;
- text scaling and long translations;
- RTL and mixed-direction references;
- semantics and focus order.

### API/contract tests

- generated schema/client drift;
- bootstrap and workspace scopes;
- authentication and current capability enforcement;
- cursor pagination/expiry;
- idempotency replay/hash mismatch;
- optimistic conflict;
- duplicate/out-of-order/partial operation batches;
- device/push-token revocation;
- restricted/masked/no-existence leakage;
- minimum client and supported-version windows;
- MOD-F effective localisation/country capability;
- MOD-G metric definition/freshness/drill-through.

### Integration tests

Run on emulator/simulator and selected physical devices:

- login and OAuth callback;
- first device enrolment;
- workspace selection;
- snapshot/import and incremental sync;
- barcode lookup;
- receiving draft, restart and submission;
- stock count and duplicate replay;
- transfer conflict;
- customer/quote workflow;
- approval with MFA/step-up;
- notification deep link and reauthorization;
- session/device revocation;
- app update with pending operations.

### Backend end-to-end tests

Use synthetic tenants against reviewed integration environments:

- product -> PO -> mobile receipt -> stock ledger;
- mobile count -> variance approval -> stock adjustment;
- mobile quote -> order -> fulfilment;
- return/refund approval reference without duplicate payment;
- finance exception -> source/journal drill-through;
- MOD-F locale/business-date/country limitation;
- MOD-G metric -> source document -> ledger.

The final assertions use canonical server documents, ledgers, audit and events—not mobile display values alone.

## 3. Golden mobile scenarios

1. Bengali store manager with two stores switches workspace without data leakage.
2. Warehouse operator downloads assigned receiving work, loses network, captures lines/evidence, restarts and submits once.
3. Two devices submit overlapping count work; server conflict is visible and no stock effect duplicates.
4. Product/serial policy changes after draft; stale operation is rejected or adjusted with explicit evidence.
5. Sales representative creates a customer/quote offline under policy; duplicate merge/remap is reconciled.
6. Manager receives an approval push; source state changes before decision; stale approval cannot complete.
7. Accountant reviews unknown payment state; no blind retry/refund occurs.
8. Permission/device is revoked during outage; cached restricted data is purged/locked and queued commands do not upload.
9. App update/local migration occurs with pending operations; no work is lost.
10. MOD-F timezone/business-day boundary changes presentation without changing historical source timestamps.

## 4. Security tests

- OAuth state, nonce, PKCE and redirect attacks;
- token expiry/rotation/revocation;
- deep-link spoof/open redirect;
- cross-tenant cursor, object and cache attacks;
- local key/database/backup review;
- log, crash and analytics sensitive-data scanning;
- notification payload privacy;
- operation payload tamper/replay;
- approval replay/threshold/assurance bypass;
- malicious barcode, MIME/file and oversized upload;
- rooted/jailbroken policy response;
- environment/signing configuration;
- dependency/secret/licence/SBOM scanning;
- external penetration test before GA.

## 5. Accessibility and localisation matrix

Required languages/scripts:

- English;
- Bengali;
- Arabic RTL representative fixture;
- Japanese/CJK representative fixture;
- mixed-script SKU/barcode/document identifiers.

Required checks:

- TalkBack and VoiceOver core journeys;
- 200% text scaling;
- reduced motion;
- colour-independent status;
- touch targets;
- external keyboard/focus on tablets;
- orientation/split screen where supported;
- long labels, large monetary values and exact quantities;
- locale/currency/timezone/business-date metadata;
- no clipped approval reason/error/recovery text.

## 6. Device and OS matrix

Maintain a versioned support matrix rather than claiming support for every device.

Initial representative matrix:

- current supported Android API range, including one low-memory/low-storage physical device;
- current and previous major iOS versions supported by the selected Flutter stable release;
- phone and tablet form factors;
- camera quality/performance variations;
- restricted background/battery-saver modes;
- slow, intermittent and captive/failed network conditions;
- dark mode only if/when the Operations Ledger dark treatment is explicitly designed; system dark mode is not automatically accepted by colour inversion.

The exact OS minimums are selected and recorded during M1 after reviewing current Flutter and plugin support. Avoid premature values in product claims.

## 7. Performance budgets

M1 records measured budgets for representative devices. Initial targets for validation, not public promises:

- cold start to safe shell without blocking on every module;
- bootstrap/home usable within two seconds on normal network after authentication where backend latency permits;
- local barcode lookup feedback within 150 ms for the supported local projection;
- scan-to-line capture suitable for repeated receiving/counting;
- smooth scrolling with representative work queues;
- bounded memory during large snapshot import;
- no UI-thread blocking database/import work;
- background sync respects battery/data constraints;
- local database and media size remain within documented plan/device limits.

Measure p50/p95/p99 where meaningful, plus memory, CPU, frame timing, database size, snapshot duration and battery/network cost.

## 8. Resilience tests

Inject:

- API unavailable/high latency;
- response loss after commit;
- duplicate and out-of-order response;
- server minimum-version change;
- expired cursor/snapshot URL;
- corrupt snapshot/checksum;
- local SQLite corruption;
- disk full;
- app/OS kill during write/import/migration;
- delayed Android/iOS background work;
- push missing/duplicated;
- R2 upload timeout;
- clock/timezone change;
- server restore followed by replay;
- MOD-F/MOD-G mixed-version deployment inside supported compatibility window.

Verify state remains explainable and recovery does not duplicate business effects.

## 9. CI pipelines

### Pull request public gates

- Flutter/Dart formatting;
- static analysis;
- dependency lockfile and generated-code drift;
- unit, repository and widget tests;
- architecture/import boundaries;
- localisation generation and missing-key check;
- secret and licence/provenance check;
- debug Android build;
- safe iOS compile/simulator build where macOS runner is configured;
- no production secrets required.

### Trusted integration gates

- contract tests against synthetic reviewed backend;
- Android/iOS integration tests;
- local migration/update suite;
- security/tenant negative tests;
- snapshot/offline/replay scenarios;
- signed internal build artefacts;
- SBOM/provenance;
- staged distribution to internal tracks.

Secret-backed jobs do not run for untrusted forks/Dependabot. CI resources and test tenants are isolated per PR/run and cleaned safely.

## 10. Environments and flavours

- `development` — local/synthetic services, verbose safe diagnostics;
- `staging` — integrated non-production APIs, synthetic data and sandbox providers;
- `production` — production endpoints, restricted diagnostics, signed app.

Each environment uses separate:

- bundle/application IDs where appropriate;
- OAuth clients/redirects;
- push configuration;
- signing configuration;
- telemetry project/sink;
- feature rollout and minimum-version policy;
- backend tenant/data.

Production data is not copied into development/staging.

## 11. Release tracks

### Android

- internal testing;
- closed pilot;
- staged production rollout;
- halt/rollback capability;
- Play App Signing and managed credentials.

### iOS

- development/internal distribution;
- TestFlight internal/external pilot;
- phased App Store release;
- release halt and server-side feature/minimum-version controls.

Store listing, privacy labels/data safety declarations and screenshots must match actual behaviour. No invented performance, compliance or customer claim.

## 12. Version and compatibility policy

Use semantic app versions plus platform build numbers.

Server bootstrap declares:

- minimum supported client;
- recommended client;
- API/sync compatibility range;
- local schema compatibility;
- forced-update/read-only policy;
- feature flags/kill switches.

Rules:

- additive server changes remain compatible within the supported major version;
- app handles unknown enum values safely;
- breaking API/sync changes require coexistence/migration window;
- forced update cannot discard pending operations;
- minimum-version enforcement is tested before activation;
- old builds and push tokens can be revoked by environment.

## 13. Observability and SLO inputs

Metrics:

- active/healthy registered devices by app version;
- bootstrap and API latency/error;
- sync success/failure and cursor age;
- pending/conflict/rejected/unknown-state counts;
- oldest pending operation;
- snapshot import/rebuild duration/failure;
- local migration success/failure;
- crash-free sessions and ANR/hang indicators where available;
- push token/delivery-reference health without sensitive payload;
- storage pressure and local DB size;
- minimum-version/update adoption;
- workflow completion/drop-off using privacy-safe events.

Alerts focus on actionable conditions, not raw user behaviour.

## 14. Incident and support runbooks

Required runbooks:

- authentication/OAuth outage;
- device/session revocation;
- sync backlog or replay defect;
- contract incompatibility/minimum-version error;
- local migration/corruption failure;
- push notification outage;
- attachment upload/processing failure;
- cross-tenant/security incident;
- sensitive telemetry exposure;
- compromised signing/release;
- bad staged rollout;
- backend/module outage and read-only degradation.

Support tools use trace/device/build references and authorised server views. Raw mobile database export is exceptional, encrypted, consented/authorised and documented.

## 15. Pilot gate

Before pilot:

- M0 and M1 documentation/code gates pass;
- selected M2 journeys work end-to-end against integrated synthetic backend;
- no unresolved critical security/privacy issue;
- tenant/workspace negative tests pass;
- offline/restart/replay/migration tests pass;
- Bengali/English and accessibility core checks pass;
- telemetry and support runbooks exist;
- signing and distribution are controlled;
- known limitations and supported device/OS matrix are documented;
- no production customer/payment data is used in testing.

## 16. General availability gate

Before GA:

- MOD-F country/localisation support level is integrated and accurately disclosed;
- any shipped MOD-G dashboards reconcile and drill through;
- critical operational journeys pass on the supported physical device matrix;
- penetration test findings are resolved/accepted;
- privacy/data-safety declarations and retention are reviewed;
- crash/performance/reliability targets are measured in pilot;
- release rollback, minimum-version and feature kill switches are rehearsed;
- store review requirements are complete;
- customer support and incident ownership are active;
- exact release commit, generated schema, SBOM/provenance and backend compatibility are recorded.
