# CCR-0003 — Additive First-Party Store Companion Contracts

- **Status:** Proposed
- **Requesting stream:** MOB-01 — Store Companion Mobile
- **Request checkpoint:** documentation/activation checkpoint
- **Starting base:** `47129e25191d1b1c8a8523dcd8f83c2a0b0edf55`
- **Requested owners:** Foundation/programme integration plus affected module owners
- **Breaking change:** No

## 1. Current contract

The platform already provides:

- OIDC/JWKS identity, memberships, scoped permissions, MFA/session hooks and session/device revocation foundations;
- stable request context, errors, audit, idempotency, outbox/inbox and trace contracts;
- module-owned task APIs for catalog/pricing/tax, inventory/procurement, customer/sales/fulfilment, POS/cash and payments/accounting/banking;
- MOD-D device enrolment, health, offline operation and idempotent synchronization concepts for POS;
- localisation/country and reporting/integration contracts owned by MOD-F and MOD-G.

There is no approved first-party contract for a non-POS native companion client that needs bounded bootstrap/workspace composition, mobile device/push-token lifecycle, permission-scoped change feeds and generic per-operation batch outcomes across approved module commands.

## 2. Requested additive contracts

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

Approval decisions continue through the owning module workflow. No new parallel approval database/state is requested.

### `MobileNotificationReferenceV1`

Minimal authorised reference/read state for mobile inbox and push deep links. Push payloads contain no restricted business details and require server reauthorization.

## 3. Business reason

Without these additive first-party contracts, MOB-01 would either:

- call many module APIs with client-specific composition and inconsistent bootstrap/sync behaviour;
- copy policy and module state into mobile-specific tables;
- reuse POS register/device authority incorrectly;
- guess MOD-F/MOD-G contracts;
- or create a separate backend/database.

The requested contracts allow one secure client composition layer while preserving domain ownership and canonical data.

## 4. Alternatives considered

### Use only direct module APIs

Retained where an existing API fits the mobile task. Insufficient alone for bootstrap, workspace selection, bounded change feed, device/push lifecycle and per-operation batch transport.

### Reuse MOD-D POS sync unchanged

Rejected. POS sync includes register, receipt, cash and selling risk concepts that do not apply to a companion client. Only compatible envelope/idempotency/status principles should be reused.

### Create mobile-owned PostgreSQL tables and policies

Rejected. MOB-01 owns no canonical business schema. Device registration or shared sync metadata must be Foundation/programme-owned or explicitly assigned.

### Add Firebase/Firestore mobile backend

Rejected because it creates dual authority, duplicated security and reconciliation risk.

## 5. Affected streams

- Foundation/programme integration — identity/device/session, shared errors, request context and route composition;
- MOD-A — bounded catalog/price/tax projection references;
- MOD-B — receiving/count/transfer commands and projections;
- MOD-C — customer/quote/order/fulfilment commands and projections;
- MOD-D — compatible device/sync envelope principles without POS authority;
- MOD-E — finance operational read/approval references;
- MOD-F — effective localisation/country/privacy/cache restrictions;
- MOD-G — metric/report/notification/entitlement/OpenAPI composition;
- MOB-01 — generated client, local sync and UI.

## 6. Security and privacy impact

Controls required:

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

1. Approve schemas as additive `v1` first-party contracts.
2. Provide deterministic fixtures before backend implementation.
3. Add Foundation/mobile composition interfaces behind feature flags.
4. Let each owning module publish bounded adapters/read-contract extensions.
5. Maintain supported server/client compatibility window.
6. Test old supported clients with additive fields/enum values.
7. Enable in synthetic development/staging only.
8. Integrate MOD-F and MOD-G fields when their contracts are reviewed.
9. Pilot with explicit device/client version gates.
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

## 10. Approval boundary

MOB-01 may build client interfaces and deterministic fixtures while this request is reviewed. It must not silently add shared Foundation tables, permissions, error meanings or cross-module reads. Backend implementation of each extension occurs through the approved owner/integration path.
