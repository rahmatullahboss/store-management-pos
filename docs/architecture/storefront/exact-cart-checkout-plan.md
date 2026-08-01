# MOD-H H4 Exact Cart and Checkout Plan

Status: **active**

Checkpoint: `H4`

Active slices: `H4-QUOTE-02`, `H4-CHECKOUT-03`, contract/preflight `H4-SUBMIT-04`, and verified buyer recovery

## Objective

Deliver a storefront cart and checkout flow that never treats browser arithmetic or browser-supplied commercial facts as authoritative. Product identity and buyer intent may live in the browser; price, promotion, tax, stock, shipping capability, payment capability, reservation, order and accounting truth must be resolved by the owning server modules.

## Authority boundaries

- **MOD-A**: catalog identity, price lists, promotions, discounts and tax calculation.
- **MOD-B**: stock availability and reservations.
- **MOD-C**: customer, sales quote/order orchestration and fulfillment/shipping capability.
- **MOD-E**: payment intent/state, capture/refund and accounting side effects.
- **MOD-F**: effective country, locale, address/contact policy and jurisdictional behavior.
- **MOD-H**: public cart state, buyer presentation, public request validation, host-context reconciliation and recovery UX only.

MOD-H must not create a second pricing engine, tax engine, reservation ledger, order ledger, payment state machine or accounting journal.

## H4-QUOTE-01 — cart intent and exact quote contract

Status: **complete and verified**

Completed:

1. Added `storefront-cart-draft.v1`, an authority-free buyer cart contract containing only product ID, variant ID, exact quantity, coupon codes, destination country, revision and update time.
2. Added storefront-scoped browser cart persistence with monotonic revision, a 64 KiB bound, explicit corrupt/oversized-storage recovery and idempotent missing-line removal.
3. Cart draft schemas strictly reject price, discount, tax, total, availability, stock, shipping amount, payment capability and other unsupported authority fields.
4. Added deterministic cart-draft → `storefront-cart-quote-request.v1` projection. Empty carts and malformed/local commercial injection fail before any authority call.
5. Quote requests require an idempotency key and cart revision and accept only buyer intent.
6. Versioned quote envelopes remain scoped to resolved storefront host context and project MOD-C quote identity/revision/expiry and exact integer-minor line/totals without recomputing authority in the browser.
7. Immutable authority evidence includes price-list revision, publication generation, MOD-A calculation IDs and MOD-B inventory versions.
8. Revalidation outcomes are explicit `ready`, `changed` or `unavailable`; malformed or stale quote responses fail closed.

Exit met: browser persistence contains buyer intent only, corrupted local state is recoverable without being trusted, and no local commercial value can become quote authority.

## H4-QUOTE-02 — authoritative quote adapter

Status: **active; safe composition implemented, final price/tax and shipping ownership capabilities blocked by Issue #97**

Completed:

1. Hostname is resolved through the existing active storefront bootstrap.
2. Requested product/variant UUIDs are reconciled with the published MOD-H catalog projection.
3. An authenticated canonical MOD-C customer principal resolver forwards only an already-authorised `RequestContext`; MOD-H never grants `sales.quote.create` or creates a guest customer.
4. Current MOD-B availability is re-read across the complete sales-channel warehouse scope with exact quantity aggregation and deterministic opaque stale evidence.
5. MOD-C `SalesService.createQuote` bridge forwards the exact trusted context without permission synthesis.
6. Canonical sales quote scope, customer, currency, line identity, quantity, price-tax snapshot identity, revision and expiry are revalidated before public projection.
7. Bounded no-store quote handler and typed client exist but are intentionally unregistered in production routing.

Remaining before quote route activation:

1. Additive MOD-C-owned lossless input path for full MOD-A price/tax calculation context or immutable validated `PriceTaxSnapshotV1`; do not flatten multi-component/compound/inclusive/exempt tax into the legacy single-rate seed. See Issue #97.
2. MOD-C-owned pre-order shipping option/rate capability with exact amount, expiry and revision evidence. See Issue #97.
3. End-to-end idempotency replay, coupon rejection, price-change, stock-change and host/scope conflict evidence using the final owning-module adapters.

## H4-CHECKOUT-03 — shipping, country and payment capability

Status: **contract-first boundary complete; owning-module projections pending**

Completed:

1. `storefront-checkout-capability-request.v1` accepts quote ID/revision, cart revision, buyer destination and opaque selected shipping/payment capability IDs only.
2. Browser shipping amount, payment amount, tax and total fields are rejected.
3. `storefront-checkout-capability-envelope.v1` carries exact versioned shipping options, safe payment capability references, quote expiry and authority revisions including `quoteAuthorityToken`, country policy, shipping and payment revisions.
4. Capability outcomes are explicit `ready`, `changed` or `unavailable`; no fallback choice is invented.
5. Host/bootstrap scope, quote ID/revision, selected option eligibility and quote/shipping/payment expiry are reconciled before ready state is accepted.
6. Bounded no-store API handler and typed HTTPS client exist but are intentionally unregistered in production routing.

Remaining before capability route activation:

