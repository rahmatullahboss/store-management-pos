# System Architecture

## 1. Architecture style

Use a **Cloudflare-first, Neon-backed, multi-tenant modular monolith with event-driven integrations**.

This means:

- one principal backend codebase and deployable API for the transactional product;
- strict domain module boundaries inside that application;
- one canonical PostgreSQL data plane per region;
- synchronous transactions for business invariants;
- asynchronous events for notifications, projections and external integrations;
- separate POS, admin, customer and mobile clients;
- Cloudflare edge services around the regional transactional core.

Microservices are not the starting architecture. They are an extraction option when a module has independent scale, regulatory isolation, release cadence, failure domain or team ownership.

## 2. Logical architecture

```text
                               ┌──────────────────────────┐
                               │ Global Control Plane     │
                               │ tenants, plans, routing  │
                               └────────────┬─────────────┘
                                            │ tenant region
┌──────────────┐   ┌───────────────────────▼────────────────────────┐
│ POS PWA      │   │ Cloudflare Edge                                 │
│ Admin Web    ├──►│ DNS/CDN/WAF/Turnstile/Rate Limiting             │
│ Mobile Apps  │   │ Static Assets + Workers API Gateway/BFF         │
│ Public API   │   └──────────────┬──────────────────────────────────┘
└──────────────┘                  │
                                  ▼
                   ┌─────────────────────────────────┐
                   │ Regional Transaction Application│
                   │ Modular Monolith on Workers     │
                   ├─────────────────────────────────┤
                   │ Identity / Tenant / Catalog     │
                   │ Pricing / Inventory / Purchase  │
                   │ Sales / POS / Payment / Customer│
                   │ Accounting / Localization       │
                   │ Integration / Reporting API     │
                   └──────────┬───────────┬──────────┘
                              │           │
                 Neon serverless driver  │ DO namespace
                              │           │
                  ┌───────────▼──────┐    ▼
                  │ Neon PostgreSQL  │  Durable Objects
                  │ canonical data   │  register/store coordinators
                  └───────┬──────────┘
                          │ transactional outbox
                          ▼
                     Cloudflare Queues
                     ├── projections
                     ├── webhooks
                     ├── notifications
                     ├── connectors
                     └── audit/export processing
                          │
                          ▼
                     Workflows
                     ├── import/export
                     ├── e-invoice/fiscal steps
                     ├── settlement reconciliation
                     ├── tenant lifecycle
                     └── long-running approvals

R2: product media, receipts, invoices, reports, import/export files
Analytics store: governed read models and long-range BI
```

## 3. Control plane and data plane

### Global control plane

Stores only platform-level data needed to route and operate tenants:

- tenant ID and region;
- subscription/plan and status;
- custom domain routing;
- feature rollout metadata;
- incident/maintenance state;
- support and billing references;
- data-plane health pointers.

It must not become a backdoor copy of customer transactional data.

### Regional data plane

Contains:

- tenant business data;
- regional Workers deployment/configuration;
- PostgreSQL cluster;
- regional R2/data-location policy where available;
- Queues/Workflows bindings;
- observability and backup setup.

A tenant is pinned to one home region for writes. Region migration is an explicit workflow with freeze, copy, verification and routing cutover.

## 4. Module boundaries

Recommended top-level modules:

```text
platform/
  identity
  tenancy
  entitlement
  audit

commerce/
  catalog
  pricing
  customer
  sales
  fulfillment

operations/
  inventory
  procurement
  pos
  cash

finance/
  payments
  accounting
  tax

extension/
  localization
  integrations
  automation
  reporting
```

Boundary rules:

- Each module owns its tables, domain objects and use cases.
- Modules call published application interfaces, not another module’s repositories.
- Direct cross-module table writes are forbidden.
- Read-only cross-module joins are limited to explicitly governed reporting projections.
- Cross-module domain events are versioned.
- Shared utility code cannot contain business rules.
- Cyclic module dependencies fail architecture tests.

Example dependency direction:

```text
Catalog <- Pricing <- Sales -> Fulfillment
    \          |        |
     \         |        +-> Payments
      \        +------------> Tax
       +--------------------> Inventory
Procurement ----------------> Inventory
Sales/Procurement/Inventory -> Accounting through posting interfaces
```

Accounting receives posting instructions or consumes stable internal events; it must not infer financial meaning by querying arbitrary operational tables.

## 5. Command and query design

Use explicit application commands for state changes:

- `CompletePosCheckout`
- `ReceivePurchaseOrder`
- `DispatchStockTransfer`
- `ReceiveStockTransfer`
- `PostPhysicalCountVariance`
- `ApproveRefund`
- `ClosePosShift`
- `ReconcileSettlement`

