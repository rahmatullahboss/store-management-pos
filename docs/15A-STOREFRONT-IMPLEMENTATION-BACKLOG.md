# MOD-H Storefront Implementation Backlog

This backlog extends `docs/15-IMPLEMENTATION-BACKLOG.md`. One MOD-H agent owns every item.

## S00 — Activation and source governance

- Verify branch/worktree/Neon coordinates.
- Maintain `status.yaml` at every checkpoint.
- Pin upstream repository/commit.
- Record exact adapted files and local paths.
- Preserve internal provenance/notice records.
- Block upstream branding, D1 and commerce authority.
- Add architecture tests for forbidden imports/names/config values.

Exit: H0 documentation, provenance and non-production infrastructure are complete.

## S01 — Storefront runtime foundation

- Create `apps/storefront-web`.
- Configure Astro SSR for Cloudflare Workers.
- Create safe runtime environment schema.
- Resolve request hostname into a typed storefront context.
- Add health, unavailable, not-found and maintenance responses.
- Add baseline security headers and CSP seam.
- Create original product branding placeholders without invented claims.
- Add lint/type/build/unit/boundary CI paths.

Exit: synthetic storefront bootstrap renders and unknown hosts fail closed.

## S02 — Storefront contracts and client

- Create versioned storefront bootstrap/layout/homepage contracts.
- Create public catalog/product/category/collection/search contracts.
- Create exact money, quote and checkout contracts.
- Create customer/order receipt contracts.
- Create domain/publication/theme/content command contracts.
- Implement Service Binding transport plus authenticated HTTPS fallback.
- Add timeout, retry and sensitive-header rules.
- Generate or hand-author typed clients according to repository conventions.

Exit: contracts are versioned, validated and have malformed/forward-compatible tests.

## S03 — Neon storefront domain

- Create `storefront` schema and migration order.
- Add storefront/sales-channel/domain/publication/content tables.
- Add tenant/RLS policies and security-definer command paths.
- Add idempotency, optimistic concurrency and audit/outbox effects.
- Add fresh migration, upgrade and recovery tests.
- Add repositories/services without cross-module persistence imports.

Exit: two tenants prove forced-RLS isolation and publication state rebuild/recovery.

## S04 — Merchant storefront administration

- Storefront create/update/suspend/archive.
- Platform subdomain reservation.
- Product/variant/category publication controls.
- Bulk publish/unpublish with bounded preview.
- Theme draft/preview/publish revision.
- Header/footer/navigation/homepage/CMS editing.
- SEO/discovery controls.
- Permissions, approvals and audit drill-through.
- Operations Ledger design integration and accessibility evidence.

Exit: merchant can safely publish only selected products and review public state.

## S05 — Public buyer shell

- Layout/header/footer/navigation.
- Homepage hero, collections, category rail and trust content.
- Product card/list/detail/gallery.
- Variant selection and availability states.
- Category/collection/search/filter pages.
- CMS pages and safe rich content rendering.
- Mobile, low-bandwidth, RTL and localisation behavior.

Exit: public catalog is responsive, accessible, tenant-safe and publication-correct.

## S06 — Edge cache and invalidation

- L1 bounded memory cache.
- Cloudflare Cache API L2.
- KV version/generation control.
- Tenant/storefront/host/locale/currency/price-list/build scoping.
- In-flight request deduplication.
- Private/session/cart/checkout bypass.
- Exact product and bounded group invalidation.
- Purge/warm retry evidence and stale-generation fail-closed behavior.

Exit: cross-tenant cache reads are impossible and catalog updates become visible within budget.

## S07 — Exact cart quote

- Local cart stores identity/options/quantity only.
- Persisted cart schema/version/migration.
- Server quote request with context and idempotency.
- Exact line/subtotal/discount/shipping/tax/total response.
- Quote expiry/revision/revalidation behavior.
- Unavailable/changed-price/changed-stock recovery.
- No browser floating-point authoritative totals.

Exit: display matches server quote and malformed/stale quotes cannot place an order.

## S08 — Checkout and order submission

- Guest/customer policy.
- Address/contact validation from effective country policy.
- Shipping capability/options from MOD-C.
- Payment capability/options from MOD-E.
- Idempotent submit command into MOD-C/MOD-E.
- Unknown external state and payment recovery.
- Order confirmation/receipt proof.
- Duplicate/retry/concurrency tests.

Exit: one checkout produces exactly one authoritative order/effect chain.

## S09 — Customer account and post-sale

- Customer session/auth integration.
- Account profile/address policy.
- Order history/detail/tracking.
- Payment recovery and balance due where permitted.
- Return/cancel/refund support entry points through MOD-C.
- Privacy/consent/export links.
- Private cache and ownership tests.

Exit: customer reads are ownership-scoped and never enter public caches.

## S10 — SEO, feeds and structured data

- Canonical URLs and domain policy.
- robots and sitemap index/children.
- Product/category/collection/page metadata.
- Product/ProductGroup/Breadcrumb/OnlineStore structured data from truthful facts.
- Google/Meta-compatible product feed projections where enabled.
- noindex/sitemap/feed exclusion.
- Cache invalidation for stock/publication/content changes.

Exit: discovery outputs contain only published, truthful and absolute storefront facts.

## S11 — Custom domain control plane

- Domain request/reservation records.
- DNS verification challenge.
- Cloudflare custom-hostname adapter.
- Certificate pending/active/failed state.
- Canonical host and redirects.
- Conflict/takeover prevention.
- Suspension/deletion/offboarding.
- Retry/reconciliation/support diagnostics.

Exit: custom domains activate only after verified ownership and safe certificate state.

## S12 — Observability, security and operations

- Structured storefront request/context logs without sensitive data.
- Cache hit/miss/bypass/generation metrics.
- Host resolution/domain lifecycle metrics.
- Quote/checkout/recovery metrics.
- Rate limits and abuse controls.
- CSP/security-header tests.
- Incident, cache purge, domain recovery and checkout recovery runbooks.
- SLOs and alert thresholds.

Exit: operational failures are detectable, diagnosable and recoverable.

## S13 — Final verification and handoff

- Full repository verify/design/provenance gates.
- Fresh Neon rebuild and recovery.
- Cloudflare preview/deploy/cleanup.
- Representative catalog load/performance.
- Browser desktop/mobile/RTL/BN/JA evidence.
- Axe zero critical/serious findings or documented approved exceptions.
- Final upstream file inventory.
- Module docs and exact serial integration steps.

Exit: MOD-H reaches `handoff_ready` with no undocumented blocker.
