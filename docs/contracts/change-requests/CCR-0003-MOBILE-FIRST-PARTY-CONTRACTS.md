# CCR-0003 — Additive First-Party Store Companion Contracts

- **Status:** Accepted — additive contract family; server adapters remain owner-gated
- **Requesting stream:** MOB-01 — Store Companion Mobile
- **Request checkpoint:** documentation/activation checkpoint
- **Starting base:** `47129e25191d1b1c8a8523dcd8f83c2a0b0edf55`
- **Decision owner:** Programme integration with Foundation/module ownership preserved
- **Decision date:** 2026-07-29
- **Breaking change:** No

## 1. Current contract

The platform already provides:

- OIDC/JWKS identity, memberships, scoped permissions, MFA/session hooks and session/device revocation foundations;
- stable request context, errors, audit, idempotency, outbox/inbox and trace contracts;
- module-owned task APIs for catalog/pricing/tax, inventory/procurement, customer/sales/fulfilment, POS/cash and payments/accounting/banking;
- MOD-D device enrolment, health, offline operation and idempotent synchronization concepts for POS;
- localisation/country and reporting/integration contracts owned by MOD-F and MOD-G.

There was no approved first-party contract for a non-POS native companion client that needs bounded bootstrap/workspace composition, mobile device/push-token lifecycle, permission-scoped change feeds and generic per-operation batch outcomes across approved module commands.

## 2. Accepted additive contracts

### `MobileBootstrapV1`

Bounded first-party client context:

- identity/session assurance reference;
- registered device status;
- selectable workspace contexts;
- active workspace;
- effective capability summary and approval limits;
- module entitlements/feature flags;
- locale, timezone, business date, currency and country capability references;
- API/sync/client/local-schema compatibility ranges;
- cache/data-classification restrictions.

It does not expose full policy tables or grant authority.

### `MobileWorkspaceContextV1`

Opaque server-issued/verified context referencing:

- tenant;
- legal entity;
- store/warehouse where applicable;
- persona/task context;
- capability version/expiry.

Arbitrary client-supplied IDs cannot replace current authorization.

### `MobileDeviceRegistrationV1`

Additive non-POS device/install record or interface supporting:

- environment, platform, app version/build;
- status, enrol/revoke and last-seen;
- push-token references/rotation;
- session/device risk references;
- audit and privacy-safe diagnostics.

This must reuse Foundation identity/session revocation primitives and must not duplicate POS register authority.

### `MobileChangeFeedV1`

Permission-scoped cursor/snapshot interface for approved read projections:

- collection/schema/projection version;
- opaque scoped cursor;
- bounded upserts/tombstones;
- source version, freshness and high-water state;
- signed R2 snapshot metadata for large initial projections;
- scope-revocation invalidation.

It must consume published module read contracts/events rather than read private tables without ownership approval.

### `MobileOperationBatchV1`

Generic transport envelope only:

- device/workspace context;
- operation ID/local sequence;
- operation type/schema version;
- idempotency key and payload hash;
- base version and dependencies;
- exact business date/timestamps;
- bounded operation payload.

Each operation is dispatched to the owning module's existing application command. The mobile contract does not define domain business rules.

### `MobileOperationResultV1`

Per-operation outcomes:

- accepted;
- accepted with adjustment;
- duplicate replay;
- deferred;
- requires online confirmation;
- requires approval;
- conflict;
- rejected;
- superseded;
- unknown external state;
- server reference/version, stable error and trace ID.

### `MobileApprovalReferenceV1`

A composition/read contract referencing owning-module approval state:

- source module/document/action;
- current request/version;
- risk/expiry/threshold context where authorised;
- required assurance;
- safe preview fields;
- supported decisions.

Approval decisions continue through the owning module workflow. No new parallel approval database/state is created.

### `MobileNotificationReferenceV1`

Minimal authorised reference/read state for mobile inbox and push deep links. Push payloads contain no restricted business details and require server reauthorization.

## 3. Business reason

Without these additive first-party contracts, MOB-01 would either:

- call many module APIs with client-specific composition and inconsistent bootstrap/sync behaviour;
- copy policy and module state into mobile-specific tables;
- reuse POS register/device authority incorrectly;
- guess MOD-F/MOD-G contracts;
- or create a separate backend/database.

The accepted contracts allow one secure client composition layer while preserving domain ownership and canonical data.

## 4. Alternatives considered

### Use only direct module APIs

Retained where an existing API fits the mobile task. Insufficient alone for bootstrap, workspace selection, bounded change feed, device/push lifecycle and per-operation batch transport.

### Reuse MOD-D POS sync unchanged

Rejected. POS sync includes register, receipt, cash and selling risk concepts that do not apply to a companion client. Only compatible envelope/idempotency/status principles are reused.

### Create mobile-owned PostgreSQL tables and policies

