# MOD-H H5 Customer Account and Order Read Progress

Status: **active, contract-first**

Completed slices: `H5-ACCOUNT-01`, `H5-TRACKING-02`, `H5-PRIVATE-HARDEN-03`, `H5-PAGINATION-04`

Latest fully verified implementation head: `7485f4e80c468de328093fcc09fd22efdc25a110`

Storefront CI: `30727323408`

## Objective

Provide buyer-owned profile, order history/detail and status presentation without allowing browser-selected customer identity, cross-storefront order disclosure, public caching of private data, or leakage/invention of operational, payment, inventory, carrier or return authority.

H5 is progressing only through blocker-independent read/presentation work while H4 mutation authority remains fail closed.

## H5-ACCOUNT-01 — complete and verified

- Added versioned private customer profile, bounded order-history request/page and order-detail contracts.
- History request carries pagination intent only; browser customer identity is not part of the request contract.
- Exact money remains currency + integer-minor string + scale; fractional/binary floating-point money is rejected.
- `StorefrontAccountPrincipalV1` accepts only `authenticated-session`; MOD-H never grants `customer.profile.read` or `sales.order.read` and never derives canonical customer identity from browser input.
- Canonical customer must be active and match tenant/legal-entity scope.
- Buyer profile projection allowlists display name, supported email/phone/mobile contacts, addresses, profile revision and update time; tax registrations, credit, consent, tags/groups, website contacts and staff/audit identities are excluded.
- `StorefrontCustomerOrderReadPort` requires trusted request context, canonical customer ID, storefront ID and sales-channel ID.
- Order detail revalidates tenant, legal entity, store, customer, storefront and sales-channel identity plus persisted price/tax snapshot item and quantity identity before projection.
- Buyer order projection excludes warehouse IDs, reservation IDs, payment intent/provider state, R2 object keys, internal notes, salesperson/commission metadata, calculation/rule IDs and staff/audit identities.
- Credentialed GET-only private clients require HTTPS except bounded localhost, use `credentials: include` and `cache: no-store`, and revalidate hostname/order identity.
- Malformed private responses are converted to generic client errors rather than exposing parser internals.
- Added an unregistered private account handler for profile/history/detail. Browser `customerId` is rejected before principal resolution; responses are `private, no-cache, no-store, must-revalidate` with `Vary: Authorization, Cookie`.
- Unit tests statically assert that account paths/handler remain absent from runtime routers.

H5-ACCOUNT-01 was fully verified at exact head `d86cd8e8c55a7e51dda8099c428c2e17adc4c277`, Storefront CI `30722815560`.

## H5-TRACKING-02 — complete and verified

- Added a read-only `StorefrontOrderTrackingViewV1` derived solely from strict buyer-safe `StorefrontOrderDetailV1` facts.
- Presentation state derives only from canonical order/payment/fulfillment/return statuses; no synthetic shipment timeline, carrier event, tracking URL, ETA, refund/return mutation or fulfillment authority is invented.
- Exact money and quantity formatting uses integer strings and never converts financial minor values through binary floating point, including values beyond JavaScript safe-integer range.
- Added an accessible server-rendered order-status component with fully externalized English, Bengali, Arabic/RTL and Japanese/CJK state/status/method labels.
- Added a synthetic evidence-only route and process-group-bounded browser evidence runner.
- Tracking evidence covers Axe WCAG 2 A/AA/2.1 AA, locale/direction, translated state, large exact-money rendering, raw/internal leakage, clipping/overflow, keyboard skip-link, reduced motion and 200% text; Bengali uses bounded 3G.

H5-TRACKING-02 was fully verified at exact head `5d7e8bfb4958d7ab53d2abb50192cefde6a8aba2`, Storefront CI `30723253734` with order-tracking browser evidence **4/4**.

## H5-PRIVATE-HARDEN-03 — complete and verified

