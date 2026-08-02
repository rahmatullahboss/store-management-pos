# MOD-H — Storefront Commerce and Custom Domains

## 1. Mission

Deliver the complete multi-tenant buyer storefront capability for the International Store Management & POS Platform. A merchant must be able to publish selected products online, operate a branded buyer-facing storefront, accept online orders through the existing authoritative modules, and attach a platform subdomain or verified custom domain.

This is one complete workpack owned by one implementation agent. Do not split catalog publishing, storefront UI, cart, checkout, custom domains, CMS, SEO, tests or operations into separate agents.

## 2. Activation and continuation coordinates

- Status: `active`
- Git base: `program/integration-v1`
- Git branch: `module/storefront-commerce-v1`
- Fixed worktree: `.worktrees/storefront-commerce`
- Neon branch: `dev/module-storefront-commerce`
- Workpack owner: one complete MOD-H agent
- Integration target: `program/integration-v1`
- Integration order: after the currently integrated MOD-A through MOD-F baseline; coordinate shared SaaS/domain-control changes with MOD-G through frozen contracts or an approved CCR
- External adaptation source: `https://github.com/scaliuslabs/scalius-commerce-lite`
- Reviewed upstream branch: `mono-repo`
- Reviewed upstream commit: `4cb83aecb6d27483951618dcf8398592e662f241`

A new agent must first verify that the branch, worktree and Neon branch match these coordinates. Never reset, discard, overwrite or force-push existing work.

## 3. Required reading order for every new agent

1. `AGENTS.md`
2. `PRODUCT.md`
3. `DESIGN.md`
4. `docs/17-PARALLEL-AGENT-EXECUTION.md`
5. `docs/agent-workpacks/program-board.yaml`
6. this workpack
7. `docs/architecture/storefront/START-HERE.md`
8. `docs/architecture/storefront/SCALIUS-ADAPTATION-PLAN.md`
9. `docs/architecture/storefront/status.yaml`
10. `docs/10-OPEN-SOURCE-REUSE.md`
11. `docs/open-source/reuse-register.yaml`
12. relevant MOD-A, MOD-B, MOD-C, MOD-E, MOD-F and MOD-G contracts and handoffs

The machine-readable current state is `docs/architecture/storefront/status.yaml`. Update it at every coherent checkpoint before changing the board status.

## 4. Product boundary

The storefront is a presentation, merchandising and buyer-interaction channel. It is not a second commerce backend.

Authoritative ownership remains:

- MOD-A: products, variants, attributes, prices, promotions, discounts and tax quotes;
- MOD-B: stock availability, reservations and inventory effects;
- MOD-C: customers, carts/orders where owned, fulfilment, returns and delivery orchestration;
- MOD-E: payment intents, provider state, refunds, settlements and accounting effects;
- MOD-F: locale, currency metadata, timezone, country support and regulated presentation;
- MOD-G: SaaS entitlements, public APIs/webhooks, integration governance and shared tenant/domain control-plane capabilities where integrated.

The storefront must never calculate or post authoritative price, tax, stock, payment, refund, journal or inventory effects in browser state. Browser totals are display estimates only; final quotes and order effects come from owning-module contracts.

## 5. Merchant capabilities

MOD-H must deliver:

- one or more storefronts per entitled tenant;
- platform subdomain assignment;
- verified custom domains with certificate and lifecycle state;
- merchant branding, semantic theme and preview/publish revisions;
- header, footer, nested navigation, hero content, homepage sections and CMS pages;
- explicit product and variant sales-channel publication controls;
- draft, scheduled, published, hidden and archived publication states;
- online visibility independent from POS/product operational activity;
- category and collection merchandising;
- public product/category/collection/search pages;
- exact-money cart quote and checkout;
- guest and customer-account journeys according to effective policy;
- order placement into the existing sales/payment/stock authority;
- order confirmation, tracking and buyer recovery states;
- SEO metadata, canonical URLs, robots, sitemaps and product feeds;
- tenant/hostname/locale/currency/price-list scoped edge caching and invalidation;
- R2-backed media and Cloudflare image delivery;
- audit, permissions, observability, security, runbooks and recovery evidence.

