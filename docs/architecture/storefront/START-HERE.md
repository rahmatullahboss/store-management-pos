# Storefront Continuation Hub

This is the first file to open when resuming MOD-H in a new chat or agent session.

## Exact coordinates

- Repository: `rahmatullahboss/store-management-pos`
- Workpack: `MOD-H — Storefront Commerce and Custom Domains`
- Branch: `module/storefront-commerce-v1`
- Worktree: `.worktrees/storefront-commerce`
- Neon branch: `dev/module-storefront-commerce`
- Integration target: `program/integration-v1`
- Workpack: `docs/agent-workpacks/MOD-H-STOREFRONT-COMMERCE.md`
- Live tracker: `docs/architecture/storefront/status.yaml`
- Upstream adaptation plan: `docs/architecture/storefront/SCALIUS-ADAPTATION-PLAN.md`
- File provenance manifest: `docs/architecture/storefront/upstream-file-manifest.yaml`

## Resume procedure

1. Read root `AGENTS.md` and do not reset or discard any existing state.
2. Verify current branch and ancestry.
3. Inspect branch/worktree dirty state before editing.
4. Read the workpack and `status.yaml` completely.
5. Verify the pinned upstream commit before adapting any new file.
6. Confirm the intended paths are MOD-H-owned or have an approved CCR/integration patch.
7. Continue the first incomplete checkpoint in `status.yaml`.
8. Run the checkpoint's tests, update tracker/evidence, commit and push.
9. Keep the PR draft until all H0–H7 completion gates pass.

## Current state

- H0 activation is active.
- The module branch and workpack exist.
- The initial external audit is complete at upstream commit `4cb83aecb6d27483951618dcf8398592e662f241`.
- Documentation and provenance are being established.
- No D1 schema, D1 business service or upstream commerce authority is approved for import.
- H1 storefront foundation scaffolding is the next implementation checkpoint.

## Authoritative module boundaries

- Product/price/tax: MOD-A
- Availability/reservation/stock: MOD-B
- Customer/order/fulfilment: MOD-C
- Payment/refund/accounting: MOD-E
- Locale/currency/country support: MOD-F
- SaaS entitlements/public integration/shared control plane: MOD-G when integrated
- Storefront publication, presentation, domains, themes, CMS and buyer channel: MOD-H

## Non-negotiable rules

- PostgreSQL/Neon remains canonical.
- KV, Cache API and Worker memory are caches only.
- Exact money is required; browser floating-point totals are never authoritative.
- A product can be active for POS while unpublished online.
- Hostname, tenant, storefront, locale, currency and price-list context must be part of cache isolation.
- Product-facing branding must be original to this product.
- Internal provenance records must identify adapted upstream files even when the upstream name is absent from the buyer UI.
- Do not import the upstream repository wholesale.

## Next actions

1. Finish H0 programme-board, reuse-register and tracker updates.
2. Create/verify `dev/module-storefront-commerce` from the approved non-production parent.
3. Scaffold `apps/storefront-web`, `packages/storefront-contracts`, `packages/storefront-client` and `packages/storefront-theme`.
4. Add runtime/host context, health route, unavailable state and boundary tests.
5. Only then begin the first reviewed upstream UI adaptation batch.
