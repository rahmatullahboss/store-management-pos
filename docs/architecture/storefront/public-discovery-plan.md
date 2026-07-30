# H3-DISCOVERY-03 — Public Category, Collection and Search Plan

**Status:** approved for implementation  
**Workpack:** MOD-H — Storefront Commerce and Custom Domains  
**Branch:** `module/storefront-commerce-v1`  
**Integration target:** `program/integration-v1`  
**Plan date:** 2026-07-30  
**Prerequisite:** H3-CATALOG-02 complete

## Goal

Add published category pages, published collection pages and bounded public search/facets on top of the verified H3 public-product composition without moving catalog, pricing, tax, inventory or reservation authority into MOD-H.

This slice is discovery and presentation only. It must reuse the exact public product documents produced by `storefront.compose_public_product_documents(...)` and must not independently recalculate price, tax or available stock.

## Authority and source model

### Categories

- `catalog.categories` remains the authoritative category identity, hierarchy, name, description, status and version source.
- `catalog.product_categories` remains the authoritative product-to-category assignment source.
- `storefront.category_publications` remains the online publication, public slug, parent override/order and sales-channel visibility source.
- A category is public only when both the authoritative MOD-A category and its MOD-H publication are active/published for the resolved tenant/storefront/channel.
- A product appears on a category page only when:
  1. the product is assigned to the authoritative category;
  2. the category is published online;
  3. the product and selected variant are present in the verified public product composition.

### Collections

- `storefront.collections` owns collection presentation, lifecycle, title, description and public slug.
- `storefront.collection_members` owns explicit online merchandising membership and order.
- A collection member is public only when the collection is published and the referenced product/variant survives the verified public product composition.
- Collection membership does not change the authoritative catalog product, price, inventory or tax state.

### Search and facets

- Search uses bounded text inputs and intersects authoritative MOD-A search/category/brand/tag sources with the already-published MOD-H public product set.
- Search results return the same `storefront-public-product` summary shape used by listing/detail pages.
- Search must not expose inactive, archived, hidden, scheduled, unpriced or out-of-scope products/variants.
- Initial facets are bounded, deterministic and non-authoritative: category, availability and price-presence/count metadata. Additional brand/tag/attribute facets require explicit contract and performance evidence before exposure.

## Planned database changes

### `STF-0011-public-discovery-resolution.sql`

Add security-definer, context-free public read functions with `PUBLIC` execution revoked:

1. `storefront.compose_public_category_documents(...)`
   - joins published `storefront.category_publications` to active `catalog.categories`;
   - validates tenant/storefront/channel scope;
   - preserves deterministic hierarchy and sort order;
   - counts only products present in `compose_public_product_documents(...)`;
   - emits bounded category documents with ID, slug, name, description, parent reference, order, version and product count.

2. `storefront.compose_public_collection_documents(...)`
   - reads published collections and ordered collection members;
   - intersects members with `compose_public_product_documents(...)`;
   - emits bounded collection documents and ordered public product documents;
   - excludes stale/unpublished/unpriced members without leaking their identifiers.

3. `storefront.search_public_product_documents(...)`
   - accepts normalized query, optional category slug, optional availability and deterministic cursor/limit;
   - caps query length and result count;
   - searches only the resolved public product set;
   - uses stable ranking keys with a deterministic product-ID tiebreaker;
   - returns bounded result documents, next cursor, has-more and facet counts.

No new core country, catalog, pricing or inventory column is permitted.

### `STF-0012-public-discovery-endpoints.sql`

Add host-scoped resolver functions for:

- category index;
- category detail with bounded products;
- collection index;
- collection detail with bounded products;
- public search with bounded filters and cursor state.

Grant only the narrow resolver functions to `store_app_runtime`. Keep runtime direct writes prohibited and retain forced RLS on all MOD-H tables.

## Planned contracts

Add versioned, fail-closed contracts in `packages/storefront-contracts`:

- `storefront-public-category-index.v1`;
- `storefront-public-category.v1`;
- `storefront-public-collection-index.v1`;
- `storefront-public-collection.v1`;
- `storefront-public-search.v1`.

Contract limits:

- maximum 100 category summaries per index response;
- maximum 48 products per category, collection or search page;
- maximum 100 collection summaries per index response;
- maximum search query length 120 Unicode code points;
- maximum 20 facet values per facet group;
- UUID and slug validation identical to existing public catalog rules;
- exact money/quantity values are reused unchanged from H3-CATALOG-02;
- cursor/has-more consistency is mandatory;
- context currency, tenant, storefront, channel, price revision and publication generation must reconcile with bootstrap/catalog context.

