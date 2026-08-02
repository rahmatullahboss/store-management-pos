# H3-CONTENT-01 — Public Content Checkpoint

**Workpack:** MOD-H — Storefront Commerce and Custom Domains  
**Branch:** `module/storefront-commerce-v1`  
**Verified head:** `b5fa25cc6e197c9bb9893ac0194028408fe89940`  
**Storefront CI:** `30513418700`

## Scope completed

This checkpoint adds a versioned, host-scoped and published-only public content path without moving catalog, pricing, inventory, customer, order, payment or accounting authority into MOD-H.

Completed surfaces:

- `STF-0006` context-free public resolver for active storefront hosts;
- versioned `storefront-public-content.v1` contract;
- published theme, header/footer/utility navigation, homepage and CMS page projection;
- public `GET|HEAD /v1/storefront/content?hostname=...&slug=...` API;
- typed storefront client `getContent` method;
- Worker content resolver and bootstrap/content scope reconciliation;
- public homepage and `/pages/{slug}` rendering;
- canonical URL, bounded SEO metadata, CSP and safe navigation links;
- fail-closed unknown host, unpublished page, malformed contract and scope mismatch behaviour;
- buyer browser evidence for English desktop, English mobile CMS and Arabic RTL tablet;
- Cloudflare preview propagation retry for the documented post-upload `10007` eventual-consistency race.

## Publication and isolation rules

The public database function starts from `storefront.resolve_public_host`, which already requires an active domain, active binding, active storefront and active sales channel. It selects only:

- `theme_revisions.status = 'published'`;
- `navigation_documents.status = 'published'`;
- `homepage_revisions.status = 'published'`;
- `content_pages.status = 'published'` matching the requested slug.

The public bundle must match bootstrap tenant, storefront, sales channel, request hostname, canonical hostname, locale, currency, price-list revision, publication generation, theme revision and layout revision. Any mismatch fails closed before HTML rendering.

Raw HTML is not accepted. Content is bounded JSON. The current renderer supports safe hero and text blocks and ignores unknown future block types.

## Compatibility migrations

PostgreSQL 17 rehearsal exposed output-column/PLpgSQL identifier collisions in the original STF-0005 command functions. Existing migrations were not rewritten.

Append-only corrections:

- `STF-0007` qualifies the parent product-publication state used by `set_variant_publication`;
- `STF-0008` qualifies category parent lookups, collection-member deletion, navigation revision, content-page status/revision and homepage status/revision references.

All corrected function signatures, idempotency behaviour, audit/outbox effects, cache-generation effects, PUBLIC revokes and runtime grants remain unchanged.

## Verification evidence

Storefront CI run `30513418700`:

- verify job `90778058213`: success;
- PostgreSQL 17 rehearsal job `90778179295`: success;
- browser evidence job `90778179223`: success;
- Cloudflare preview/runtime/cleanup job `90778179203`: success;
- non-destructive Neon recovery job `90778179526`: success.

Verified results:

- repository tests: `429/429`;
- buyer storefront browser scenarios: `3/3`;
- storefront admin browser scenarios: `4/4`;
- H3 public-content browser scenarios: `3/3`;
- PostgreSQL raw log: no `ERROR:` entries;
- storefront migrations: `8`;
- storefront tables with forced RLS: `16/16`;
- audit events: `35`;
- outbox events: `35`;
- command receipts: `23`;
- cache-generation scopes: `1`;
- Cloudflare runtime requests: `42`;
- Cloudflare runtime errors: `0`;
- Cloudflare preview Worker deleted after evidence capture.

PostgreSQL fixture markers passed:

- storefront core command/RLS rehearsal;
- public-host resolution and suspension rehearsal;
- STF-0005 publication command rehearsal;
- published public-content projection rehearsal.

## External blocker

The non-production Neon project remains at its `10/10` branch limit. No existing branch was deleted, reset or repurposed. Local PostgreSQL 17 rehearsal and non-destructive Neon recovery remain mandatory until a safe slot exists for `dev/module-storefront-commerce`.

## Next slice

`H3-CATALOG-02` will compose published MOD-H product/category/collection selection with authoritative MOD-A catalog and exact pricing projections and MOD-B availability. MOD-H will only shape public presentation; it will not calculate or persist authoritative price, tax or stock.