1. Resolve effective typed country/address/contact requirements through MOD-F. See Issue #100; MOD-H will not infer required buyer fields from generic country-pack data.
2. Obtain versioned pre-order fulfillment/shipping options and exact amounts from MOD-C. See Issue #97.
3. Obtain side-effect-free public payment capability eligibility from MOD-E without exposing provider secrets or creating an intent merely for discovery. See Issue #98.
4. Revalidate quote price/tax and stock immediately before side effects through the final canonical adapters.

## H4-SUBMIT-04 — idempotent order and payment submission

Status: **contract, freshness preflight and deterministic request hashing complete; side effects blocked by Issues #97, #98 and #100**

Completed safely before side effects:

1. Added `storefront-checkout-submission-intent.v1`, accepting only quote/cart revisions, stable idempotency key, buyer destination, opaque shipping/payment selections, exact capability versions/revisions and optional opaque payment-method reference.
2. Submission intent strictly rejects browser totals, tax, payment amount, provider-account ID, warehouse ID and unsupported infrastructure/commercial authority.
3. Submission preflight requires the latest capability state to be `ready` and exact-matches quote ID/revision, `quoteAuthorityToken`, country-policy revision, shipping revision, payment revision and selected option versions.
4. Quote, selected shipping option and selected payment capability expiry are checked before any side-effect layer can run.
5. Added deterministic SHA-256 submission request hashing over the normalized strict intent. Key ordering does not change the hash; changing quote/shipping/payment authority evidence does.
6. No MOD-C order creation/conversion, MOD-B reservation, MOD-E payment intent or accounting side effect is wired from the storefront yet.

Remaining after owning-module capabilities are concrete:

1. Re-resolve the final quote/price-tax, stock, country policy, shipping and payment capability immediately before side effects.
2. Convert/create the order through MOD-C so inventory reservation remains MOD-B-owned through MOD-C orchestration.
3. Create payment intent through MOD-E using the authoritative MOD-C order reference and exact amount only.
4. Treat provider/network ambiguity as `unknown` until reconciled; never assume failure and retry side effects blindly.
5. Prove retries/concurrency cannot duplicate order, reservation, payment or ledger effects.
6. Return confirmation/receipt state only from canonical MOD-C/MOD-E evidence.

## H4-RECOVERY-05 — buyer-safe stale-state recovery

Status: **complete and verified for the pre-side-effect H4 surface**

Completed:

1. Added a typed recovery view-model that maps corrupt cart recovery, quote expiry/change/unavailability, price-tax changes, inventory changes, country-policy changes, shipping changes, payment changes and checkout unavailability to explicit blocking actions.
2. The recovery model never parses backend error text and only permits `canSubmit=true` when quote and checkout capabilities are both `ready` with no recovery item.
3. Added accessible server-rendered recovery UI with English, Bengali, Arabic RTL and Japanese/CJK copy; it performs no canonical mutation.
4. Added synthetic evidence-only route; no production/customer data is used.
5. Added bounded process-group lifecycle around recovery browser evidence to prevent dev-server child/grandchild leakage or CI hangs without weakening the assertions.
6. Browser evidence checks axe WCAG, lang/dir, exact recovery reasons, safe actions, overflow/clipping, upstream-brand leakage, skip-link/keyboard behavior, reduced motion and 200% text.
7. Bengali recovery runs under bounded 3G, Arabic under RTL and Japanese covers CJK presentation.

Exit met: stale/corrupt pre-side-effect checkout states produce explicit safe buyer recovery instead of silent fallback, unsafe submit or ambiguous error text.

## Verified checkpoint evidence

Exact code head `db135e7c72ac418ee1158ab10cb3665ee88ab943`, Storefront CI run `30710984952`:

- root format, lint, module boundaries, TypeScript, database validation, build, complete tests and security gates: passed;
- PostgreSQL 17 storefront rehearsal: passed;
- existing buyer browser/accessibility evidence: **5 / 5 scenarios passed**;
- checkout recovery browser/accessibility evidence: **4 / 4 scenarios passed with 0 axe violations**;
- admin browser/accessibility evidence: **4 / 4 scenarios passed**;
- Astro check during browser evidence: **25 files, 0 errors, 0 warnings, 0 hints**;
- Cloudflare preview deploy, runtime metrics and cleanup: passed;
- non-destructive Neon recovery: passed directly on the exact head.

The previous fully counted H4 baseline at `400cfb00e78db334c903a298bc560f05c31ee526` passed 549/549 repository tests; the later exact head above contains the additional submit/idempotency/cart-state/recovery suites and its complete root test gate passed. This document does not infer a new numeric total without a directly surfaced aggregate count.

## Verification gates for remaining H4 work

- Root format, lint, boundaries, typecheck, build, database validation and tests.
- Unit tests for request/response contracts and forbidden authority injection.
- PostgreSQL 17 integration rehearsal for any MOD-H schema additions with forced RLS and direct-write denial.
- End-to-end quote/revalidation/submit tests with canonical MOD-A/B/C/E/F adapters or deterministic ownership-faithful doubles.
- Browser evidence for desktop/mobile, Bengali low-bandwidth, Arabic RTL, Japanese/CJK, keyboard, 200% text and reduced motion.
- Cloudflare preview/runtime/cleanup and non-destructive Neon recovery.

PR #48 remains draft until H4–H7 gates complete. Public quote, checkout capability and checkout submission mutation routes remain fail closed until every owning-module capability above is concrete and verified.
