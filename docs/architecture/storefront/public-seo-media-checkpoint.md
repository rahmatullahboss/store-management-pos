# MOD-H H3 SEO, Media and Cache Checkpoint

Status: **complete**

Checkpoint: `H3-SEO-MEDIA-04`

Source head: `d5e5c6a0b0a780a89c9702f0ade6f632c0dc60ab`

Storefront CI run: `30693905643`

## Delivered

- Published-only robots, sitemap, canonical metadata and structured product discovery.
- Bounded responsive product-media projection with safe relative/allowlisted transforms and original-asset fallback.
- Exact cache-generation families for bootstrap, content, catalog, product, category, collection, search, sitemap and media.
- Fail-closed cache bypass when generation lookup is missing, malformed, timed out or scope-mismatched.
- Safe API base-path joining for public media and cache-generation clients.
- Cache resource-token normalisation that cannot produce invalid leading-slash family keys.
- Selective `SF-UP-005` adaptation with no upstream business authority, branding, D1/KV persistence or floating-point money imported.

## Exact-head verification

| Gate | Evidence | Result |
|---|---|---|
| Storefront verify | job `91353332834` | Pass |
| PostgreSQL 17 rehearsal | job `91353407634` | Pass |
| Buyer/browser evidence | job `91353407632` | Pass |
| Cloudflare preview/runtime/cleanup | job `91353407633` | Pass |
| Non-destructive Neon recovery | job `91353407734` | Pass |

Repository verification completed with **486/486 tests passing**, zero Astro diagnostics and zero npm-audit vulnerabilities.

PostgreSQL 17 applied and rehearsed `STF-0001` through `STF-0017`, including the public SEO, media and cache-family rehearsals. Final storefront evidence reported 17 storefront migrations, 17 storefront tables, 17 forced-RLS tables, 95 audit events, 95 outbox events, 24 command receipts, one cache-generation row and nine cache-generation families.

Buyer design evidence passed **5/5** scenarios across `en-GB`, `bn-BD`, `ar` RTL and `ja-JP`. The Bengali mobile scenario used bounded 3G emulation at 750 Kbps down, 250 Kbps up and 150 ms latency. Axe, overflow/clipping, keyboard skip-link, reduced-motion and 200% text checks all passed. Public content, catalog and discovery evidence also remained green.

Cloudflare evidence deployed the disposable preview worker, confirmed remote reachability, recorded five runtime requests with zero errors, then deleted the worker. The Neon PITR recovery drill used a disposable recovery project and deleted it after the drill; no existing Neon branch was reset, deleted or repurposed.

## Authority boundary

- MOD-A remains authoritative for catalog, price, promotion, tax and source media inputs.
- MOD-B remains authoritative for stock availability and reservations.
- MOD-H owns only public projection, presentation, crawler policy, public media delivery policy and storefront cache-generation isolation.
- PostgreSQL/Neon remains canonical; Cloudflare delivery infrastructure is not a business-data authority.

## Remaining external blocker

The dedicated `dev/module-storefront-commerce` Neon branch is still not created because the non-production project remains at the 10/10 branch limit. Existing branches are preserved. Until a safe slot exists, the approved evidence path remains PostgreSQL 17 full replay plus non-destructive Neon recovery.

H3 is complete. PR #48 remains draft and MOD-H proceeds to H4 Exact Cart and Checkout.
