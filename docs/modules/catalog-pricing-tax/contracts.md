# MOD-A Contracts

## Catalog search

`catalog.search_variant_feed(locale, query, limit, cursor)` preserves its original public signature while using staged execution:

1. unique barcode;
2. exact SKU;
3. exact product code;
4. full-text search;
5. natural-language substring and word-similarity fallback.

Identifier-shaped queries do not enter fuzzy search. The cursor is SKU-based for interactive search results.

## POS catalog feed

`catalog.catalog_snapshot_feed(locale, snapshot_at, after_updated_at, after_variant_id, limit)` returns a stable catalog projection bounded by one snapshot instant.

Consumer rules:

- retain the same `snapshotAt` while paging;
- use both cursor fields or neither;
- order by `(updatedAt, variantId)`;
- request at most 500 consumer rows; repositories use one look-ahead row;
- retain inactive entries as lifecycle tombstones;
- start a new full snapshot when an old snapshot is deliberately abandoned.

TypeScript helpers:

- `encodeCatalogFeedCursor`;
- `decodeCatalogFeedCursor`;
- `buildCatalogFeedPage`;
- `queryCatalogSnapshotFeed`;
- `CatalogApi.snapshotFeed`.

## CalculatePriceAndTax

Input includes:

- price context, lists and rules;
- promotion context and available promotions;
- tax code, jurisdiction, rates and exemptions;
- fixed source-line and snapshot IDs;
- one effective instant and rounding policy.

Evaluation order:

1. resolve effective price;
2. calculate subtotal from exact quantity;
3. apply promotions and exact line allocations;
4. calculate tax from the promoted amount;
5. hash and freeze the combined snapshot.

The operation fails if pricing and promotion subtotals diverge.

## PriceTaxSnapshot

Schema version: `1.0`.

Reconciliation invariants:

```text
subtotalMinor - discountMinor = promotedAmountMinor
netMinor + taxMinor = grossMinor
exclusive: promotedAmountMinor = netMinor
inclusive: promotedAmountMinor = grossMinor
```

The snapshot also retains immutable version references, promotion details, tax components and the calculation hash. `checkoutLineFromPriceTaxSnapshot` validates these invariants before exposing checkout values.

Persistence:

- `pricing.record_price_tax_snapshot`;
- append-only `pricing.price_tax_snapshots`;
- forced tenant RLS;
- idempotency scope `pricing.price_tax.snapshot`;
- event `pricing.price_tax.snapshotted.v1`.

## Publishing commands

### Price lists

`pricing.publish_price_list_version` creates a root when necessary, inserts one immutable version and its rules, and advances the root pointer.

It fails on:

- identity-field mutation;
- expected-version conflict;
- overlapping effective scope;
- empty rule set;
- invalid range or reason;
- idempotency hash mismatch.

### Promotions

`pricing.publish_promotion_version` inserts an immutable promotion version, validates its condition/action shape and rejects an overlapping published window.

### Tax

`tax.publish_configuration` creates or updates a jurisdiction root, inserts immutable code/rate versions and advances the tax-code pointer. Zero-rate components are valid; basis points outside `0..10000` fail.

## Change events

| Event | Aggregate | Purpose |
|---|---|---|
| `catalog.product.changed.v1` | `catalog.product` | Product lifecycle/version and affected variants |
| `pricing.price_list.published.v1` | `pricing.price_list` | Effective list version and scope |
| `pricing.promotion.changed.v1` | `pricing.promotion` | Effective promotion version and status |
| `tax.configuration.published.v1` | `tax.code` | Effective code/jurisdiction/rate versions |
| `pricing.price_tax.snapshotted.v1` | `pricing.price_tax_snapshot` | Authoritative line calculation |

All module envelope factories use Foundation `DomainEventEnvelope` schema `1.0` and string-form exact versions.

## Compatibility rules

- Do not read module tables across workpack boundaries when a contract exists.
- Do not recompute a historical sale from current pricing or tax configuration.
- Do not mutate published versions or snapshots.
- Additive contract changes remain `1.x`; incompatible changes require a recorded contract-change request and major version.
