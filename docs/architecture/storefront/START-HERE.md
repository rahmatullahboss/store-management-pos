# Storefront Continuation Hub

This is the first file to open when resuming MOD-H in a new chat or agent session.

## Exact coordinates

- Repository: `rahmatullahboss/store-management-pos`
- Workpack: `MOD-H — Storefront Commerce and Custom Domains`
- Branch: `module/storefront-commerce-v1`
- Worktree: `.worktrees/storefront-commerce`
- Intended Neon branch: `dev/module-storefront-commerce`
- Neon state: blocked by the non-production project branch quota; do not delete, reset or repurpose another branch
- Integration target: `program/integration-v1`
- Workpack: `docs/agent-workpacks/MOD-H-STOREFRONT-COMMERCE.md`
- Live tracker: `docs/architecture/storefront/status.yaml`
- H3 content evidence: `docs/architecture/storefront/public-content-checkpoint.md`
- H3 catalog evidence: `docs/architecture/storefront/public-catalog-checkpoint.md`
- Upstream adaptation plan: `docs/architecture/storefront/SCALIUS-ADAPTATION-PLAN.md`
- File provenance manifest: `docs/architecture/storefront/upstream-file-manifest.yaml`

## Resume procedure

1. Read root `AGENTS.md` and do not reset, discard or overwrite existing state.
2. Verify the current branch, PR head and ancestry; the branch may move while CI-owned temporary correction workflows finish.
3. Inspect the assigned worktree dirty state before editing.
4. Read the workpack, `status.yaml`, the H3 checkpoint documents and the PR body completely.
5. Verify the pinned upstream commit before adapting any new file.
6. Confirm intended paths are MOD-H-owned or have an approved CCR/integration patch.
7. Continue the first incomplete acceptance gate or remaining H3 slice recorded below.
8. Run the complete checkpoint gates, update tracker/evidence, commit and push.
9. Keep PR #48 draft until all H0–H7 gates pass.

## Current state

- H0 activation/provenance is complete except for the external Neon branch-quota blocker.
- H1 storefront foundation is complete and verified.
- H2 publishing/domain foundation is complete and verified.
- H3 is active.
- `H3-CONTENT-01` is complete and verified at `b5fa25cc6e197c9bb9893ac0194028408fe89940`.
- `H3-CATALOG-02` implementation is present: public catalog/detail contracts, typed client, host-scoped API, `STF-0009`/`STF-0010`, authoritative MOD-A/MOD-B read composition, listing/detail rendering, unit/PostgreSQL/browser evidence and Cloudflare/recovery gates.
- H3 catalog must remain evidence-pending until one exact current source head passes every acceptance gate and the tracker/PR body record the exact run IDs and totals.
- Category, collection, search, media/cache generation and SEO discovery remain after the listing/detail checkpoint.

## Authoritative module boundaries

- Product/variant/unit/price/tax: MOD-A
- Availability/reservation/stock: MOD-B
- Customer/order/fulfilment: MOD-C
- Payment/refund/accounting: MOD-E
- Locale/currency/country support: MOD-F
- SaaS entitlement/integration/domain control plane: MOD-G
- Storefront publication, presentation, domains, themes, CMS and buyer channel: MOD-H

## H3 catalog safety boundary

- The public catalog is a bounded read composition, not a new commerce authority.
- Product and variant visibility comes from published MOD-H selection.
- Exact prices come from the active authoritative MOD-A web price-list revision.
- Availability comes from MOD-B sellable balances less active reservations inside the configured warehouse scope.
- Public pages expose `tax_calculated_at_checkout`; they do not calculate or claim a final statutory tax quote.
- Browser code must not create authoritative price, quantity, stock, tax, reservation, order, payment or ledger effects.
- Unknown host, malformed context, unpublished product, unsupported currency or inconsistent scope must fail closed.

## Security disposition

GitGuardian reported the historical CI-only value `POSTGRES_PASSWORD: postgres` from commit `31afafccaea8b6e16d76f677051c2de8b220b456`. It was an ephemeral local PostgreSQL service credential, not an external or production secret. The current workflow no longer contains it and uses an isolated loopback service without a password. Do not rewrite shared branch history; preserve the current tree, secret scan and documented disposition.

## Non-negotiable rules

- PostgreSQL/Neon remains canonical.
- KV, Cache API and Worker memory are caches only.
- Exact money and quantity representations are required.
- A product can remain active for POS while unpublished online.
- Cache keys must isolate tenant, storefront, hostname, locale, currency, price-list revision and publication generation.
- Product-facing branding must remain original to this product.
- Internal provenance must identify every adapted upstream file.
- Do not import the upstream repository wholesale or adopt its D1/business authority.

## Next actions

1. Obtain an exact-head H3 catalog CI result for core verification, PostgreSQL rehearsal, buyer accessibility evidence, Cloudflare preview/runtime/cleanup and Neon recovery.
2. Correct any exact-head failure without weakening authority, RLS, security, exact-money or accessibility boundaries.
3. Record the exact head, run/job IDs, test totals, database counts and browser scenario totals in `status.yaml`, the catalog checkpoint and PR #48.
4. Mark `H3-CATALOG-02` complete only after all gates pass.
5. Continue H3 with category/collection projections and pages, then bounded search/facets, media/cache generation and SEO discovery.