- Private 403 access-denial responses return only `{ error: { code: "ACCOUNT_ACCESS_DENIED" } }`.
- Canonical customer, ownership, legal-entity, storefront, sales-channel or permission mismatch details are not reflected to an untrusted buyer.
- 400 malformed-request responses may retain bounded validation detail; authentication absence remains 401 and unknown order remains 404.
- A regression test proves a mismatched canonical customer produces a generic 403 without ownership/scope detail leakage.

H5-PRIVATE-HARDEN-03 was fully verified at exact head `b35b0e260abdcfd882240437f47f59f98a2e7548`, Storefront CI `30723499435`.

## H5-PAGINATION-04 — complete and verified

Order-history pagination no longer assumes that an owning-module cursor is a UUID.

- `StorefrontOrderHistoryRequestV1.cursor` and `StorefrontOrderHistoryPageV1.nextCursor` remain `string | null` but are validated as bounded URL-safe opaque tokens.
- MOD-H accepts up to 512 characters from `[A-Za-z0-9._~:=-]`; UUID cursors continue to work because they are a valid subset.
- Slash/path syntax, whitespace/control characters and over-512-character cursor values fail closed.
- Customer IDs, order IDs, product IDs, variant IDs and other canonical identities remain UUID-only; only pagination cursor semantics changed.
- `StorefrontCustomerOrderReadPort` forwards the opaque cursor without interpreting its internal structure.
- MOD-H revalidates the owning-module `nextCursor` before returning it to a buyer; unsafe provider/adapter cursor output fails closed.
- The credentialed private client transports the cursor via `URLSearchParams`, preserves it round-trip and still never sends browser-selected customer identity.
- Added direct module-boundary tests using an empty order page so pagination behavior is verified independently of a synthetic `SalesOrder` fixture.
- Private account/order routes remain deliberately unregistered pending Issue #101; this refinement does not activate a live private surface.

### Exact verified evidence

Implementation head: `7485f4e80c468de328093fcc09fd22efdc25a110`

Storefront CI: `30727323408`

- verify `91441336353` — **passed**;
- PostgreSQL 17 rehearsal `91441384231` — **passed**;
- buyer/admin browser, accessibility and bounded performance `91441384334` — **passed**;
- Cloudflare preview/runtime/cleanup `91441384267` — **passed**;
- non-destructive Neon recovery `91441384470` — **passed**.

The initial cursor head `6886754439884c31d26e2f77f141d2c549df0ac4` failed before type/tests only because the two edited TypeScript files were missing their final newline. The follow-up commit added only the missing newlines; cursor semantics were not weakened or reverted.

## Deliberately not exposed yet

No private customer account/order API route is registered in production. No live storefront account/order tracking page is connected to private canonical customer data yet.

Route activation requires Issue #101:

1. trusted authenticated session → canonical active customer binding for the current tenant/legal-entity/storefront scope;
2. MOD-C customer + storefront + sales-channel scoped bounded order history/detail capability with canonical channel-origin evidence.

MOD-H will not substitute browser `customerId`, actor ID, `externalSource`, repository scans or tenant-wide customer matches for those capabilities.

## Returns/support boundary

Current MOD-C sales operations expose privileged credit-note/cancellation/internal operational capabilities, not a buyer-safe customer return request. MOD-H therefore keeps order tracking read-only and does not expose those staff capabilities as buyer actions.

Issue #102 tracks the required customer-safe, idempotent, ownership-scoped return/support request capability. MOD-H will not infer eligibility, refund amount or approval state from order status alone.

## Related blockers

- Issue #97 — lossless MOD-A price/tax into MOD-C quote persistence and MOD-C pre-order shipping capability.
- Issue #98 — MOD-E side-effect-free public payment capability projection.
- Issue #100 — typed MOD-F checkout country/address/contact policy.
- Issue #101 — H5 trusted customer binding and storefront-scoped MOD-C order reads.
- Issue #102 — H5 buyer-safe return/support request capability.

## Next safe posture

Keep all live private customer/order routes fail closed until Issue #101 has concrete owning-module adapters and exact integration evidence. No additional pagination semantics should be inferred inside MOD-H beyond treating the cursor as a bounded opaque transport token.
