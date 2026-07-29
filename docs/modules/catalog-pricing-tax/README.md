# Catalog, Pricing and Tax Module

**Module:** MOD-A  
**Schemas:** `catalog`, `pricing`, `tax`  
**Branch:** `module/catalog-pricing-tax-v1`

## Purpose

MOD-A owns the commercial definition of what can be sold, how its effective price is selected, which promotions and controlled discounts apply, and how tax is calculated and snapshotted. It provides immutable version references and bounded feeds for POS, sales, inventory, procurement, finance and reporting consumers.

## Capabilities

### Catalog

- products, variants, attribute axes and localized content;
- categories, brands, tags, media and supplier references;
- globally unique tenant SKU and barcode rules;
- exact units and append-only effective conversion versions;
- stock, service and bundle definitions;
- dry-run import planning, issue export and deterministic catalog export;
- staged exact/full-text/fuzzy search;
- full and incremental POS catalog feeds;
- lifecycle status with soft removal instead of destructive deletion.

### Pricing and promotions

- immutable, effective-dated price-list versions;
- legal-entity, store, channel and customer-group scopes;
- quantity tiers, compare-at prices and margin floors;
- scheduled versions resolved from the requested instant;
- percentage, fixed and buy-X-get-Y promotions;
- coupons, redemption limits, exclusivity and stacking groups;
- controlled manual discounts with reason and approval requirements;
- exact allocation and configurable cash rounding.

### Tax

- hierarchical jurisdictions;
- immutable tax-code and rate versions;
- inclusive, exclusive and compound calculations;
- standard, zero-rated, exempt, reverse-charge and out-of-scope treatments;
- exemption certificates and recoverable/reporting tax;
- exact return allocation;
- immutable calculation components and combined price-tax snapshots.

## Authoritative combined contract

`calculatePriceAndTax` resolves price, promotions and tax in a fixed order and creates a deterministic `PriceTaxSnapshot`. Checkout and admin consumers use that snapshot without independently recalculating its basis.

The snapshot preserves every relevant version and exact amount:

- price list and rule;
- promotions and allocated discounts;
- tax code, jurisdiction and rate components;
- net, tax and gross;
- calculation hash and timestamp.

Historical snapshots remain unchanged when later catalog, price, promotion or tax versions are published.

## Database migration order

Apply after Foundation `FND-0001` through `FND-0005`:

1. `CAT-0001` — catalog core;
2. `CAT-0002` — staged search resolver;
3. `CAT-0003` — POS snapshot/incremental feed;
4. `PRC-0001` — pricing, promotions and discount controls;
5. `TAX-0001` — tax configuration and snapshots;
6. `PRC-0002` — combined price-tax snapshots;
7. `PRC-0003` — price-list and promotion publishing;
8. `TAX-0002` — tax configuration publishing.

Each migration is pinned in its schema manifest by SHA-256.

## Integration boundaries

- Shared Foundation files are not changed for module route registration.
- `CCR-0001` requests an additive admin route-provider composer.
- Consumers should depend on module contracts, event envelopes and immutable snapshot IDs rather than internal tables.
- Corrections are successor versions or lifecycle transitions; published versions and snapshots are never silently mutated.

## Verification entry points

```text
npm run verify
npm run mod-a:design:verify
npm run mod-a:benchmark:local
npm run mod-a:benchmark:neon
```

The Neon benchmark command requires an explicit connection to isolated branch `br-fancy-bird-axo3z9ek` and refuses an unconfirmed branch ID.
