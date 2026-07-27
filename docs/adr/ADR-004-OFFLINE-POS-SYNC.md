# ADR-004: Offline POS Uses a Durable Local Operation Log and Idempotent Sync

- **Status:** Accepted for planning; country/payment validation required
- **Date:** 2026-07-27
- **Decision owners:** Product/POS/Architecture

## Context

Retail stores must continue selected operations during network failures. Caching screens or carts is insufficient: completed local sales, cash movements and shifts must survive restart, synchronize safely and remain legally valid where offline operation is allowed.

Multiple registers may be offline simultaneously. Server and catalog state may change during the outage. Payment and fiscal rules differ by provider/country.

## Decision

Build the POS as an installable client with:

- versioned local catalog/price/tax/policy projection;
- durable local database;
- append-only operation log committed before reporting local success;
- globally unique operation ID and monotonic device sequence;
- signed, scoped and expiring offline authorization;
- cursor-based download and batched upload protocols;
- server inbox/deduplication keyed by tenant/device/operation;
- explicit accepted, adjusted, rejected and review outcomes;
- manager reconciliation console;
- country-pack-defined legal numbering/fiscal behavior;
- provider-capability-defined offline payment behavior.

The server remains canonical after synchronization. It never silently discards or rewrites a locally completed transaction.

## Rationale

An operation log supports crash recovery, retry, ordering evidence, audit and deterministic deduplication. Explicit conflict policies are safer than generic last-write-wins. Separating commercial sale, payment and fiscal status allows provider/country-specific recovery.

## Consequences

### Positive

- stores can continue permitted operations during outages;
- browser/device restart does not lose committed local work;
- duplicate uploads do not duplicate financial effects;
- conflicts are visible and auditable;
- client projections can be rebuilt independently;
- offline risk is configurable by tenant/country/provider.

### Negative

- substantial client/server protocol and testing complexity;
- stale price/stock/permission conflicts are unavoidable;
- gift card/credit/loyalty redemption may need online restriction;
- app/local schema compatibility must be maintained;
- legal receipt and offline-card support require market-specific validation;
- device compromise/loss creates residual risk.

## Operation envelope

Every operation includes:

- local operation ID;
- device/register/tenant/store;
- local sequence;
- actor and authorization snapshot;
- business date and timestamps;
- operation/schema version;
- last server cursor;
- payload and hash;
- sync/result state.

Same operation ID and request returns the original server result. Same ID with a different payload is rejected as tampering/conflict.

## Conflict rules

- No universal last-write-wins.
- Duplicate: original result.
- Stale price/tax/promotion: country/tenant tolerance or review.
- Insufficient stock: negative-stock policy; preserve local evidence.
- Revoked user/device: signed authorization expiry/cutoff rules.
- Shift conflict: reconciliation exception, not deletion.
- Payment unknown: provider status query/webhook before retry.
- Legal number conflict: prevented through approved allocation/device/provider strategy.
- High double-spend values: online-only or tightly limited.

## Offline scope

Default allowed:

- cash sale;
- customer quick-create;
- permitted discount/price override with approval;
- cash shift/events;
- receipt printing;
- loyalty earn as pending.

Default restricted/provider-dependent:

- card store-and-forward;
- refund to electronic tender;
- gift card/store-credit/loyalty redemption;
- customer credit beyond signed limit;
- controlled goods;
- fiscal/e-invoice issuance;
- stock transfer/receiving final posting.

The country pack and provider capability matrix override defaults only with documented validation.

## Client architecture

Baseline PWA with service worker and IndexedDB. Add a signed local hardware agent or desktop shell only for reliable device access, encrypted SQLite, kiosk or fiscal-terminal needs. The agent does not own business truth.

## Security

- enrolled/revocable device credentials;
- signed short-lived offline authorization;
- OS keystore/encrypted local storage where possible;
- no PAN/CVV or reusable provider secrets locally;
- auto-lock/user switching;
- signed updates and compatibility manifest;
- redacted telemetry;
- remote device health/revoke.

## Validation

Mandatory tests:

- crash after local commit;
- lost server response and duplicate upload;
- out-of-order batches;
- 24-hour high-volume outage;
- final-unit contention across registers;
- stale price/tax/permission;
- app/schema update with pending operations;
- printer/terminal failure;
- payment authorization with unknown response;
- receipt range exhaustion;
- device revocation and clock drift;
- server restore followed by replay.

## Reconsider when

- target countries prohibit required offline operation;
- browser storage/hardware reliability fails pilot requirements;
- native/desktop deployment is mandatory for most launch stores;
- provider offline payment risk is unacceptable;
- operational support cost exceeds customer value.

The system may narrow offline capabilities, but must not replace durable logging with an unsafe cache-only approach.

## Related documents

- `docs/07-POS-OFFLINE-HARDWARE.md`
- `docs/08-INTERNATIONALIZATION.md`
- `docs/13-TESTING-OBSERVABILITY-SRE.md`
