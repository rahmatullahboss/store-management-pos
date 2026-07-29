# Store Companion — Feature Catalogue and Dependency Gates

## 1. Prioritisation rules

- `M0` — documentation and architecture gate before implementation.
- `M1` — mobile foundation required before any production-facing feature.
- `M2` — first commercially useful operational companion scope.
- `M3` — localisation and compliance completion after MOD-F integration.
- `M4` — governed reporting, communication and entitlement completion after MOD-G integration.
- `Deferred` — intentionally outside MOB-01.

A feature is complete only when domain authorization, client states, offline classification, audit effects, tests, telemetry, localisation and support documentation are present.

## 2. M0 — Documentation and contract gate

- ADR-007 and product decision;
- persona/workspace/capability matrix;
- feature and offline capability catalogue;
- mobile BFF and API schemas;
- sync envelope and compatibility policy;
- device/security/privacy threat model;
- Operations Ledger mobile design extension;
- test, release, incident and rollback plan;
- MOB-01 ownership, branch/worktree/Neon evidence and programme-board registration;
- approved deterministic fixtures for unfinished dependencies.

## 3. M1 — Flutter foundation

### Repository and tooling

- Dart pub workspace under `mobile/`;
- pinned Flutter stable version and checksum/reproducible setup policy;
- Android and iOS application targets;
- development, staging and production flavours/schemes;
- formatting, analysis, unit, widget, integration and build CI;
- dependency licence/provenance registration;
- generated-code policy and reproducible client generation.

### Application shell

- bootstrap/loading/recovery shell;
- authenticated and unauthenticated routing;
- tenant/legal-entity/store/warehouse workspace selector;
- capability-aware phone navigation and adaptive tablet rail;
- synchronisation, freshness and pending-operation status;
- loading, empty, stale, offline, denied, conflict, partial-success and error states;
- app update/minimum-version handling.

### Identity and device

- OAuth/OIDC authorization code with PKCE and external user agent;
- short-lived access token and rotating/revocable session;
- secure credential storage;
- device registration, push-token registration and self-revocation;
- remote session/device revocation response;
- assurance/MFA step-up handoff;
- privacy-safe session diagnostics.

### Local data and sync

- encrypted-key management and bounded SQLite database;
- transactional local migrations;
- cached projection metadata and freshness;
- draft and pending-operation persistence;
- cursor pull and batch push foundations;
- idempotency and replay-safe result storage;
- projection rebuild that preserves pending operations;
- storage-pressure, corruption and recovery behaviour.

### Cross-cutting services

- typed/versioned API client;
- stable error mapping and trace IDs;
- telemetry/crash reporting abstraction with redaction;
- deep links and notification references;
- image/document capture staging and signed-upload seam;
- localisation infrastructure and representative scripts;
- accessibility semantics and test harness.

## 4. M2 — Operational companion

### Catalog and lookup

- barcode/QR/SKU search using camera and typed input;
- product/variant identity, unit and lifecycle state;
- bounded price/tax snapshot display only where authorised;
- store/warehouse stock and freshness;
- batch/serial/expiry details where authorised;
- product media thumbnails through signed/CDN-safe URLs.

Dependencies: integrated MOD-A and MOD-B contracts.

### Inventory count

- assigned count-session list;
- blind count behaviour where configured;
- barcode scan and manual quantity entry;
- serial/batch/expiry capture;
- draft autosave and restart recovery;
- recount and discrepancy reason;
- submission and approval request;
- final variance posting remains authoritative on the server.

Dependencies: integrated MOD-B; mobile batch/idempotency contract.

### Receiving

- assigned/authorised purchase-order lookup;
- line receipt with exact quantities and units;
- over/under tolerance presentation;
- batch, serial, expiry and condition capture;
- inspection/quarantine disposition;
- discrepancy reason and evidence upload;
- partial receiving and backorder visibility;
- post/replay result and stock-posting reference.

Dependencies: integrated MOD-B and MOD-A item references.

### Transfer

