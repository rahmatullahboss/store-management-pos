# MOD-A Contracts and Publishing Checkpoint

**Date:** 2026-07-28

## Combined price and tax contract

`calculatePriceAndTax` applies the controlled sequence:

1. resolve the effective price list and quantity rule;
2. calculate the exact line subtotal;
3. evaluate promotions, coupons and stacking controls;
4. calculate tax on the promoted amount using the effective tax configuration;
5. capture an immutable, deterministic `PriceTaxSnapshot`.

The snapshot retains:

- product/variant/unit and exact quantity;
- price-list and rule IDs plus immutable versions;
- unit price, subtotal, discount and promoted amount in minor units;
- promotion IDs, codes, versions and discounts;
- tax code, jurisdiction, treatment, price mode and exemption;
- every tax component and rate version;
- exact net, tax and gross reconciliation;
- rounding mode, calculation timestamp and SHA-256 calculation hash.

`PRC-0002` persists the snapshot as an append-only, forced-RLS record with idempotent replay, audit and outbox effects. Local runtime validation produced one snapshot, one audit and one outbox record; a duplicate request replayed the same result and the second tenant saw zero rows.

## POS catalog feed

`CAT-0003` provides a bounded full or incremental feed for POS/offline consumers:

- one fixed snapshot instant;
- deterministic `(updated_at, variant_id)` ordering;
- cursor validation requiring both values;
- `limit + 1` look-ahead paging;
- inactive variants remain visible as lifecycle tombstones;
- tenant context and `catalog.feed.read` permission.

Local runtime validation returned one Alpha row and zero Beta rows. Unit tests verify equal-timestamp ordering and continuation without duplicates or gaps.

## Publishing commands

`PRC-0003` and `TAX-0002` implement immutable publishing:

- root identity fields are immutable;
- expected-current-version conflicts fail closed;
- published versions and rules/rates are inserted, never rewritten;
- overlapping effective windows fail closed;
- root pointers advance only after all immutable rows are valid;
- idempotency, audit and outbox effects share the same transaction.

Validated locally under `store_app_runtime`:

- price list publish: initial `replayed=false`, duplicate `replayed=true`;
- promotion publish: initial `replayed=false`, duplicate `replayed=true`;
- tax configuration publish: initial `replayed=false`, duplicate `replayed=true`;
- exactly two pricing publish audit/outbox pairs and one tax publish audit/outbox pair.

## Event contracts

Module-owned versioned envelopes are available for:

- `catalog.product.changed.v1`;
- `pricing.price_list.published.v1`;
- `pricing.promotion.changed.v1`;
- `tax.configuration.published.v1`;
- `pricing.price_tax.snapshotted.v1`.

All events use the Foundation `DomainEventEnvelope` version `1.0`, string-form exact versions and tenant/business-date/correlation metadata.

## Verification

`npm run verify` passed 45/45 tests at this checkpoint, including:

- exclusive and inclusive combined calculations;
- deterministic calculation hashes;
- exact snapshot serialization;
- feed cursor and permission behavior;
- event envelope validation;
- publishing permission matrix and BigInt serialization;
- migration checksums, append-only constraints and overlap guards.