Each command has:

- authenticated actor and tenant context;
- idempotency key;
- input schema version;
- authorization and approval checks;
- domain validation;
- transaction boundary;
- audit metadata;
- deterministic response.

Queries use read models optimized for the screen/report. Do not expose database-shaped CRUD as the primary business API.

## 6. Transaction boundaries

Use one PostgreSQL transaction when all authoritative effects are internal and must be atomic.

Example POS cash checkout transaction:

1. validate cart snapshot and permission;
2. create/confirm sale and invoice;
3. create cash payment/tender entry;
4. post stock issue and cost consumption;
5. post accounting journal entries;
6. record receipt snapshot;
7. append audit event;
8. append outbox events;
9. commit;
10. return immutable checkout result.

External card authorization cannot be made truly atomic with the database. Use a state machine/saga:

1. create payment intent and checkout reservation;
2. call provider with idempotency key;
3. persist provider response;
4. finalize sale/postings if authorized/captured;
5. recover via provider webhook/status query if the client loses the response;
6. reverse/expire reservation if payment fails.

Every intermediate state is observable and repairable.

## 7. Durable Objects use

Use Durable Objects where a single logical coordinator must serialize actions:

- one coordinator per active register session;
- store-level live sequence allocator where legally appropriate;
- short-lived stock reservation coordinator for high-contention SKUs;
- live cart or customer-display channel;
- offline sync cursor/arbitration per device/register;
- websocket presence and real-time notifications.

Do not use one Durable Object for an entire tenant or global platform. Avoid making DO storage the canonical long-term accounting ledger.

State persisted in a DO must have a recovery relationship with PostgreSQL or be explicitly classified as ephemeral/auxiliary.

## 8. Queues and asynchronous processing

Cloudflare Queues provides at-least-once delivery. Therefore:

- every message has a globally unique event ID;
- consumers store processed IDs or use an idempotent database key;
- event handlers are retry-safe;
- retries use bounded exponential backoff;
- poison messages enter a dead-letter queue;
- operators can inspect and replay messages;
- events never carry secrets or unnecessary personal data.

Queue classes:

- domain event publication;
- webhook delivery;
- email/SMS/notification;
- search/report projection;
- integration synchronization;
- import row processing;
- file/document generation;
- analytics export.

Separate queues by workload and failure characteristics rather than putting all events in one stream.

## 9. Workflows use

Use Cloudflare Workflows for durable multi-step processes that may wait, retry or require external events:

- tenant provisioning/deprovisioning;
- country-pack activation/migration;
- large catalog or opening-balance import;
- invoice PDF generation and delivery;
- fiscal/e-invoice submission with retry and acknowledgement;
- payment settlement import and reconciliation;
- period close checklist;
- data export/privacy request;
- regional tenant migration;
- scheduled reports;
- supplier/customer statement generation.

A Workflow orchestrates steps; PostgreSQL remains the business source of truth. Every step should be idempotent and write business state explicitly.

## 10. Storage responsibilities

| Storage | Responsibility | Must not be used for |
|---|---|---|
| PostgreSQL | Canonical relational transactions and ledgers | Unbounded blobs/media |
| R2 | Images, attachments, generated documents, imports/exports | Transactional balances |
| Durable Object SQLite | Serialized coordinator state, realtime/session state | Global cross-tenant ledger |
| D1 | Bounded auxiliary databases, isolated lightweight projections | Default canonical finance/inventory |
| KV/Cache | Non-authoritative config, feature flags, safe cache | Permissions or balances without source verification |
| Client IndexedDB/SQLite | Offline catalog, carts and operation log | Final server authority |
| Analytics store | Historical aggregations and BI | Transaction processing |

## 11. Caching

Cache only data with a clear invalidation and staleness policy.

Safe candidates:

- public/static assets;
- product images;
- tenant branding;
- country-pack metadata;
- feature configuration with short TTL and version key;
- catalog/search projections;
- dashboard aggregates with “as of” timestamps.

Unsafe candidates without strict design:

- authorization decisions;
- stock available during checkout;
- gift-card/store-credit balances;
- payment status;
- fiscal document numbering;
- accounting period lock state.

Use versioned cache keys and event-driven invalidation. The source-of-truth write must never depend on cache success.

## 12. Search

Launch with PostgreSQL full-text/trigram or another regional search projection after benchmarking.

POS maintains a compact local index containing:

- variant ID;
- SKU/barcodes;
- localized display name;
- price snapshot/version;
- tax category;
- sale eligibility;
- selected stock availability snapshot;
- product image thumbnails where needed.

The local index syncs incrementally by cursor and can be rebuilt. Checkout submits the price/tax/version it used, and the server applies configured online/offline validation rules.

