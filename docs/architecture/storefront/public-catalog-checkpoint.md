# H3-CATALOG-02 — Public Catalog Checkpoint

**Status:** implementation complete, exact-head evidence pending  
**Workpack:** MOD-H — Storefront Commerce and Custom Domains  
**Branch:** `module/storefront-commerce-v1`  
**Integration target:** `program/integration-v1`  
**Checkpoint date:** 2026-07-30

## Purpose

Expose bounded, published-only product listing and product-detail projections for a resolved storefront hostname while preserving the existing module authority model:

- MOD-H owns online publication, public slugs, storefront routing and buyer presentation;
- MOD-A remains authoritative for products, variants, units, active price-list versions and exact price rules;
- MOD-B remains authoritative for sellable stock balances and active reservations;
- tax remains explicitly deferred to an authoritative checkout quote and is not calculated in the browser or public catalog projection.

The public catalog is a read composition. It does not create a second product, price, stock, tax or reservation authority.

## Implemented scope

### Database composition

- `STF-0009-public-catalog-resolution.sql`
  - composes published MOD-H products and variants with active MOD-A catalog records;
  - resolves the active web price-list version and exact integer-minor prices;
  - limits inventory reads to the sales channel's configured active warehouse scope;
  - subtracts active MOD-B reservation quantities from sellable stock balances;
  - emits exact quantity strings, unit codes, inventory timestamps and versions;
  - distinguishes `available`, `preorder`, `unavailable` and `unknown` without duplicating inventory authority;
  - keeps service/non-stock products independent from physical quantity;
  - revokes `PUBLIC` execution from the security-definer composition functions.

- `STF-0010-public-catalog-endpoints.sql`
  - provides host-scoped public catalog and public product resolvers;
  - bounds list size to 1–48 items;
  - uses deterministic product-ID cursor pagination;
  - exposes only active-host, published-selection output;
  - grants the narrow resolver functions to `store_app_runtime` while retaining direct-table write denial.

### Versioned contracts and client

- `storefront-public-catalog.v1` for bounded product pages;
- `storefront-public-product.v1` for product detail;
- exact money as currency, integer-minor string and scale;
- exact available quantity as decimal string, unit, scale, `asOf` and source version;
- maximum 48 products per page and maximum 100 public variants per product;
- fail-closed validation for malformed UUIDs, slugs, timestamps, quantities, versions, currencies, cursor state and product/variant consistency;
- explicit `tax_calculated_at_checkout` notice so public pages do not imply a final statutory quote.

### Public API

- `GET|HEAD /v1/storefront/catalog?hostname=...&limit=...&cursor=...`;
- `GET|HEAD /v1/storefront/products/{slug}?hostname=...`;
- all other methods return `405` with `Allow: GET, HEAD`;
- unknown storefronts fail closed;
- unpublished or unknown products return a bounded public `404`;
- responses use defensive security headers and short shared-cache windows.

### Buyer rendering

- hostname-scoped catalog resolver and typed transport;
- public product listing route;
- public product detail route;
- exact-money rendering without browser arithmetic;
- availability and tax-at-checkout messaging;
- canonical host/context reconciliation before rendering;
- safe empty, unavailable, malformed and not-found states;
- responsive and RTL-compatible catalog/product layouts;
- improved compare-at price contrast for accessibility.

## Verification inventory

The branch includes:

- unit coverage for contract parsing, exact money, pagination, invalid inputs, public API handling and buyer rendering;
- PostgreSQL 17 migration and public-catalog rehearsal covering publication visibility, tenant isolation, price-list revision selection, warehouse scope, reservations, exact quantities, fail-closed behavior and deterministic replay;
- deterministic buyer browser/accessibility evidence for public listing and detail;
- Cloudflare preview/runtime/cleanup evidence;
- non-destructive Neon recovery evidence while the dedicated MOD-H Neon branch remains blocked by the non-production project branch quota.

Exact run IDs, job IDs, test totals, database counts and browser scenario totals must be recorded in `status.yaml` only after the current source head completes all required gates.

## Security review note

GitGuardian reported the historical CI-only value `POSTGRES_PASSWORD: postgres` from commit `31afafccaea8b6e16d76f677051c2de8b220b456`. It was an ephemeral GitHub Actions PostgreSQL service credential, not a production, Neon or external-service secret. The current workflow no longer contains that value: the isolated PostgreSQL service uses `POSTGRES_HOST_AUTH_METHOD: trust` and a loopback-only connection URL without a password. Repository history is not rewritten because the programme prohibits destructive history changes; the current tree and secret gate remain the release authority.

## Acceptance gates

H3-CATALOG-02 may be marked complete only when one exact source head passes all of the following:

1. format, lint, module boundaries, strict typecheck, migration validation, build and repository tests;
2. secret, licence, SBOM and dependency-audit gates;
3. PostgreSQL 17 complete migration/replay and catalog rehearsal;
4. buyer listing/detail browser evidence with zero Axe violations, keyboard access, mobile, RTL, 200% text and overflow checks;
5. Cloudflare preview deployment, runtime metrics and cleanup;
6. non-destructive Neon recovery;
7. tracker and PR body updated with exact evidence;
8. no production-compliance, final-tax or guaranteed-stock claim introduced by the public projection.

## Remaining H3 work after this checkpoint

- category and collection public projections/pages;
- bounded public search and facets;
- R2/media delivery and cache-generation invalidation;
- robots, sitemap, canonical discovery and product structured data;
- low-bandwidth and broader locale evidence;
- final H3 consolidation before H4 exact cart and checkout begins.
