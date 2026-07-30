# H3-DISCOVERY-03 — Public Discovery Implementation Checkpoint

**Status:** implementation checkpoint complete; filter application remains active  
**Workpack:** MOD-H — Storefront Commerce and Custom Domains  
**Branch:** `module/storefront-commerce-v1`  
**Integration target:** `program/integration-v1`  
**Checkpoint date:** 2026-07-30  
**Verified source head:** `5e5242ebe1fc2702363f8bfdd2eba2cf3d79d317`

## Scope completed at this checkpoint

This checkpoint implements published public discovery surfaces without creating a second catalog, price, tax or inventory authority.

### Category discovery

- versioned `storefront-public-category.v1` contract;
- active MOD-A category identity, hierarchy, name, description and product membership;
- MOD-H category publication, public slug, online hierarchy and order;
- host-scoped `GET|HEAD /v1/storefront/categories/{slug}` API;
- typed client and Worker resolver;
- buyer category page with breadcrumbs, child-category navigation, exact-price cards and bounded pagination;
- inactive authoritative categories, unpublished products, unpriced products, unknown hosts and scope mismatches fail closed.

### Collection discovery

- versioned `storefront-public-collection.v1` contract;
- published MOD-H collection and ordered member projection;
- member intersection with the verified H3 public product composition;
- stale, hidden or unpriced members omitted without identifier leakage;
- host-scoped `GET|HEAD /v1/storefront/collections/{slug}` API;
- typed client and Worker resolver;
- buyer collection page with exact-price cards, empty state and bounded pagination.

### Public search and facets

- versioned `storefront-public-search.v1` contract;
- bounded query length and result count;
- `STF-0012` literal substring and PostgreSQL full-text composition over the already-published product set;
- wildcard-safe `%` and `_` handling through literal `strpos` matching rather than unescaped `LIKE` patterns;
- deterministic product-ID pagination;
- category and availability facet counts;
- category facets capped at 20 values in SQL;
- host-scoped `GET|HEAD /v1/storefront/search` API;
- typed client, Worker route and accessible search/no-result page;
- final tax, promotion, stock, reservation and ranking authority remains outside the browser.

### Shared runtime and presentation

- discovery routes reuse the existing storefront shell, CSP, canonical host handling, cache isolation and exact-money renderer;
- dedicated public category/collection not-found responses;
- bootstrap-to-discovery tenant/storefront/channel/hostname/locale/currency/price-revision/publication-generation reconciliation;
- `HEAD` support and `405` method boundaries;
- English desktop category, English mobile collection and Arabic RTL search/no-result evidence;
- 200% text, navigation wrapping, keyboard skip link, semantic landmarks and root-overflow checks.

## Database changes

- `STF-0011-public-category-collection-resolution.sql`;
- `STF-0012-public-search-resolution.sql`;
- exact SHA-256 checksums registered in `database/modules/storefront/manifest.json`;
- storefront migration chain now contains 12 deterministic migrations;
- security-definer functions revoke `PUBLIC` execution and grant only reviewed read execution to `store_app_runtime`;
- no catalog, pricing or inventory write is introduced by the discovery migrations.

## Exact verification evidence

Storefront CI run `30522544622` verified source head `5e5242ebe1fc2702363f8bfdd2eba2cf3d79d317`:

- verify job `90805981407`: success;
- PostgreSQL 17 rehearsal job `90806145844`: success;
- buyer/admin/content/catalog/discovery browser job `90806145831`: success;
- Cloudflare preview/runtime/cleanup job `90806145901`: success;
- non-destructive Neon recovery job `90806146126`: success;
- repository tests: 441/441;
- base buyer scenarios: 3/3;
- admin scenarios: 4/4;
- public-content scenarios: 3/3;
- public-catalog scenarios: 3/3;
- public-discovery scenarios: 3/3;
- public-discovery Axe violations: 0;
- storefront migrations: 12;
- PostgreSQL rehearsal includes active/inactive category, hierarchy, collection member filtering, unknown host, literal wildcard search and runtime ACL evidence;
- Cloudflare preview deployment, runtime metrics and Worker cleanup passed;
- Neon recovery remained non-destructive and passed.

The same source head also passed:

- Foundation CI `30522544760`;
- Foundation Design CI `30522544945`;
- Storefront Lockfile `30522544572`;
- Foundation generic disposable Neon preview was skipped as intended for the MOD-H branch while the non-production project remains at its 10/10 branch quota.

The legacy Storefront H1 validation workflow is not an authority for H3 source readiness; its temporary validation harness result is separate from the current Storefront, Foundation, Design and Lockfile gates.

## Security and correctness corrections included

1. Public search no longer treats `%` and `_` as SQL wildcard controls.
2. Category facets are SQL-bounded to 20 values.
3. `compareAtPrice: null` is accepted without a false currency mismatch.
4. Discovery migrations are checksum-registered and unit-tested.
5. Arabic RTL at 200% text no longer overflows the header/navigation.
6. Search input retains an explicit accessible name without visually-hidden-label clipping noise.
7. Unknown or mismatched public contexts fail closed without tenant/storefront/channel identifier leakage.

## Remaining before H3-DISCOVERY-03 can close

The current API exposes category and availability facet counts, but does not yet apply selected category or availability filters to the authoritative search query. Therefore this checkpoint does **not** mark the whole discovery slice complete.

Required continuation:

1. add optional bounded `category` and `availability` filters to the search contract, SQL function, repository, API and typed client;
2. verify filters are applied inside the published authoritative product set, not in browser code;
3. retain deterministic cursor behavior and facet counts;
4. add unit, PostgreSQL and buyer evidence for applied/cleared filters;
5. reconcile this checkpoint, `status.yaml` and PR #48 with the final exact source head.

After filter application passes, H3 may continue with media/cache generation and SEO discovery.
