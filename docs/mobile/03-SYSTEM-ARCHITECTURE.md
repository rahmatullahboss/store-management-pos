# Store Companion — System Architecture

## 1. Architecture goals

- Reuse the existing Cloudflare Worker and Neon-backed business platform.
- Keep the mobile client replaceable and non-authoritative.
- Support multiple roles and locations without duplicating applications.
- Remain usable on low-cost devices and intermittent networks.
- Make offline, stale, pending, rejected and restricted states explicit.
- Preserve exact money/quantity, immutable ledgers and server-side authorization.
- Allow MOD-F and MOD-G contracts to be integrated later without redesigning the app.

## 2. System context

```text
Android / iOS Store Companion
        |
        | TLS + OAuth/OIDC + versioned JSON
        v
Cloudflare edge gateway / mobile composition routes
        |
        +-- identity, tenant and workspace resolution
        +-- rate limits, request/trace IDs, API version negotiation
        +-- bounded mobile bootstrap/read composition
        |
        v
Regional modular-monolith application
        |
        +-- Catalog / Pricing / Tax
        +-- Inventory / Procurement
        +-- Customer / Sales / Fulfilment
        +-- POS / Cash contracts where relevant
        +-- Payments / Accounting / Banking
        +-- Localisation / Compliance
        +-- Reporting / Integrations / SaaS
        |
        v
Neon PostgreSQL authoritative data + R2 + Queues + Workflows
```

The mobile client never receives database credentials and never accesses module tables. It consumes published task commands and permission-aware queries.

## 3. Repository topology

Flutter is isolated from the npm workspace:

```text
mobile/
  pubspec.yaml                  # pub workspace root
  analysis_options.yaml
  apps/
    store_companion/
      pubspec.yaml
      lib/
      test/
      integration_test/
      android/
      ios/
  packages/
    app_core/
    design_system/
    api_client/
    auth/
    local_data/
    sync_engine/
    feature_inventory/
    feature_procurement/
    feature_sales/
    feature_approvals/
    feature_finance/
```

The root npm `apps/*` and `packages/*` globs are not used for Flutter code. Mobile CI runs from `mobile/` and does not change the TypeScript package manager or workspace graph.

## 4. Flutter application layers

### Presentation layer

Contains:

- views/widgets;
- feature routes;
- view models/state holders;
- presentation models;
- user interaction and accessibility semantics.

Rules:

- Views render state and forward user intent.
- View models coordinate repositories and expose immutable UI state.
- Widgets do not calculate prices, taxes, available stock, approval eligibility or accounting effects.
- Navigation guards are convenience only; server authorization remains mandatory.

### Domain/use-case layer

Use cases are introduced only for workflows that combine multiple repositories or require reusable client orchestration, such as:

- submit a receiving batch with staged evidence uploads;
- submit a stock count while preserving pending operations;
- refresh bootstrap and purge revoked cached scopes;
- recover an interrupted operation and reconcile its result.

Simple reads and commands may go directly from a view model to a repository. Do not create ceremonial use-case classes for every method.

### Data layer

Repositories own application-facing data behaviour. They may combine:

- remote API services;
- local SQL data sources;
- secure key/value storage;
- camera/file/platform services;
- connectivity and background-work adapters.

Repositories decide whether a feature is remote-only, local-first, cached-read or queued-write according to `05-OFFLINE-SYNC.md`.

### Platform layer

Adapters isolate:

- secure storage/keychain/keystore;
- SQLite implementation;
- camera/barcode scanning;
- notifications/deep links;
- Android WorkManager;
- Apple BackgroundTasks;
- network reachability hints;
- biometrics for local unlock or step-up handoff;
- crash and telemetry SDKs.

No platform plugin becomes a business-data source of truth.

## 5. Dependency direction

```text
feature UI
  -> feature view models
    -> repositories/interfaces
      -> remote/local/platform implementations
        -> generated API schemas and storage adapters
```

Forbidden dependencies:

- feature package importing another feature's private data source;
- UI importing SQLite or HTTP client directly;
- local database models becoming API/domain models;
- generated transport classes leaking throughout the UI;
- design-system package depending on feature packages;
- business logic in platform channels;
- mobile packages importing server module persistence internals.

Architecture tests and Dart import rules must enforce these boundaries.

## 6. State management and dependency injection

MOB-01 will select one maintained state-management/DI approach during implementation after licence and compatibility review. The durable requirement is architectural, not package-specific:

- explicit dependencies;
- testable view models;
- deterministic cancellation/disposal;
- no global mutable service locator holding tenant/user state;
- active workspace changes invalidate dependent repositories and caches;
- asynchronous states preserve loading, stale data, error and retry context.

The package choice must be recorded in the open-source reuse register and an implementation note. Avoid combining multiple competing state-management systems.

## 7. Navigation

Use declarative routing with:

- unauthenticated/authenticated route trees;
- bootstrap and minimum-version gates;
- capability-aware destinations;
- nested feature navigation;
- Android App Links and iOS Universal Links;
- notification/deep-link reauthorization;
- restorable route state where safe;
- phone bottom navigation and adaptive tablet navigation rail.

The app must handle:

- session revoked while on a protected route;
- workspace removed or changed;
- capability removed;
- deep link to a missing/restricted/superseded document;
- required step-up authentication;
- offline opening of a non-cached online-only route.

## 8. Mobile BFF/composition layer

