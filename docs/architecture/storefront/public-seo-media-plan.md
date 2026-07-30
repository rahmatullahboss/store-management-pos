# H3-SEO-MEDIA-04 — Public SEO, Media and Cache Plan

**Status:** active  
**Workpack:** MOD-H — Storefront Commerce and Custom Domains  
**Branch:** `module/storefront-commerce-v1`  
**Integration target:** `program/integration-v1`  
**Plan date:** 2026-07-30

## Goal

Complete the public catalog/content discovery layer with published-only crawler discovery, canonical/structured metadata, bounded media delivery and exact generation-based cache invalidation while preserving existing module authority.

## Authority boundary

- MOD-A owns product/category identity, localisation, media records, exact pricing, promotion and tax inputs.
- MOD-B owns inventory, availability and reservations.
- MOD-H owns online publication, public slugs, hostname routing, public presentation, sitemap/robots policy and cache generations.
- Cloudflare Cache API/KV/R2 are delivery and cache infrastructure only; PostgreSQL/Neon remains canonical.
- The browser cannot create authoritative price, tax, stock, reservation, order, payment or ledger effects.

## Scalius reuse candidates

Pinned source: `scaliuslabs/scalius-commerce-lite` commit `4cb83aecb6d27483951618dcf8398592e662f241`.

Reviewed files:

- `apps/storefront/src/pages/robots.txt.ts`;
- `apps/storefront/src/pages/sitemap.xml.ts`;
- `apps/storefront/src/lib/sitemap-utils.ts`;
- `packages/shared/src/seo-canonical.ts`;
- `apps/storefront/src/lib/public-discovery-cache.ts`;
- `apps/storefront/src/lib/cache-generations.ts`.

Approved concepts for selective adaptation:

- XML escaping and bounded sitemap date/URL normalization;
- robots/sitemap directive normalization;
- canonical path sanitation and reserved-path denial;
- discovery-only cache policy and cookie stripping;
- cache-key family classification and exact generation lookup/bump patterns;
- fail-closed cache-generation timeout behavior.

Mandatory replacements:

- upstream hostname/store/domain resolution with local active-host bootstrap;
- upstream D1/KV authority with local PostgreSQL generation rows and reviewed Cloudflare delivery adapters;
- global keys with tenant/storefront/hostname/locale/currency/price-list/publication/build isolation;
- upstream product/page types with local versioned public contracts;
- upstream media and pricing assumptions with MOD-A/MOD-B projections;
- upstream branding, environment IDs, analytics and demo data.

## Planned checkpoints

### SEO-01 — Published discovery contract

- versioned robots and sitemap contracts;
- active canonical host only;
- published products, categories, collections and content pages only;
- bounded entries, deterministic ordering and XML escaping;
- unknown host and unpublished resources fail closed.

### SEO-02 — Canonical and structured data

- safe canonical path normalization;
- product JSON-LD generated from exact public product projection;
- no final-tax, guaranteed-stock or false promotion claims;
- script output escaped against HTML/script termination;
- category, collection and content page canonical metadata.

### MEDIA-01 — Product media delivery

- bounded public media contract from MOD-A `catalog.product_media`;
- safe HTTPS/R2 asset references, alt text and deterministic order;
- variant-aware media without exposing unpublished variants;
- responsive width/format hints and low-bandwidth fallback;
- no browser upload or media-authority mutation.

### CACHE-01 — Exact generation families

- local cache families for bootstrap/content/catalog/product/category/collection/search/sitemap/media;
- full isolation by tenant, storefront, hostname, locale, currency, price-list revision, publication generation and build;
- PostgreSQL generation remains source of truth;
- Cache API/KV misses, timeout or malformed generations fail closed or bypass cache;
- publication/content/domain/media changes produce auditable generation bumps.

## Acceptance evidence

1. format, lint, boundaries, strict TypeScript, migrations, build and tests;
2. PostgreSQL 17 published-only sitemap/media/generation rehearsal with RLS and ACL proof;
3. robots, sitemap and structured-data parser tests;
4. canonical URL, script escaping and cache-isolation security tests;
5. mobile, RTL, 200% text and low-bandwidth browser evidence;
6. Cloudflare preview/runtime/cleanup and owner-safe quota recovery;
7. non-destructive Neon recovery;
8. file-level `SF-UP-005` provenance recorded before or with adapted implementation;
9. tracker and PR body updated while PR #48 remains draft.
