# MOD-A Catalog Checkpoint

**Date:** 2026-07-28  
**Branch:** `module/catalog-pricing-tax-v1`  
**Neon branch:** `dev/module-catalog-pricing-tax` (`br-fancy-bird-axo3z9ek`)

## Delivered catalog capability

- Product aggregates with draft, active, inactive and archived lifecycle states.
- Products, variants, variant axes, attributes and values, localized names/descriptions, categories, brands and tags.
- Tenant-global normalized SKU and barcode uniqueness, primary barcode constraints and EAN/UPC validation.
- Units and immutable versioned rational conversions with exact representability checks.
- Media, supplier references, bundle component persistence and soft-removal of downstream-referenced variants.
- Dry-run import planning, row-level warnings/errors, source hashing, execution and deterministic JSONL export.
- Exact barcode/SKU/code/token search with dedicated prefix indexes in TypeScript and GIN/trigram search documents in PostgreSQL.
- Optimistic version checks, idempotent product writes, status transitions, permissions, audit records and outbox events.
- API/repository layer using request-scoped Foundation Neon transactions and structured metrics/logging.

## Migration evidence

- `database/migrations/catalog/CAT-0001-core.sql`
- SHA-256: `d9ab2ffcc9c4cc16d873608a297b508f24bed31e796470bbd684bcd7570232d0`
- 20 tenant-scoped catalog tables use forced RLS.
- `catalog.unit_conversion_versions` is append-only.
- Runtime direct deletes are revoked for products, variants and import records.
- Write and status functions use hardened search paths and explicit PL/pgSQL column resolution.

## Live Neon verification

Synthetic tenant Alpha created one active product and one variant through `catalog.save_product`:

- initial result: version `1`, status `active`, `replayed=false`;
- same idempotency key and request hash: version `1`, `replayed=true`;
- localized/barcode search returned one result;
- one catalog audit event and one outbox event were committed in the same write transaction.

Production-equivalent `store_app_runtime` role isolation:

| Context | Visible products | Exact barcode hits |
|---|---:|---:|
| Synthetic Alpha | 1 | 1 |
| Synthetic Beta | 0 | 0 |

The owner role can bypass RLS and is therefore excluded from the isolation verdict. Runtime-role evidence is authoritative.

## Unit evidence

`npm run test:unit` passed 18/18 tests, including four MOD-A catalog tests:

- aggregate normalization and duplicate variant rejection;
- exact versioned unit conversion;
- barcode/SKU/localized-prefix search ranking;
- dry-run import, execution and deterministic export.

## Remaining MOD-A work

Pricing, promotions, controlled discounts, tax engine/snapshots, admin UI, 250,000-variant PostgreSQL benchmark, full observability/runbooks and final handoff remain active.