- transfer lookup;
- pick/dispatch preparation;
- dispatch and receive commands where online policy allows;
- in-transit visibility;
- discrepancy, damage and evidence capture;
- exact per-operation outcomes.

Dependencies: integrated MOD-B.

### Customer and sales

- bounded customer search;
- limited customer creation with consent and duplicate warning;
- quotation creation/revision;
- order lookup, availability and status;
- permitted order creation/request actions;
- fulfilment queue, pick/pack/dispatch/delivery confirmation;
- return status and approval request;
- customer/payment status reads without card data.

Dependencies: integrated MOD-C, MOD-A snapshots, MOD-B availability and MOD-E status contracts.

### Approval inbox

- unified authorised approval queue;
- risk/severity, source and expiry;
- source-document detail and trace references;
- approve/reject/request-more-information where the domain workflow supports it;
- step-up authentication and reason/evidence;
- stale/superseded handling;
- notification deep links.

Dependencies: existing module approval contracts plus CCR-0003 composition contract.

### Finance operational review

- payment unknown/recovery state;
- receivable/payable summary by authorised scope;
- settlement and bank-reconciliation exceptions;
- period state and close-readiness;
- journal/source drill-through in read-only form;
- no P0 unrestricted manual journal entry.

Dependencies: integrated MOD-E; governed aggregate dashboards wait for MOD-G.

## 5. M3 — MOD-F localisation and compliance integration

- effective locale and fallback chain;
- Bengali/English language pack and representative Arabic RTL/Japanese fixtures;
- exact currency display/precision and cash-rounding evidence;
- IANA timezone and business-date presentation;
- legal/fiscal document state labels;
- country-pack capability and limitation display;
- privacy/retention restrictions on local cache, export and attachments;
- locale-safe search, addresses, phone numbers and identifiers;
- country-aware unsupported-action blocking;
- historical configuration/version visibility.

## 6. M4 — MOD-G reporting, communication and SaaS integration

### Governed dashboards

- owner, manager, inventory, purchase, sales and finance home views;
- metric definition, version, period, dimensions, currency and timezone;
- freshness/high-water state;
- reconciliation/control-total state;
- drill-through with preserved filters;
- no unexplained decorative statistic cards.

### Reports and exports

- report catalogue and job request;
- asynchronous generation state;
- short-lived authorised download;
- filter/timezone/locale/version provenance;
- restricted export step-up and audit;
- no large synchronous report execution.

### Communication

- notification inbox and preferences;
- push-token lifecycle;
- message/announcement references as authorised by the communication contract;
- delivery/read state where available;
- deep-link reauthorization;
- emergency/critical priority behaviour without exposing restricted payloads in push.

### Entitlements and lifecycle

- plan/feature visibility;
- entitlement-aware navigation;
- tenant suspension/read-only behaviour;
- minimum client/API compatibility and staged rollout;
- support diagnostics that do not permit unrestricted impersonation.

## 7. Deferred beyond MOB-01

- native POS and cashier checkout;
- cash shift, cash drawer and safe-drop workflows;
- payment terminal or card SDK;
- receipt, label or fiscal printer control;
- customer display and scale integration;
- native fiscal/e-invoice issuance;
- restaurant, pharmacy, fuel, hospitality or manufacturing vertical workflows;
- unrestricted platform administration;
- unrestricted data warehouse/BI authoring;
- autonomous AI decisions;
- background location tracking or employee surveillance.

## 8. First commercial mobile release

The minimum sellable Store Companion release contains:

1. secure login/device/workspace foundation;
2. capability-aware shell and synchronisation visibility;
3. product/barcode and stock lookup;
4. purchase receiving;
5. stock count and transfer;
6. customer/quotation/order lookup and selected creation;
7. approval inbox;
8. finance operational exceptions;
9. Bengali/English plus RTL/long-content quality evidence;
10. Android and iOS staged release, telemetry and support runbook.

Governed executive dashboards may be included only if MOD-G has completed its metric and reconciliation contracts before the mobile release gate.
