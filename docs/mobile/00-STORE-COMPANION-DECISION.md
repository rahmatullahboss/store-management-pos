# Store Companion — Product and Execution Decision

## 1. Product definition

Store Companion is the native operational mobile client for the International Store Management & POS Platform. It supports Android and iOS from one Flutter codebase.

The application is not a mobile replacement for the full administration web application and is not a native POS. It concentrates on work that benefits from mobility, camera input, notifications, quick review and store-floor use.

## 2. Target users

- business owners and directors;
- store and regional managers;
- inventory and warehouse staff;
- purchasers and receiving staff;
- sales representatives;
- accountants and finance reviewers;
- platform support staff only through separately governed, audited capabilities.

A person may hold more than one membership or responsibility. The app therefore exposes workspaces and capabilities rather than forcing one permanent role selection.

## 3. Included product surfaces

### Operational home

- active tenant, legal entity, store and warehouse context;
- synchronisation and data-freshness state;
- risk-ordered action queue;
- shortcuts based on permissions and assigned work;
- notification and approval inbox.

### Inventory and warehouse

- barcode/SKU/product lookup;
- bounded stock availability and movement history;
- purchase-order receiving;
- transfer dispatch and receipt;
- physical-count sessions, recounts and variance submission;
- batch, serial and expiry capture where the item policy requires it;
- pick, pack and delivery/pickup confirmation where MOD-C permits it.

### Procurement

- requisition and purchase-order review;
- approval where policy permits mobile approval;
- receiving discrepancies and inspection decisions;
- supplier and cost history through permission-scoped queries;
- replenishment proposals after the relevant read model is available.

### Customer and sales

- customer lookup and quick permitted creation;
- quotation creation and revision;
- sales-order lookup and selected updates through task-oriented commands;
- credit status and approval request;
- fulfilment and return status;
- collection or payment-status visibility without collecting raw card data.

### Approvals and exception handling

- refund, discount, price-override, inventory-variance, purchase, credit and selected finance approvals;
- explicit reason, evidence, assurance and threshold requirements;
- deep link to the source document and immutable effects;
- no approval by push notification alone.

### Finance review

- receivable, payable, payment, settlement and reconciliation exceptions;
- close-readiness and period status;
- governed financial summaries after MOD-G integration;
- no unrestricted mobile manual journal entry in the first commercial release.

## 4. Explicit exclusions

MOB-01 does not implement:

- native checkout or mobile cash register;
- payment-terminal SDK integration;
- cash drawer, receipt printer, customer display, scale or fiscal device control;
- POS shift cash operations;
- an independent catalog, inventory, sales or accounting backend;
- direct Neon PostgreSQL access;
- a second authorization engine;
- editable balances or client-side tax/accounting calculation;
- full platform administration, country-pack authoring or integration-secret management;
- unrestricted report builder or data export of restricted records.

## 5. Why development starts now

The reviewed integration baseline already provides stable identity, tenant context, permissions, catalog, pricing/tax snapshots, inventory/procurement, customer/sales/fulfilment, payments/accounting/banking and MOD-D device/offline primitives. This is sufficient for mobile foundation and several operational workflows.

MOD-F is still finalising localisation and compliance. MOD-G is still responsible for governed cross-module reporting, public integration contracts and SaaS administration. The mobile programme therefore uses dependency gates:

- start foundation and operational modules now;
- finalise effective locale, currency, business-date and country-capability behaviour after MOD-F integration;
- finalise executive dashboards, KPI drill-through, scheduled reports and generated public clients after MOD-G integration.

## 6. Delivery phases

### Phase M0 — documentation and contract freeze

- approve ADR-007;
- approve personas, capability and offline matrices;
- register MOB-01 ownership;
- publish mobile API schemas and compatibility policy;
- record contract-change requests;
- prepare deterministic fixtures.

### Phase M1 — Flutter foundation

- Flutter pub workspace and pinned toolchain;
- Android/iOS application shells and environment flavours;
- Operations Ledger mobile tokens/components;
- OIDC/OAuth authorization-code flow with PKCE;
- session/device lifecycle and revocation response;
- workspace selector and capability navigation;
- local SQL, secure storage and sync framework;
- telemetry, crash-safe error handling and test harness.

### Phase M2 — operational companion

- catalog/barcode and stock lookup;
- receiving, count and transfer workflows;
- customer, quote and order workflows;
- approval inbox and source-document deep links;
- finance operational exception reads;
- camera/document capture through signed upload contracts.

### Phase M3 — localisation and country integration

- effective locale and fallback chain;
- BCP 47, RTL and mixed-script behaviour;
- exact currency display and cash-rounding evidence;
- timezone/business date;
- country-pack feature limitations and legal/fiscal status presentation.

### Phase M4 — reporting and communication integration

- governed owner/manager/finance dashboards;
- metric definition, period, currency and freshness display;
- drill-through to source documents and ledgers;
- notification provider, preference and delivery-state integration;
- generated client from approved OpenAPI schemas;
- entitlement and plan-aware feature exposure.

### Phase M5 — pilot and store release

- controlled synthetic and pilot tenants;
- Android and iOS device matrix;
- security and privacy review;
- accessibility/localisation review;
- offline/recovery and migration drills;
- staged internal, closed and production tracks;
- support and rollback runbooks.

## 7. Success criteria

Store Companion is successful when an authorised user can complete the assigned mobile workflows without bypassing server rules, understand whether data is current or pending, recover from network or app interruption, and trace approvals and important values back to authoritative source documents and ledger effects.

A screen is not complete merely because it renders. It requires authorization, tenant/location scope, localisation, error recovery, offline classification, audit effects, tests, telemetry, documentation and a compatible API contract.