## Planned public API

Read-only `GET|HEAD` routes:

- `/v1/storefront/categories?hostname=...`;
- `/v1/storefront/categories/{slug}?hostname=...&limit=...&cursor=...`;
- `/v1/storefront/collections?hostname=...`;
- `/v1/storefront/collections/{slug}?hostname=...&limit=...&cursor=...`;
- `/v1/storefront/search?hostname=...&q=...&category=...&availability=...&limit=...&cursor=...`.

Rules:

- unsupported methods return `405` with `Allow: GET, HEAD`;
- unknown host, unpublished category/collection and malformed inputs fail closed;
- empty search query returns a bounded validation response, not an unbounded full-catalog scan;
- cache controls are short and keyed by hostname, locale, currency, price-list revision, publication generation, route, filters and cursor;
- security headers match the existing public storefront handler.

## Planned buyer routes

- `/categories` and `/categories/{slug}`;
- `/collections` and `/collections/{slug}`;
- `/search` with an accessible labelled search form, visible result count, applied-filter summary and clear-filter action.

Rendering requirements:

- reuse the existing product-card and exact-money renderer;
- retain tax-at-checkout and reservation-aware availability notices;
- semantic breadcrumbs and headings;
- keyboard-operable filter controls;
- no colour-only state;
- responsive mobile/tablet/desktop layout;
- Arabic RTL and mixed-script safety;
- 200% text and root-overflow safety;
- empty, unavailable, malformed and no-result states;
- no browser-side authoritative ranking, price, tax or availability calculation.

## Test and evidence plan

### Unit and architecture

Cover:

- contract bounds and malformed input rejection;
- category hierarchy and public slug consistency;
- hidden/inactive category denial;
- collection member filtering and deterministic ordering;
- search normalization, bounds, filters, cursor consistency and deterministic ranking;
- cross-context mismatch denial;
- API GET/HEAD/405/404/validation behavior;
- buyer route and accessibility landmarks;
- module-boundary enforcement and absence of browser authority.

### PostgreSQL 17 rehearsal

Extend the storefront rehearsal with synthetic tenants/stores/channels and prove:

- active MOD-A category + published MOD-H category is visible;
- inactive/archived authoritative category is hidden even if MOD-H publication remains published;
- product-category membership is tenant isolated;
- unpublished/unpriced product cannot leak through category, collection or search;
- collection member order is deterministic and stale members are omitted;
- search is bounded, filterable and stable across replay;
- duplicate slugs and cross-tenant identifiers fail closed;
- all migrations replay deterministically;
- runtime has no direct write and no unintended `PUBLIC` execute privileges;
- audit/outbox/cache-generation evidence remains consistent.

### Browser/accessibility

Minimum deterministic scenarios:

1. English desktop category page with hierarchy and product results;
2. English mobile collection page with ordered products and empty-member handling;
3. Arabic RTL search page with filters, no-result state and 200% text.

Require zero Axe violations, keyboard navigation, semantic landmarks, no root overflow and bounded low-bandwidth assets.

### Operational gates

One exact source head must pass:

- repository verify and Storefront CI;
- PostgreSQL 17 complete replay/rehearsal;
- buyer/admin/content/catalog/discovery browser evidence;
- Cloudflare preview/runtime/cleanup;
- non-destructive Neon recovery;
- Foundation CI with MOD-H generic Neon preview skipped while quota remains 10/10;
- tracker, checkpoint and PR evidence reconciliation.

## Implementation order

1. Contracts and unit tests.
2. `STF-0011` composition functions and PostgreSQL rehearsal.
3. `STF-0012` host-scoped resolvers and repository/client/API handlers.
4. Buyer category and collection routes.
5. Bounded search/facet route and UI.
6. Browser/accessibility evidence.
7. Full CI, exact evidence, documentation and checkpoint closure.

## Explicit exclusions

This slice does not implement:

- cart or checkout;
- final tax/promotion quote;
- inventory reservation creation;
- customer authentication;
- payment or order creation;
- custom-domain provider execution;
- R2 media ingestion/transformation;
- sitemap/robots/structured-data finalization;
- personalised recommendations or behavioural ranking.

Those remain separate gated work after H3-DISCOVERY-03.
