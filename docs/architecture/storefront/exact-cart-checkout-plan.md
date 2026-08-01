# MOD-H H4 Exact Cart and Checkout Plan

Status: **active**

Checkpoint: `H4`

Active slices: `H4-QUOTE-02` and contract-first `H4-CHECKOUT-03`

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

1. Persist only a versioned cart draft containing product ID, variant ID, exact quantity and bounded buyer inputs such as coupon codes and destination country.
2. Explicitly reject browser payloads that attempt to provide price, discount, tax, total, availability, stock, shipping amount or payment facts.
3. Require an idempotency key and cart revision on quote requests.
4. Return a versioned quote envelope scoped to the resolved storefront host context.
5. Project MOD-C quote identity/revision/expiry and exact integer-minor line/totals without recomputing authority in the browser.
6. Include immutable authority evidence: price-list revision, publication generation, MOD-A calculation IDs and MOD-B inventory versions.
7. Represent revalidation outcomes explicitly as `ready`, `changed` or `unavailable`; malformed or stale quote responses fail closed.
8. Parser/boundary/client tests cover exact quantity, duplicate lines, forbidden commercial fields, malformed money, currency mismatch, revision/expiry and unavailable-line consistency.

Exit met: a browser cannot smuggle authoritative commercial values into the quote request, and a malformed/stale server quote cannot become a place-order input.

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
3. `storefront-checkout-capability-envelope.v1` carries exact versioned shipping options, safe payment capability references, quote expiry and authority revisions.
4. Capability outcomes are explicit `ready`, `changed` or `unavailable`; no fallback choice is invented.
5. Host/bootstrap scope, quote ID/revision, selected option eligibility and quote/shipping/payment expiry are reconciled before ready state is accepted.
6. Bounded no-store API handler and typed HTTPS client exist but are intentionally unregistered in production routing.

Remaining before capability route activation:

1. Resolve effective typed country/address/contact requirements through MOD-F; do not infer required buyer fields from generic country-pack data.
2. Obtain versioned pre-order fulfillment/shipping options and exact amounts from MOD-C. See Issue #97.
3. Obtain side-effect-free public payment capability eligibility from MOD-E without exposing provider secrets or creating an intent merely for discovery. See Issue #98.
4. Revalidate quote expiry/revision, MOD-A price/tax and MOD-B stock immediately before submission.
5. Add canonical-adapter integration and recovery UI evidence for capability removal/version change.

## H4-SUBMIT-04 — idempotent order and payment submission

Status: **blocked by final H4-QUOTE-02 and H4-CHECKOUT-03 owning-module capabilities**

1. Accept only the current quote ID/revision, capability revisions, buyer choices and a stable idempotency key; do not accept browser totals.
2. Revalidate price/tax, stock, shipping, country policy and payment capability immediately before side effects.
3. Convert/create the order through MOD-C so inventory reservation remains MOD-B-owned through MOD-C orchestration.
4. Create payment intent through MOD-E using the authoritative MOD-C order reference and exact amount.
5. Treat provider/network ambiguity as `unknown` until reconciled; never assume failure and retry side effects blindly.
6. Ensure retries/concurrency cannot duplicate order, reservation, payment or ledger effects.
7. Return confirmation/receipt state only from canonical order/payment evidence.

## Verified checkpoint evidence

Exact code head `400cfb00e78db334c903a298bc560f05c31ee526`, Storefront CI run `30709204562`:

- format, lint, boundaries, TypeScript, build, database validation and security gates: passed;
- repository tests: **549 / 549 passed**;
- Astro check: **23 files, 0 errors, 0 warnings, 0 hints**;
- PostgreSQL 17 rehearsal: passed;
- buyer/admin browser and accessibility evidence: passed;
- Cloudflare preview deploy, runtime metrics and cleanup: passed;
- non-destructive Neon recovery: passed;
- dependency audit: **0 vulnerabilities**.

## Verification gates for remaining H4 work

- Root format, lint, boundaries, typecheck, build, database validation and tests.
- Unit tests for request/response contracts and forbidden authority injection.
- PostgreSQL 17 integration rehearsal for any MOD-H schema additions with forced RLS and direct-write denial.
- End-to-end quote/revalidation/submit tests with canonical MOD-A/B/C/E/F adapters or deterministic ownership-faithful doubles.
- Browser evidence for desktop/mobile, Bengali low-bandwidth, Arabic RTL, Japanese/CJK, keyboard, 200% text and reduced motion.
- Cloudflare preview/runtime/cleanup and non-destructive Neon recovery.

PR #48 remains draft until H4–H7 gates complete. Public quote and checkout mutation routes remain fail closed until every owning-module capability above is concrete and verified.
