# Selective Storefront Adaptation Plan

## Reviewed source

- Repository: `https://github.com/scaliuslabs/scalius-commerce-lite`
- Branch: `mono-repo`
- Commit: `4cb83aecb6d27483951618dcf8398592e662f241`
- Upstream runtime: Cloudflare Workers
- Upstream storefront: Astro SSR with React islands
- Upstream backend/database: Hono + D1/Drizzle
- Local backend/database: existing Ozzyl modular-monolith APIs + Neon PostgreSQL

The reviewed source is an adaptation source, not a second runtime backend. Ozzyl product branding, contracts and authoritative domain modules replace the upstream business identity and authority.

## Decision summary

| Area | Decision | Local implementation |
|---|---|---|
| Astro storefront structure | Adapt | `apps/storefront-web` |
| React buyer components | Adapt selectively | Original product branding and design review required |
| Tailwind/theme mechanics | Adapt selectively | Map to approved product presentation rules |
| API client structure | Reimplement | `packages/storefront-client` using Ozzyl contracts |
| API/domain response types | Reimplement | `packages/storefront-contracts` |
| Edge cache pattern | Adapt | Tenant/storefront/host/locale/currency scoped |
| Homepage/layout bundles | Adapt concept and composition | Ozzyl bootstrap/homepage endpoints |
| Product/category/search UI | Adapt | Data from MOD-A/B contracts |
| Cart/checkout UI | Adapt presentation only | Exact quote/order orchestration from MOD-A/B/C/E |
| Theme/header/footer/navigation | Adapt schema/patterns | Persist in Neon storefront schema |
| SEO/sitemap/feed rendering | Adapt | Authoritative data and country policy from Ozzyl modules |
| Customer auth/account UI | Adapt presentation only | Ozzyl identity/customer session |
| Custom domains | Build locally | Cloudflare hostname control plane + Neon canonical records |
| D1/Drizzle schema | Reject | Neon migrations owned by MOD-H |
| Upstream API/core services | Reject | Existing Ozzyl backend authority |
| Upstream pricing/inventory/order/payment logic | Reject | MOD-A/B/C/E authority |
| Upstream admin design system | Reject as a parallel system | Use Operations Ledger shared UI |
| Branding/assets/demo copy | Reject | Original Ozzyl product identity |

## First adaptation candidates

The first reviewed code batch may consider only storefront-facing files with no direct D1/core imports. Candidate families:

- `apps/storefront/src/layouts/**`
- `apps/storefront/src/components/**`
- `apps/storefront/src/pages/**` for public page composition
- `apps/storefront/src/styles/**`
- `apps/storefront/src/lib/edge-cache.ts` and related cache-key/generation helpers
- `apps/storefront/src/lib/page-data*`
- `apps/storefront/src/lib/storefront-unavailable-response*`
- `apps/storefront/src/lib/seo*` and discovery renderers
- `packages/shared/src/storefront-theme.ts` and focused tests

Every actual file must be listed in `upstream-file-manifest.yaml` before or in the same commit as its local adaptation.

## Files that must not be copied into MOD-H

- `packages/database/**`
- D1 migrations or Wrangler D1 bindings
- `packages/core/**` commerce/domain services
- `apps/api/**` business routes and queue consumer
- Better Auth administrative backend
- upstream payment and delivery provider authority
- fixed `wrangler.jsonc` namespace IDs, service names, URLs or secrets
- upstream product names, logos, favicons, marketing text or demo data

## Required local contract changes

The upstream buyer types use JavaScript `number` for many money fields. MOD-H must replace those with exact contracts. Minimum public money form:

```ts
export interface StorefrontMoneyV1 {
  currency: string;
  minor: string;
  scale: number;
}
```

The browser may format this value but may not derive authoritative tax, discount, shipping or total effects. The backend quote returns complete line and total snapshots with version/idempotency metadata.

## Publication model replacement

Upstream public eligibility is not sufficient for the requirement that operational/POS products may remain hidden online. MOD-H must implement channel publication independently:

- storefront and sales-channel identity;
- product and variant publication records;
- draft/scheduled/published/hidden/archived state;
- search/feed/sitemap exposure flags;
- price-list and inventory-policy references;
- country/region availability;
- publication revision and audit metadata.

## Cache adaptation requirements

Adapt the upstream L1 + Cache API + KV generation strategy only after adding:

- tenant ID;
- storefront ID;
- canonical hostname/domain revision;
- locale;
- currency;
- price-list/channel revision;
- catalog/publication generation;
- build ID.

Private customer/account/cart/checkout responses must never enter shared public caches. Missing tenant, host or generation state must fail closed or bypass cache; it must never fall back to another tenant's namespace.

## Custom domain target

The upstream project has a fixed storefront URL and manually managed production domain. MOD-H requires a new multi-tenant lifecycle:

1. merchant requests platform subdomain or custom hostname;
2. canonical Neon record reserves the hostname;
3. verification token/instructions are generated;
4. Cloudflare custom-hostname/certificate state is reconciled;
5. hostname is activated only after ownership and certificate checks;
6. router resolves hostname to tenant/storefront/sales channel;
7. suspension/deletion removes public resolution and prevents takeover races;
8. redirects and canonical-domain policy are explicit and audited.

## Branding rule

No buyer-visible or merchant-visible screen may use the upstream product name, logo, domains, favicons or marketing copy. Local component names should use generic commerce terminology or approved Ozzyl product terminology. Internal provenance records keep upstream paths and copyright/licence evidence where required.

## Verification per adaptation batch

- exact upstream file/commit recorded;
- no D1/core/business-authority import;
- no upstream branding/assets/demo content;
- TypeScript and architecture boundaries pass;
- exact-money scan passes;
- tenant/cache isolation tests pass where relevant;
- accessibility, RTL and responsive checks pass for UI;
- licence/SBOM/provenance checks pass;
- modifications and local owner recorded.