## 13. Reporting architecture

Use three read layers:

1. **Transactional drill-through:** source documents and ledgers in PostgreSQL.
2. **Operational projections:** near-real-time daily/store/product summaries.
3. **Analytics warehouse:** long-range BI, cohort, forecasting and custom analysis.

All aggregate metrics retain dimensions and source links needed to explain the result. Dashboard APIs return data freshness timestamps.

## 14. Integration architecture

Each provider adapter implements a capability contract rather than leaking provider-specific fields into core domains.

Examples:

```text
PaymentProvider
  capabilities()
  createIntent()
  authorize()
  capture()
  void()
  refund()
  queryStatus()
  verifyWebhook()
  normalizeWebhook()

FiscalProvider
  capabilities()
  issueReceipt()
  cancelOrCorrect()
  queryStatus()
  verifyResponse()

ShippingProvider
  getRates()
  createShipment()
  createLabel()
  track()
  cancelShipment()
```

Provider raw payloads are stored only in encrypted integration records with retention limits. Core tables store normalized state and external references.

## 15. API gateway and BFF

The edge API layer handles:

- tenant resolution by hostname/token;
- authentication and token verification;
- regional routing;
- rate limiting and abuse protection;
- request IDs and trace context;
- API version negotiation;
- request-size limits;
- safe response caching;
- client-specific response composition.

Business authorization and invariants remain inside domain modules, not solely at the gateway.

## 16. Client architecture

### Admin web

- responsive web application;
- online-first with resilient drafts and uploads;
- role-specific navigation and dashboards;
- accessibility and RTL support;
- no financial calculations trusted solely from the client.

### POS

- installable PWA as the baseline;
- service worker for application shell;
- IndexedDB or embedded SQLite for offline data and operation log;
- optional Tauri/Electron/native bridge for reliable hardware and local services;
- local encrypted database and device enrollment;
- background/explicit sync indicators;
- kiosk/fullscreen mode.

### Mobile

- management companion first: dashboards, approvals, stock lookup and receiving/counting;
- mobile POS later when payment/hardware/country requirements are defined.

## 17. Deployment topology

Recommended environments:

- local developer;
- shared development;
- per-PR preview for web and safe API mocks;
- integration/staging with sandbox providers;
- performance environment;
- production regional data planes.

Each production release uses:

- immutable build artifact;
- signed provenance/SBOM;
- staged/canary deployment;
- schema compatibility checks;
- feature flags for behavior rollout;
- automated smoke and ledger-invariant tests;
- rollback or forward-fix plan.

Database migrations are deployed separately from behavior activation when needed.

## 18. Failure modes and recovery

### PostgreSQL unavailable

- online writes fail closed;
- POS may continue configured offline sales;
- queued non-critical work waits;
- no fallback write to D1/KV that would create split authority.

### Queue delay/outage

- committed business transaction remains valid because the outbox is in PostgreSQL;
- publisher retries;
- lag alerts fire;
- operators replay events.

### Payment response lost

- idempotent provider request;
- query provider status and/or await signed webhook;
- do not blindly retry with a new intent.

### R2 unavailable

- transaction may complete without non-legal media where allowed;
- legal document generation enters pending state;
- retry via Workflow;
- preserve document data needed to regenerate.

### Durable Object restart

- recover authoritative state from PostgreSQL or DO persistent storage;
- never rely solely on in-memory state.

### POS device loss

- revoke device binding;
- server-side operations already synced remain safe;
- local unsynced operations are recoverable only if device backup/export policy permits;
- no reusable long-lived secrets in plaintext.

## 19. Service extraction criteria

Extract a module only when at least one is measured:

- independent load profile causes material resource contention;
- different data residency or compliance boundary;
- separate team needs independent release ownership;
- failure isolation provides clear value;
- technology requirement cannot fit Workers/runtime;
- database workload requires separate scaling;
- contractual isolation.

Before extraction, require:

- stable module API/event contracts;
- ownership of its data;
- migration and rollback plan;
- distributed consistency strategy;
- observability and operational staffing.

## 20. Recommended technology direction

- TypeScript for Workers/API and shared domain contracts.
- Standards-based web clients with a typed API client.
- PostgreSQL with explicit SQL migrations.
- A lightweight Workers-compatible HTTP framework and query layer selected through a compatibility/performance spike.
- Monorepo with enforceable package/module boundaries.
- OpenTelemetry-compatible tracing exported to the selected observability backend.
- Infrastructure as code for Cloudflare and database resources.

Framework and ORM selection is intentionally deferred until a spike validates Workers compatibility, transaction semantics, migration quality, bundle size, observability and long-term maintenance.
