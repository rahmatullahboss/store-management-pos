# MOB-01 — Store Companion Mobile

## Assignment

One agent owns the entire Store Companion mobile workpack from activation through final handoff. Do not split authentication, local database, sync, design, inventory, procurement, sales, approvals, finance, Android, iOS, tests or documentation among separate implementation agents.

```text
Git branch:   module/store-companion-mobile-v1
Worktree:     .worktrees/store-companion-mobile
Neon branch:  dev/module-store-companion-mobile
Start base:   47129e25191d1b1c8a8523dcd8f83c2a0b0edf55
Final integration order: after MOD-G unless coordinator approves an additive foundation checkpoint
```

The Neon branch is an isolated synthetic contract/integration evidence environment. MOB-01 owns no canonical PostgreSQL business schema and must not create a second mobile backend database.

## Mission

Deliver one secure, internationalised, permission-aware Flutter companion app for owners, managers, inventory/warehouse staff, purchasers, sales representatives and finance reviewers. The app reuses the existing store platform APIs and canonical data, remains useful on intermittent networks, preserves pending work safely and never duplicates domain calculations or posted effects.

Native POS, cash-shift and hardware control are explicitly out of scope.

## Entry gate

Before implementation:

1. read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, required architecture/security/testing/programme documents and `docs/mobile/`;
2. verify exact branch/worktree/base and preserve all dirty/unrelated work;
3. register MOB-01 in `program-board.yaml`;
4. create/verify the dedicated non-production Neon branch from the reviewed integration database point where available;
5. approve ADR-007 and CCR-0003 or record the exact unresolved shared-contract boundary;
6. record Flutter/Dart toolchain and dependency-provenance plan;
7. use synthetic data only;
8. do not deploy production or publish app-store builds without separate authorization.

## Owned paths

```text
mobile/**
docs/mobile/**
docs/architecture/mobile/**
docs/agent-handoffs/MOB-01-*.md
docs/agent-workpacks/MOB-01-STORE-COMPANION.md
tests/mobile/**                         # if repository-level cross-runtime fixtures are needed
.github/workflows/mobile-*.yml         # additive mobile workflows only
tooling/mobile/**                      # mobile-specific scripts only
```

Shared files may be changed only through reviewed additive composition and contract-change rules:

```text
docs/agent-workpacks/program-board.yaml
docs/agent-workpacks/MODULE-AGENT-ACTIVATION-POLICY.md
docs/17-PARALLEL-AGENT-EXECUTION.md
docs/11-API-INTEGRATIONS.md
root documentation indexes
shared API/error/device/design contracts
```

MOB-01 owns no server module table or schema. Required backend extensions are implemented by the owning Foundation/module/programme integration path after approved contract review.

## Contract dependencies

### Integrated and consumable

- Foundation identity, membership, permissions, session/device revocation, audit, idempotency, errors, events and localization primitives;
- MOD-A catalog, barcode, price/tax snapshots and feeds;
- MOD-B inventory, procurement, receiving, count and transfer contracts;
- MOD-C customer, quotation, sales, fulfilment and return contracts;
- MOD-D device/offline/idempotency principles and status vocabulary where applicable;
- MOD-E payment, receivable/payable, accounting, banking and reconciliation read/command contracts.

### Dependency-gated

- MOD-F effective locale, currency, timezone, business-date, country capability, privacy/retention and legal/fiscal state;
- MOD-G governed dashboards/metrics, reports/exports, notification/integration contracts, plans and entitlements.

Use frozen schemas and deterministic fixtures for unfinished dependencies. Do not import unreviewed implementation internals.

## Complete scope

