# MOD-A — Catalog, Pricing and Tax Handoff

**Checkpoint date:** 2026-07-28  
**Repository:** `rahmatullahboss/store-management-pos`  
**Git branch:** `module/catalog-pricing-tax-v1`  
**Assigned worktree:** `.worktrees/catalog-pricing-tax`  
**Approved Foundation SHA:** `57f21e8c14e27ce3ad96a862cf6de82c2c6cd27c`  
**Neon project:** `store-management-pos-nonprod` (`twilight-boat-26805962`)  
**Neon branch:** `dev/module-catalog-pricing-tax` (`br-fancy-bird-axo3z9ek`)  
**Database:** `neondb`  
**Workpack state:** `active`

## Safety and activation evidence

- Root workspace and isolated worktree were clean before implementation.
- Branch and worktree were created from the exact approved Foundation SHA.
- The GitHub remote branch was created from the same exact SHA.
- No existing changes were reset, discarded, overwritten or force-pushed.
- Required repository, product, design, execution, activation, board, workpack, architecture, security, testing and ADR instructions were reviewed.
- MOD-A is being executed by one whole-workpack implementation agent; no small-task implementation agents were created.
- The isolated Neon branch was created and bootstrapped with deterministic Foundation migrations `FND-0001` through `FND-0005`; the default/main branch was not changed.

## Baseline verification

`npm run verify` passed before MOD-A source changes:

- format and lint;
- module boundary validation;
- strict TypeScript typecheck;
- build and 15 unit/architecture tests;
- secret and licence scans;
- CycloneDX SBOM generation.

## Active delivery scope

1. Catalog model, products, variants, attributes, units, barcodes, localization, search, bundles and supplier references.
2. Versioned price lists, scheduled pricing, quantity tiers, channels, locations, customer scopes, promotions, coupons and controlled discounts.
3. Global tax codes, jurisdictions, effective rates, inclusive/exclusive/compound calculation, exemptions, zero/reverse charge and immutable snapshots.
4. PostgreSQL migrations, forced RLS, privileges, idempotent commands, audit events and outbox events.
5. Module APIs, admin UI, permissions, approvals, imports/exports, observability, tests, performance evidence, runbooks and final integration handoff.

## Current checkpoint

Activation and Foundation-schema bootstrap are complete. Domain implementation starts with catalog migrations and exact domain primitives.
