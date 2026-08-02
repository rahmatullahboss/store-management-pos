# Storefront Source Adaptation Notice

This directory records provenance for selected storefront code adapted into MOD-H.

## Source baseline

- Repository: `https://github.com/scaliuslabs/scalius-commerce-lite`
- Reviewed branch: `mono-repo`
- Reviewed commit: `4cb83aecb6d27483951618dcf8398592e662f241`
- Public repository licence observed at the reviewed revision: GNU Affero General Public License v3
- Additional rights basis recorded by this project: product-owner-authorised separate use/adaptation for this storefront workstream

## Product-facing branding

The external project name, logos, domains, favicons, demo data and marketing copy are not part of the Ozzyl product. Buyer and merchant interfaces use an independently owned product identity.

## Provenance handling

Rebranding does not remove source provenance. Each imported or adapted file must be recorded in:

- `docs/open-source/reuse-register.yaml`
- `docs/architecture/storefront/upstream-file-manifest.yaml`

The manifest records the exact upstream path and commit, local path, adaptation mode, modification summary, tests and local maintenance owner.

## Scope restriction

Approved adaptation is limited to reviewed storefront presentation, theme, public page, cache, SEO, media and related test patterns. The following are not authorised for import into the local authoritative commerce core:

- D1/Drizzle schema or migrations;
- upstream API/core business services;
- upstream price, stock, order, payment or accounting authority;
- committed upstream secrets, namespace IDs, service names or domains;
- upstream branding/assets/demo content.

The Ozzyl platform's Neon PostgreSQL modules and exact-money contracts remain authoritative.