Rejected. MOB-01 owns no canonical business schema. Device registration or shared sync metadata must be Foundation/programme-owned or explicitly assigned.

### Add Firebase/Firestore mobile backend

Rejected because it creates dual authority, duplicated security and reconciliation risk.

## 5. Affected streams and ownership decision

- **Foundation/programme integration** owns identity/device/session integration, request context, shared errors, bootstrap/workspace composition interfaces and any approved shared persistence.
- **MOD-A** owns bounded catalog/price/tax projection adapters.
- **MOD-B** owns receiving/count/transfer commands and projections.
- **MOD-C** owns customer/quote/order/fulfilment commands and projections.
- **MOD-D** provides compatible device/sync envelope principles without granting POS/register authority.
- **MOD-E** owns finance operational read and approval references.
- **MOD-F** owns effective localisation/country/privacy/cache restrictions.
- **MOD-G** owns governed metric/report/notification/entitlement composition and canonical public OpenAPI publication.
- **MOB-01** owns Dart transport/application models, local sync, native UI and platform integration only.

Acceptance of this CCR does not transfer another workpack's tables, permissions, commands or read models to MOB-01.

## 6. Security and privacy impact

Required controls:

- server-side authorization on every query/command;
- opaque scoped workspace/cursor/device references;
- no restricted data in push payloads;
- data classification and TTL in bootstrap/feed;
- tenant/workspace cache partition and revocation invalidation;
- idempotency and request hash mismatch detection;
- stable masked/denied errors without existence leakage;
- push token and device lifecycle audit;
- no card secrets, database credentials or provider secrets;
- bounded payloads and rate limits;
- traceability without raw business payload telemetry.

## 7. Finance and inventory impact

- No client-authoritative totals, availability, stock posting or journal posting.
- Queued commands dispatch to owning modules and return their authoritative result.
- Same operation/idempotency key cannot duplicate stock, payment, journal or approval effects.
- Exact money/quantity representations are preserved.
- Unknown payment/external state blocks blind retry.
- Mobile cached stock is labelled by freshness and never checkout authority.

## 8. Rollout and compatibility

1. The `v1` client contract family is accepted as additive.
2. Deterministic fixtures and dependency-free Dart contract models may be implemented immediately.
3. Foundation/mobile composition interfaces are added behind feature flags through the owning integration path.
4. Each module publishes bounded adapters/read-contract extensions under its ownership.
5. Supported server/client compatibility windows are maintained and tested.
6. Old supported clients tolerate additive fields and unknown enum/status values safely.
7. Initial execution remains synthetic development/staging only.
8. MOD-F and MOD-G fields are integrated after their reviewed contracts land.
9. Pilot uses explicit device/client version gates.
10. Production activation requires separate release authorization.

No existing web/POS/public API is removed or repurposed.

## 9. Required tests

- bootstrap membership/scope/capability cases;
- cross-tenant workspace/cursor/device negative tests;
- permission removal and revocation;
- idempotent operation replay and hash mismatch;
- partial/out-of-order batches;
- unknown additive enums and compatibility window;
- cursor expiry/snapshot rebuild;
- restricted tombstone and push-payload privacy;
- owning-module command delegation/no private table write;
- exact quantity/money serialization;
- no duplicate stock/payment/journal/approval effects;
- MOD-F effective config/cache restriction;
- MOD-G metric definition/freshness/entitlement behaviour;
- trace/log redaction.

## 10. Acceptance evidence

The initial client-side implementation provides:

- `mobile/packages/api_client` with strict `MobileBootstrapContract`, workspace, localisation, compatibility, operation/result and safe error parsing;
- preservation of unknown additive operation statuses;
- explicit unknown-external-state blind-retry blocking;
- exact client money model using integer minor units;
- pure sync reducer separating authoritative server outcomes from transport retry;
- unit/widget/contract tests under the pinned Flutter/Dart toolchain;
- Mobile Foundation CI run `30456836145`, which passed exact toolchain verification, workspace resolution, formatting, analysis, tests and clean-source verification.

This is client-boundary evidence only; it does not claim the Worker routes or module adapters are deployed.

## 11. Integration decision

CCR-0003 is accepted as a non-breaking additive contract family.

MOB-01 may continue implementing:

- client models and generated-schema seam;
- deterministic fixtures;
- local operation/sync state;
- capability-aware UI;
- synthetic contract tests.

Server-side work remains gated as follows:

- no shared Foundation table, permission or route is added without programme-integration review;
- no module-private table is read or written by mobile composition code;
- each module adapter is implemented or approved by its owning stream/integration path;
- MOD-G remains the owner of the canonical published OpenAPI and governed cross-module reporting contracts;
- production enablement remains feature-flagged and separately authorised.

Rollback is additive: disable the mobile feature/routes and retain existing web/POS APIs unchanged. No destructive migration or repurposed field is approved by this decision.