## 6. Source adaptation policy

The product owner has authorised selected adaptation from the reviewed external repository. Product-facing source names, logos, domains, demo data and branding must not ship. The product identity remains owned by Ozzyl IT Services.

This authorisation does not permit silent provenance removal. Every copied or adapted file must be recorded with exact upstream path, commit, local path, modification summary and rights basis in the reuse register or a MOD-H file manifest. Copyright and licence notices required by the applicable rights grant must remain in internal notices/source records even when no upstream brand appears in the customer UI.

Do not import the external repository wholesale. Import only reviewed files that fit the approved architecture. Before each import batch:

1. list exact upstream paths and commit;
2. classify `copy`, `adapt`, `concept-only` or `reject`;
3. confirm no D1/database/core business dependency enters the proprietary authoritative modules;
4. create or update provenance records;
5. replace API/domain types with Ozzyl contracts;
6. run licence, secret, architecture and test gates.

## 7. Approved reuse categories

### Adapt with high reuse value

- Astro SSR storefront application structure;
- React islands and responsive buyer components;
- product, category, collection, search and CMS route/page composition;
- product gallery, variant selection, cart and checkout presentation flows;
- homepage hero, collection, category-rail and trust-strip composition;
- semantic theme schema, sanitisation and preview patterns;
- header, footer and navigation rendering patterns;
- Cloudflare Cache API + KV generation + build-ID invalidation patterns;
- canonical cache-key and private-route bypass patterns;
- SEO, canonical URL, JSON-LD, robots, sitemap and feed rendering patterns;
- media URL, responsive image and unavailable/error state patterns;
- narrowly relevant storefront tests and boundary-test patterns.

### Reimplement against Ozzyl contracts

- generated API client and endpoint modules;
- product/domain response types;
- exact-money cart state and quote application;
- customer authentication and sessions;
- order creation and payment-session orchestration;
- shipping/country/provider selection;
- cache invalidation producer contracts;
- tenant, storefront, host and sales-channel resolution;
- publication and merchandising persistence;
- custom-domain onboarding and control plane.

### Reject from runtime implementation

- D1 schema and migrations;
- Drizzle/D1 domain services;
- Scalius API worker and core business services;
- D1 FTS and D1-specific SQL;
- upstream inventory, pricing, discount, order, payment or accounting authority;
- committed upstream KV IDs, domains, service names, credentials or environment values;
- upstream admin visual system as a parallel design language;
- upstream branding, logos, marketing copy, demo content and customer data.

## 8. Owned paths

MOD-H owns new additive paths:

- `apps/storefront-web/**`
- `modules/storefront/**`
- `packages/storefront-contracts/**`
- `packages/storefront-client/**`
- `packages/storefront-theme/**`
- `database/modules/storefront/migrations/**`
- `tests/storefront/**`
- `docs/architecture/storefront/**`
- `docs/modules/storefront/**`
- `docs/agent-handoffs/MOD-H-*.md`

Existing shared composition, foundation contracts, top-level CI, SaaS control-plane or another module's schema may be changed only through an approved additive integration patch or CCR. No MOD-H migration may create or silently mutate tables in another module's schema.

## 9. Data model target

At minimum design and migrate:

- `storefront.storefronts`
- `storefront.sales_channels`
- `storefront.domains`
- `storefront.domain_verifications`
- `storefront.product_publications`
- `storefront.variant_publications`
- `storefront.category_publications`
- `storefront.collections`
- `storefront.collection_members`
- `storefront.theme_revisions`
- `storefront.navigation_documents`
- `storefront.content_pages`
- `storefront.homepage_revisions`
- `storefront.cache_generations`
- `storefront.audit_projection` only when required; authoritative audit remains the shared platform audit path.

Every table must include tenant scope and appropriate legal-entity/store/sales-channel dimensions. Public resolution must fail closed when the host, storefront, publication, country support or entitlement state is invalid.

## 10. Public contract target