A mobile-specific route family may be mounted inside the existing Worker API. Its responsibilities are limited to:

- bootstrap composition;
- workspace/capability summaries;
- bounded home/approval queue composition;
- cursor-based change feeds;
- batch operation envelopes and per-item results;
- mobile-compatible field selection and pagination;
- device/push-token lifecycle;
- compatibility metadata.

It must not:

- calculate domain totals;
- directly join or mutate private module tables;
- authorise solely from client capability claims;
- create independent approval state;
- hide source module errors or trace references;
- expose unrestricted cross-module data.

Where composition needs new module data, the owning module publishes a read-contract extension through the contract-change process.

## 9. Authoritative and local data

### Authoritative

- identities, memberships, roles and policies;
- products, price/tax versions and stock ledgers;
- purchase, sales, fulfilment and return documents;
- payments, journals, receivables, payables and reconciliation;
- approvals, audit and disclosure evidence;
- localisation/country-pack versions;
- reporting metrics/projections and freshness.

These remain in server-owned stores.

### Local and rebuildable

- bootstrap/workspace snapshot with expiry;
- capability snapshot with version/expiry;
- bounded catalog and stock projections;
- assigned work-list projections;
- drafts and staged attachment metadata;
- pending operation envelopes;
- operation results and conflict state;
- sync cursors and projection versions;
- notification references;
- app preferences that do not grant authority.

## 10. Local database design

Suggested logical tables:

```text
app_metadata
local_migration
profile
workspace
capability_snapshot
feature_flag_snapshot
catalog_item_projection
barcode_projection
stock_projection
assigned_work_projection
receiving_draft
stock_count_draft
transfer_draft
quote_draft
staged_attachment
pending_operation
operation_dependency
operation_result
sync_cursor
sync_snapshot
notification_reference
telemetry_outbox
```

Requirements:

- all tenant/business rows include tenant and relevant workspace scope;
- cached rows include source version, fetched-at and expiry/freshness metadata;
- pending operations live in storage separate from rebuildable projections;
- projection rebuild never deletes pending operations or unsent staged evidence;
- migrations are transactional, resumable and tested from supported versions;
- database logout/switch behaviour follows privacy policy and unsynchronised-operation safety;
- exact quantities and money are stored as strings/scaled integers, never binary floating point.

## 11. API model generation

- API schemas are versioned and reviewed in the server repository.
- Generate Dart transport models/clients from the approved first-party schema.
- Generated code is never edited manually.
- Repositories translate transport models into stable application models.
- Unknown additive enum values map to a safe `unknown` representation and do not crash the client.
- CI detects generated-code drift.
- Supported server/client compatibility ranges are tested.

Until MOD-G publishes the canonical external OpenAPI, MOB-01 uses an approved first-party mobile schema fixture owned by the programme, not guessed server internals.

## 12. Environment and configuration

Flavours/schemes:

- `development` — local/synthetic API and permissive diagnostics without production secrets;
- `staging` — integrated non-production backend and sandbox providers;
- `production` — production endpoints, restricted diagnostics and signed releases.

Configuration rules:

- no secrets in source or bundled configuration;
- environment endpoints are compile/build-time controlled and allowlisted;
- production builds reject development/simulator provider modes;
- feature flags cannot grant server authority;
- minimum/recommended client versions come from bootstrap;
- tenant branding is downloaded as bounded non-authoritative configuration.

## 13. Notifications and deep links

Push payloads contain minimal references:

```json
{
  "type": "approval.requested.v1",
  "reference_id": "...",
  "tenant_hint": "...",
  "deep_link": "https://approved-domain.example/mobile/approvals/..."
}
```

They must not include restricted customer, payment, supplier or financial details. The app opens the route only after authentication, workspace resolution and server authorization.

Notification delivery is a hint, not a source of truth. Missed or delayed push is recovered from the notification/approval query.

## 14. Background execution

Background sync is opportunistic:

- foreground startup/resume refresh;
- user-initiated sync;
- post-command immediate upload;
- Android constrained persistent work;
- iOS system-scheduled background refresh/processing;
- push-triggered refresh where the platform permits;
- exponential backoff with jitter and bounded retries.

No workflow depends on a background task running at an exact time. Critical approvals and legal/financial actions remain server-side and online.

## 15. Observability

Every remote operation propagates:

- request/trace ID;
- tenant and workspace reference where safe;
- actor/session/device reference where safe;
- client version/build;
- API/schema version;
- operation type;
- outcome/error code;
- retry count and latency.

Mobile telemetry includes low-cardinality device/app health, sync cursor age, pending/rejected counts, local migration version, storage pressure and crash fingerprints. It excludes business payloads, full IDs where not necessary, customer details, prices, supplier terms and payment data.

## 16. Scalability and performance

- Cursor pagination and bounded field selection by default.
- Local barcode lookup must not require network round trips after an authorised projection is present.
- Large catalog bootstrap uses versioned snapshots plus incremental cursor feeds.
- Images use thumbnails and lazy loading.
- Home views avoid fetching every module independently.
- Local queries are indexed by tenant/workspace, barcode, item and assigned-work status.
- Background and foreground sync share a single operation coordinator to avoid duplicate uploads.
- Low-end Android memory, storage and cold-start budgets are release gates.

## 17. Future extraction

A separate mobile BFF Worker may be extracted only when measured scale, independent release requirements or security isolation justify it. The starting implementation remains inside the existing modular application and uses published module interfaces.