- Flutter pub workspace, Android/iOS app and environment flavours;
- pinned toolchain, CI, dependency/provenance/SBOM workflow;
- Operations Ledger native design system and adaptive app shell;
- OAuth/OIDC authorization code with PKCE, secure session/device lifecycle and step-up handoff;
- tenant/legal-entity/store/warehouse workspace selector;
- capability-driven navigation and restricted/masked states;
- typed/generated API client and compatibility handling;
- bounded encrypted local SQL, migrations, projection cache, drafts and operation log;
- cursor snapshot/incremental pull and idempotent batch push;
- background sync adapters and explicit offline/freshness UI;
- device/push-token registration, notification references and deep links;
- signed attachment upload/camera/barcode seams;
- catalog/barcode and stock lookup;
- purchase receiving, count and transfer workflows;
- customer, quotation, order and fulfilment workflows;
- unified approval inbox/decisions through owning module contracts;
- finance operational reads and source/journal drill-through;
- MOD-F localisation/country integration;
- MOD-G governed dashboard/report/communication/entitlement integration;
- permissions, audit propagation, telemetry, privacy and incident controls;
- unit, widget, database, contract, integration, security, accessibility, localisation, performance and recovery tests;
- internal/pilot release automation, runbooks and final handoff.

## Explicit exclusions

- native POS checkout;
- POS cash shift/open/close/paid-in/out/safe drop;
- card-terminal/payment SDK;
- receipt/label/fiscal printer, drawer, scale or customer display control;
- direct Neon/database connection;
- independent Firebase/Firestore/Supabase business data;
- client-authoritative price/tax/stock/accounting decisions;
- unrestricted manual journal entry;
- platform secrets/integration credential administration;
- unsupported vertical packs;
- production deployment/store publication without separate approval.

## Ordered checkpoints

### M0 — activation, documentation and contract freeze

- verify instructions/base/branch/worktree and current programme status;
- publish/validate docs/mobile set, ADR-007, CCR-0003 and activation evidence;
- update programme board/parallel policy additively;
- define owned paths, dependency fixtures and test matrix;
- record no production mutation.

**Gate:** documentation and ownership agree; unresolved contract boundaries are explicit.

### M1 — repository and Flutter foundation

- create `mobile/` pub workspace;
- pin Flutter stable/Dart compatibility and lock dependencies;
- create Android/iOS app with dev/staging/prod flavours;
- implement architecture boundaries, base errors, config and CI;
- add deterministic synthetic app bootstrap fixture.

**Gate:** format/analyze/unit/build pass for both supported platform compile paths where CI permits.

### M2 — design, shell, identity and workspace

- implement generated mobile tokens/components from Operations Ledger authority;
- implement bootstrap states, adaptive navigation and workspace switching;
- implement OAuth/PKCE seam, secure storage and session/device revocation;
- implement accessibility/localisation baseline and synthetic visual evidence.

**Gate:** login/bootstrap/workspace/revocation journeys pass; design/accessibility/RTL evidence recorded.

### M3 — local data and synchronisation

- implement bounded SQL schema/migrations;
- implement secure-key/encryption seam;
- implement cached projections, drafts, pending operations, result/conflict storage;
- implement snapshot/incremental pull and idempotent batch push;
- implement Android/iOS background adapters, storage-pressure/corruption/update recovery.

**Gate:** crash/restart/replay/cursor/rebuild/migration/revocation tests pass without losing pending work or duplicating effects.

### M4 — catalog, inventory and procurement

- barcode/manual lookup;
- scoped stock and movement reads;
- receiving with exact units/serial/batch/expiry/inspection/evidence;
- stock count/recount/variance submission;
- transfer dispatch/receive according to online/offline policy;
- required permissions, conflicts, telemetry and runbooks.

**Gate:** product-to-receipt/count/transfer synthetic E2E reconciles to MOD-A/MOD-B authoritative documents and stock ledger.

### M5 — customer, sales, fulfilment and approvals

- customer lookup/limited create;
- quote create/revise;
- sales order/read/allowed commands;
- assigned fulfilment/pick/pack/dispatch/delivery;
- return status/request;
- unified approval inbox and owning-module decisions with assurance;
- notification/deep-link references.

**Gate:** customer/quote/order/fulfilment/approval E2E passes with duplicate/conflict/permission negative coverage.

### M6 — finance review and source trace

