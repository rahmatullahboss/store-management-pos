# Storefront Commerce Delivery Roadmap

This roadmap is the MOD-H extension to `docs/12-DELIVERY-ROADMAP.md`.

## Outcome

An entitled merchant can publish selected operational products to one or more branded storefronts, use a platform subdomain or verified custom domain, receive online orders through the existing authoritative commerce modules, and operate the channel without creating a second price, stock, payment or accounting truth.

## Delivery phases

### H0 — Activation, audit and provenance

Deliver:

- exact branch/worktree/Neon coordinates;
- programme board and tracker;
- reviewed source commit and file manifest;
- selective adaptation policy;
- module ownership and dependency map;
- internal notices and update ownership.

Exit: a new agent can resume without prior chat context and no source file can be imported without a recorded path/decision.

### H1 — Cloudflare storefront foundation

Deliver:

- Astro/Cloudflare storefront app shell;
- runtime config and safe hostname context;
- Ozzyl storefront contracts/client/theme packages;
- original product identity and baseline buyer theme;
- health, unavailable, not-found and security middleware;
- build/type/lint/test/architecture CI.

Exit: a synthetic storefront renders from local contracts, fails closed for unresolved hosts and passes baseline accessibility/security checks.

### H2 — Storefront domain and publication

Deliver:

- Neon storefront schema/migrations and forced RLS;
- storefront, sales-channel and hostname records;
- product/variant/category publication states;
- merchant publication and content permissions;
- audit/outbox events and idempotent commands;
- admin management routes/screens.

Exit: two tenants independently publish different subsets of the same-sized catalogs and cannot cross-read/write state.

### H3 — Public catalog, theme, CMS and discovery

Deliver:

- host bootstrap, layout and homepage bundles;
- public product/category/collection/search surfaces;
- theme/header/footer/navigation/hero/CMS;
- R2/image delivery;
- tenant-aware Cache API/KV generation invalidation;
- canonical URLs, robots, sitemaps and product feeds.

Exit: publish/update/unpublish operations produce correct public visibility and bounded cache invalidation across platform/custom domains.

### H4 — Exact cart and checkout

Deliver:

- non-authoritative local cart identity/quantity state;
- exact server quote with currency/minor/scale;
- price/tax/promotion/stock revalidation;
- shipping/payment capability presentation;
- idempotent order submission into MOD-C/MOD-E;
- timeout/unknown-state recovery without duplicate effects.

Exit: browser retries cannot duplicate reservations, orders, payments or ledger effects and displayed totals match the authoritative quote.

### H5 — Customer and order experience

Deliver:

- guest/customer policy;
- customer authentication/session integration;
- account and order history;
- order receipt/tracking/payment recovery;
- support/return entry points according to MOD-C policy;
- consent/privacy/localisation behavior.

Exit: customer-specific data is never publicly cached and ownership checks protect every account/order read.

### H6 — Custom domains and SaaS operations

Deliver:

- platform subdomain reservation;
- custom hostname onboarding/verification;
- certificate state reconciliation;
- canonical hostname and redirect rules;
- entitlement, suspension, deletion and offboarding;
- domain-conflict/takeover prevention;
- support diagnostics and runbooks.

Exit: verified domains activate safely, invalid/stale/conflicted domains fail closed and tenant offboarding removes public routing predictably.

### H7 — Pilot hardening and integration handoff

Deliver:

- production-scale catalog and cache tests;
- security/rate-limit/abuse tests;
- browser mobile/desktop/RTL/CJK/Bengali evidence;
- accessibility and low-bandwidth checks;
- fresh Neon rebuild/upgrade/recovery;
- Cloudflare preview/deploy/cleanup evidence;
- observability/SLO/runbooks;
- final provenance inventory and serial integration handoff.

Exit: all workpack completion gates pass and PR is eligible for controlled integration.

## Scope sequencing

The first sellable storefront cut includes:

- one storefront per tenant;
- platform subdomain plus one custom domain;
- explicit product/variant publication;
- homepage, product, category, search, cart and checkout;
- COD/manual payment plus existing ready online gateways exposed through MOD-E;
- basic shipping capability from MOD-C;
- theme/header/footer/navigation/hero/CMS basics;
- canonical SEO, robots and sitemap;
- customer order confirmation/tracking;
- tenant-safe edge caching.

Later releases may add:

- multiple storefronts/brands per tenant;
- advanced page builder and theme marketplace;
- B2B/private catalogs;
- multi-region storefront routing;
- advanced merchandising/experimentation;
- marketplace/social sales-channel connectors;
- additional product feeds and checkout protocols.

## Release gates

Every MOD-H release candidate must pass:

- exact-money and authoritative-quote tests;
- publication visibility tests;
- tenant/RLS/hostname/cache isolation tests;
- domain ownership/takeover tests;
- idempotent checkout/retry tests;
- module boundary and licence/provenance checks;
- Cloudflare Worker compatibility and cache invalidation tests;
- accessibility, RTL, responsive and localisation checks;
- security, dependency, secret and SBOM checks;
- migration, recovery, observability and runbook review.
