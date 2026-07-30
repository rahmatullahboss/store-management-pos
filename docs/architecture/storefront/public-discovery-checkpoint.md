# H3-DISCOVERY-03 — Public Discovery Checkpoint

**Status:** complete  
**Workpack:** MOD-H — Storefront Commerce and Custom Domains  
**Branch:** `module/storefront-commerce-v1`  
**Integration target:** `program/integration-v1`  
**Checkpoint date:** 2026-07-30  
**Verified source head:** `bad50da86831d1392e77d0263f978220356a36d6`

## Purpose

Expose published category, collection and bounded search discovery surfaces without creating a second catalog, price, tax, stock or reservation authority.

- MOD-H owns online taxonomy publication, public slugs, curated collections and buyer presentation.
- MOD-A remains authoritative for category/product identity, localisation, variants and exact price-list data.
- MOD-B remains authoritative for sellable availability and active reservations.
- Search filters are applied in the authoritative published PostgreSQL composition, never as browser-side business authority.

## Completed scope

### Category discovery

- versioned `storefront-public-category.v1` contract;
- active MOD-A category identity, hierarchy, name, description and product membership;
- MOD-H category publication, public slug, online hierarchy and order;
- host-scoped `GET|HEAD /v1/storefront/categories/{slug}` API;
- typed client and Worker resolver;
- buyer category page with breadcrumbs, child-category navigation, exact-price cards and bounded pagination;
- inactive categories, unpublished/unpriced products, unknown hosts and scope mismatches fail closed.

### Collection discovery

- versioned `storefront-public-collection.v1` contract;
- published MOD-H collection and deterministic member ordering;
- member intersection with the verified H3 public product composition;
- stale, hidden or unpriced members omitted without identifier leakage;
- host-scoped `GET|HEAD /v1/storefront/collections/{slug}` API;
- typed client and Worker resolver;
- buyer collection page with exact-price cards, empty state and bounded pagination.

### Public search and applied facets

- versioned `storefront-public-search.v1` contract;
- bounded query, category, availability, cursor and result limits;
- `STF-0012` published-only literal/full-text search composition;
- `STF-0013` category and availability filters applied inside the authoritative published product set;
- wildcard-safe `%` and `_` handling through literal matching rather than unescaped `LIKE` control;
- deterministic product-ID pagination;
- category and availability facets with SQL-bounded category values;
- host-scoped `GET|HEAD /v1/storefront/search` API;
- typed client, Worker route, retained filter state, clear-filter action and accessible no-result page;
- final promotion, tax, stock, reservation and ranking authority remains outside browser code.

### Shared runtime and presentation

- discovery routes reuse the storefront shell, CSP, canonical-host handling, cache isolation and exact-money renderer;
- dedicated category and collection public not-found responses;
- bootstrap-to-discovery tenant/storefront/channel/hostname/locale/currency/price-revision/publication-generation reconciliation;
- `HEAD` support and `405` method boundaries;
- English desktop category, English mobile collection and Arabic RTL search/no-result evidence;
- 200% text, navigation wrapping, keyboard skip link, semantic landmarks and root-overflow checks.

## Scalius reuse — SF-UP-004

Pinned upstream source remains `scaliuslabs/scalius-commerce-lite` commit `4cb83aecb6d27483951618dcf8398592e662f241`.

Reviewed and selectively adapted:

- `apps/storefront/src/pages/categories/[slug].astro`;
- `apps/storefront/src/pages/collections/[id].astro`;
- `apps/storefront/src/pages/search/index.astro`.

Reused concepts:

- category breadcrumb, description, result count, child navigation and empty state;
- collection heading, curated-member order and empty state;
- retained query/filter state, clear-filter action, facets, pagination and no-result composition;
- page-level SEO/noindex composition patterns.

Rejected or replaced:

- D1, upstream API/core services and upstream business authority;
- floating-point price/discount fields;
- upstream availability assumptions;
- React islands, Tailwind classes, icons, analytics, image-CDN authority, demo data and product branding.

Full file-level provenance is recorded in `docs/architecture/storefront/upstream-file-manifest.yaml`.

## Database and CI truth corrections

- storefront migration chain contains 13 deterministic migrations;
- security-definer functions revoke `PUBLIC` and grant only reviewed read execution to `store_app_runtime`;
- publishing and discovery fixtures use disjoint category slugs;
- the Storefront PostgreSQL workflow now uses `set -o pipefail`, so a failing rehearsal cannot be hidden by `tee`;
- no catalog, pricing or inventory write was introduced.

## Exact verification evidence

Storefront CI run `30534413388` verified source head `bad50da86831d1392e77d0263f978220356a36d6`:

- verify job `90844121062`: success;
- PostgreSQL 17 rehearsal job `90844265607`: success;
- buyer/admin/content/catalog/discovery browser job `90844265594`: success;
- Cloudflare preview/runtime/cleanup job `90844265639`: success;
- non-destructive Neon recovery job `90844265994`: success;
- repository tests: 450/450;
- base buyer scenarios: 3/3;
- admin scenarios: 4/4;
- public-content scenarios: 3/3;
- public-catalog scenarios: 3/3;
- public-discovery scenarios: 3/3 with zero Axe violations;
- applied search-filter evidence: passed with zero Axe violations;
- PostgreSQL raw log: zero `ERROR:` lines;
- storefront migrations: 13;
- storefront tables and forced RLS: 16/16;
- audit/outbox events: 42/42;
- command receipts: 23;
- cache generation rows: 1;
- Cloudflare runtime requests/errors: 1/0;
- preview Worker cleanup confirmed.

## Cloudflare quota recovery

The Cloudflare account had reached its 100-Worker limit. The recovery path:

- activates only for Cloudflare error `10037`;
- accepts only strict repository-owned names matching `store-pos-fnd-{run-id}`;
- excludes the current run;
- requires a minimum six-hour stale age;
- deletes oldest candidates first with a hard maximum of 20;
- retries deployment once;
- records retention evidence and never touches unrelated Workers.

The exact run pruned 20 eligible repository-owned stale preview Workers, deployed successfully, recorded runtime metrics and removed its current preview Worker.

## External blocker

The dedicated Neon branch `dev/module-storefront-commerce` remains blocked because the non-production project is at its 10/10 branch quota. No permanent Neon branch was deleted, reset or repurposed. PostgreSQL 17 full replay and non-destructive Neon recovery remain mandatory substitutes.

## Next H3 slice

`H3-SEO-MEDIA-04` will add:

1. published-only robots and sitemap discovery;
2. canonical URL and product structured-data projection;
3. safe product-media delivery contracts;
4. exact cache-generation families and invalidation evidence;
5. low-bandwidth and broader-locale verification.