- payment unknown/recovery views;
- receivable/payable and reconciliation exception reads;
- close-readiness/period state;
- read-only journal/source trace;
- approval/step-up for explicitly supported finance workflows;
- no card secrets or unrestricted financial mutation.

**Gate:** finance views reconcile to MOD-E references and logs/telemetry contain no restricted payload.

### M7 — MOD-F localisation and compliance integration

- consume effective configuration and limitations;
- exact currency, cash-rounding, timezone/business date;
- Bengali/English plus RTL/CJK fixtures;
- country/fiscal/legal/privacy status;
- purge/cache restrictions and unsupported-action gates.

**Gate:** MOD-F contract tests, historical version fixtures, localisation/accessibility evidence pass.

### M8 — MOD-G reporting, communication and entitlement integration

- governed persona dashboards;
- metric definition/freshness/reconciliation/drill-through;
- report jobs/download authorization;
- notifications/preferences;
- generated approved OpenAPI client;
- plans/entitlements/suspension/minimum-version behaviour.

**Gate:** every shipped metric reconciles, reports are asynchronous, entitlements never grant authorization and notification payloads remain minimal.

### M9 — release hardening and handoff

- full Android/iOS supported matrix;
- performance, storage, battery/network and low-end evidence;
- security/tenant/privacy tests and penetration-test disposition;
- app signing/staged internal/closed pilot artefacts;
- rollback/minimum-version/kill-switch rehearsal;
- SBOM/provenance/licence notices;
- support/incident/operations runbooks;
- exact final SHA, backend compatibility and known limitations;
- final handoff and serial integration review.

**Gate:** explicit pilot-ready/blocked verdict. No production app-store release without separate authorization.

## Required invariants

1. Mobile never connects directly to Neon or writes module tables.
2. Server authorization is executed for every command/query; UI capabilities are not authority.
3. Same idempotency/operation ID cannot duplicate stock, sales, payment, journal or approval effects.
4. Local success is never presented as server posting/approval.
5. Pending operations survive app restart, cache rebuild and supported update.
6. Projection rebuild never deletes unsynchronised work.
7. Tenant/workspace cached data cannot cross user/scope boundaries.
8. Exact money/quantity never uses binary floating point.
9. Unknown payment/external state blocks blind retry.
10. Push/deep links contain references and reauthorize before data/action.
11. Revocation stops sync and purges/locks restricted data.
12. MOB-01 does not calculate authoritative price, tax, stock availability or accounting effects.
13. MOD-G metrics show definition, period, currency, timezone, freshness and source.
14. Card PAN/CVV, database credentials and reusable provider secrets are never stored.
15. Native POS/hardware behaviour remains outside MOB-01.

## Required evidence

- documentation/ownership validation;
- pinned toolchain and dependency provenance;
- public and trusted CI runs;
- Android/iOS build artefacts for approved non-production tracks;
- local migration/recovery matrix;
- API/generated-client compatibility tests;
- synthetic Neon/backend E2E evidence;
- tenant/workspace negative tests;
- design/Impeccable, phone/tablet, accessibility, Bengali/RTL/CJK evidence;
- offline/replay/background/storage pressure evidence;
- security/privacy/sensitive-log scans;
- performance/resource reports;
- SBOM/provenance/licence notices;
- runbooks and final handoff.

## Programme integration

Development is parallel; integration is serial. MOB-01 continuously consumes reviewed integration checkpoints through normal non-destructive merges. Final integration follows MOD-G by default because M8 depends on its governed reporting/API/entitlement contracts.

The programme integrator may accept an earlier additive mobile-foundation checkpoint only if it contains no speculative domain contract, does not block MOD-F/MOD-G and passes full repository verification.

## Completion boundary

MOB-01 is complete when authorised store roles can perform the approved companion workflows on Android and iOS with secure authentication, scope isolation, resilient local work, idempotent synchronization, inherited design/localisation, traceable server effects, tested release operations and no native POS or duplicated backend authority.

Final handoff path:

```text
docs/agent-handoffs/MOB-01-handoff.md
```