Provide versioned contracts for:

- host/storefront bootstrap;
- layout and homepage bundles;
- public catalog listing, detail, facets and search;
- exact cart quote and quote refresh;
- checkout capability/configuration;
- order submission and idempotent result;
- customer session/account reads;
- order receipt/tracking reads;
- domain create/verify/activate/suspend/delete lifecycle;
- theme/content preview and publish;
- publication commands;
- cache invalidation events.

Money must use the existing exact Money contract or an explicitly approved additive storefront representation using currency, minor-unit string and scale. Binary floating point is prohibited.

## 11. Cloudflare topology

Target topology:

```text
Buyer custom domain or platform subdomain
  -> Cloudflare hostname/custom-hostname routing
  -> Storefront Astro Worker
  -> Cloudflare Service Binding or authenticated HTTPS fallback
  -> Ozzyl API/BFF composition
  -> MOD-A/B/C/E/F/G authoritative services
  -> Neon PostgreSQL canonical state
```

KV, Cache API and Workers memory are bounded caches only. They are not canonical publication, order, domain or inventory databases.

## 12. Implementation milestones

### H0 — Activation and provenance

- branch/worktree/Neon verification;
- workpack, tracker and programme-board activation;
- exact upstream commit and reuse manifest;
- source-rights/provenance record;
- architecture and contract dependency map.

### H1 — Storefront foundation

- `apps/storefront-web` Cloudflare/Astro shell;
- original Ozzyl product identity and design tokens;
- runtime configuration and hostname context;
- storefront contracts/client package skeleton;
- health/unavailable/security middleware;
- CI, lint, typecheck and test gates.

### H2 — Storefront domain and publishing

- Neon migrations and RLS;
- storefront/sales-channel/domain/publication services;
- product/variant/category online visibility controls;
- permissions, audit and outbox events;
- admin management surfaces.

### H3 — Public catalog and content

- bootstrap/layout/homepage APIs;
- product/category/collection/search pages;
- theme, header/footer/navigation, hero and CMS;
- media and cache generation;
- SEO/discovery routes.

### H4 — Exact cart and checkout

- exact quote contract;
- cart persistence without authoritative arithmetic;
- inventory/price/tax revalidation;
- shipping/payment capability rendering;
- idempotent order submission and recovery.

### H5 — Customer and order experience

- customer session/account;
- order confirmation, receipt and tracking;
- returns/support entry points within owning-module policy;
- privacy and accessibility controls.

### H6 — Custom domains and SaaS operations

- platform subdomains;
- custom-hostname verification and certificate lifecycle;
- redirects/canonical domain;
- suspension, entitlement and offboarding behavior;
- domain conflict and takeover protections.

### H7 — Hardening and handoff

- multi-tenant cache isolation;
- abuse/rate-limit/security tests;
- browser/RTL/accessibility evidence;
- load/performance and cache invalidation evidence;
- Neon fresh rebuild/recovery;
- Cloudflare preview/deploy/cleanup evidence;
- runbooks, module docs, final handoff and integration instructions.

## 13. Current checkpoint

Current checkpoint is `H0`. The Git branch has been created. Documentation, machine-readable tracking and source provenance are being established before code import. The next implementation action is H1 scaffolding without importing D1 or upstream business authority.

## 14. Completion gate

MOD-H is not complete until:

- a merchant can create a storefront and publish only selected online products;
- an unpublished POS product never appears publicly;
- public catalog price/availability comes from authoritative contracts;
- checkout revalidates price, tax, stock and capabilities before order commit;
- retries cannot duplicate orders, payments, reservations or ledger effects;
- two tenants and two hostnames cannot cross-read cache or content;
- a platform subdomain and a verified custom domain both resolve correctly;
- domain takeover and stale certificate states fail closed;
- exact money, localization, RTL, accessibility and SEO tests pass;
- copied/adapted files have complete provenance and required notices;
- fresh Neon migration, recovery, Cloudflare preview, observability and runbook evidence pass;
- final handoff names every commit, migration, upstream file, known limitation and serial integration step.
