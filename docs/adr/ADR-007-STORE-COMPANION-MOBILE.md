# ADR-007 — Store Companion Native Mobile Application

- **Status:** Accepted for controlled parallel implementation
- **Decision date:** 2026-07-29
- **Decision owner:** Programme coordinator
- **Implementation workpack:** `MOB-01 — Store Companion Mobile`
- **Starting reviewed base:** `47129e25191d1b1c8a8523dcd8f83c2a0b0edf55`

## Context

The store-management platform already defines separate POS, administration, customer and mobile clients. The web/PWA programme owns the authoritative operational and POS experiences, while a native mobile client is valuable for owners, managers, inventory and warehouse staff, purchasers, sales representatives and finance reviewers who work away from a desktop or register.

Native POS is deliberately excluded from this decision. The integrated MOD-D PWA remains the checkout, cash-shift, receipt and hardware path. The mobile application is a companion client for management, approvals, lookup, receiving, stock count, transfer, sales and review workflows.

The platform is still progressing through MOD-F localisation/compliance and MOD-G reporting/integrations/SaaS administration. Waiting for all web work to finish would unnecessarily delay mobile architecture, authentication, design, local-data and device-quality work. Building the full app against speculative reporting and localisation contracts would create avoidable rework.

## Decision

Build one Flutter application named **Store Companion** with permission- and scope-driven experiences for multiple operational personas.

The application may begin in parallel now under an isolated whole-module workpack. It must:

1. consume the existing Cloudflare Worker APIs and published module contracts;
2. never connect directly to Neon PostgreSQL;
3. never become an independent business system or source of truth;
4. use a bounded local SQLite store only for cached projections, drafts, operation envelopes and sync metadata;
5. keep all authoritative permissions, pricing, tax, stock, sales, payment and accounting rules on the server;
6. inherit the Operations Ledger design system rather than introduce a second visual language;
7. use capability-aware navigation and workspace scope rather than hard-coded role checks;
8. defer governed executive KPI dashboards, scheduled reports and public OpenAPI generation until MOD-G contracts are integrated;
9. defer final country-pack behaviour until MOD-F is integrated;
10. keep native checkout, payment-terminal, fiscal-device, cash-drawer and receipt-printer workflows out of MOB-01.

## Application shape

Use one Flutter pub workspace under `mobile/`:

```text
mobile/
  pubspec.yaml
  apps/store_companion/
  packages/app_core/
  packages/design_system/
  packages/api_client/
  packages/auth/
  packages/local_data/
  packages/sync_engine/
  packages/feature_inventory/
  packages/feature_procurement/
  packages/feature_sales/
  packages/feature_approvals/
  packages/feature_finance/
```

The initial package set is a boundary plan, not permission to create empty packages. A package is created only when it owns a coherent reusable responsibility.

## Client architecture

Use the Flutter-recommended separation of views, view models, repositories and services:

```text
Views
  -> ViewModels
    -> optional use cases for multi-repository workflows
      -> Repositories
        -> remote services / local SQL / platform services
```

Repositories are the application-facing source of truth. They reconcile remote authoritative state with local cached or pending state. Widgets do not contain business rules or call transport/database adapters directly.

## Backend relationship

```text
Store Companion
  -> Cloudflare edge API/mobile BFF
    -> existing application commands and permission-aware queries
      -> module-owned domain logic
        -> Neon PostgreSQL canonical data
```

A mobile BFF may compose bounded screen responses, bootstrap context, cursor feeds and per-operation outcomes. It may not reproduce domain calculations or bypass module ownership.

## Database decision

- Neon PostgreSQL remains the only canonical transactional database.
- No Firebase, Firestore, Supabase or separate mobile business database is introduced.
- Device SQLite is non-authoritative and rebuildable.
- Pending operations survive projection rebuild, logout interruption and supported schema upgrades.
- Sensitive local data is minimised and encrypted with keys protected by platform keystore/keychain facilities.

## Parallel execution decision

MOB-01 may start from the reviewed post-MOD-D integration baseline. Development proceeds with frozen contracts and deterministic fixtures where dependencies are unfinished.

Final programme integration remains serial and occurs after MOD-G, unless the programme coordinator explicitly approves an earlier additive mobile-foundation integration checkpoint. MOB-01 must continuously merge reviewed integration checkpoints non-destructively; it must not reset, rebase destructively or import unreviewed module internals.

## Consequences

### Positive

- Mobile foundation and device testing begin without delaying MOD-F or MOD-G.
- One codebase serves Android and iOS.
- Operational workflows reuse existing module invariants and data.
- Native POS complexity remains isolated from the companion roadmap.
- Capability-driven UX supports users with multiple roles and scopes.

### Costs and risks

- Contract fixtures and generated clients require compatibility discipline.
- Background execution differs between Android and iOS and cannot guarantee immediate sync.
- Local data introduces migration, encryption, storage-pressure and conflict-recovery work.
- MOD-F and MOD-G changes must be consumed through reviewed additive contracts.

## Rejected alternatives

### Wait until the web platform is complete

Rejected because identity, design, local-data, device security and operational module contracts are already mature enough for parallel foundation work.

### Build a second independent backend or database

Rejected because it would duplicate permissions and business rules, create dual-master conflicts and weaken ledger correctness.

### Build separate apps for every role

Rejected because roles overlap, users may hold multiple memberships and separate binaries would duplicate infrastructure and release work.

### Build native POS now

Rejected because MOD-D already provides the approved PWA/offline/hardware path and native payment/fiscal hardware requirements are not yet justified.

## Standards and primary references

- Flutter application architecture: https://docs.flutter.dev/app-architecture
- Flutter architecture recommendations: https://docs.flutter.dev/app-architecture/recommendations
- Flutter offline-first guidance: https://docs.flutter.dev/app-architecture/design-patterns/offline-first
- Dart pub workspaces: https://dart.dev/tools/pub/workspaces
- OAuth 2.0 for native apps: https://www.rfc-editor.org/rfc/rfc8252
- Android persistent work: https://developer.android.com/develop/background-work/background-tasks/persistent
- Apple BackgroundTasks: https://developer.apple.com/documentation/backgroundtasks
- OWASP MASVS: https://mas.owasp.org/MASVS/
