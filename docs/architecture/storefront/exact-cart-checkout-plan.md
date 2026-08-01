# MOD-H H4 Exact Cart and Checkout Plan

Status: **active**

Checkpoint: `H4`

Active slice: `H4-QUOTE-01`

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

1. Persist only a versioned cart draft containing product ID, variant ID, exact quantity and bounded buyer inputs such as coupon codes and destination country.
2. Explicitly reject browser payloads that attempt to provide price, discount, tax, total, availability, stock, shipping amount or payment facts.
3. Require an idempotency key and cart revision on quote requests.
4. Return a versioned quote envelope scoped to the resolved storefront host context.
5. Project MOD-C quote identity/revision/expiry and exact integer-minor line/totals without recomputing authority in the browser.
6. Include immutable authority evidence: price-list revision, publication generation, MOD-A calculation IDs and MOD-B inventory versions.
7. Represent revalidation outcomes explicitly as `ready`, `changed` or `unavailable`; malformed or stale quote responses fail closed.
8. Add parser tests for exact quantity, duplicate lines, forbidden commercial fields, malformed money, currency mismatch, revision/expiry and unavailable-line consistency.

Exit: a browser cannot smuggle authoritative commercial values into the quote request, and a malformed/stale server quote cannot become a place-order input.

## H4-QUOTE-02 — authoritative quote adapter

1. Resolve hostname through the existing active storefront bootstrap.
2. Reconcile requested product/variant IDs with published MOD-H catalog projection.
3. Resolve authoritative price/promotion/tax inputs from MOD-A; never use client price/tax fields.
4. Resolve current availability/version evidence from MOD-B.
5. Invoke MOD-C `SalesService.createQuote` / `reviseQuote` using server-resolved commercial inputs.
6. Project the resulting immutable `PriceTaxSnapshotV1` values into the public quote envelope.
7. Persist only opaque cart/quote linkage and recovery metadata owned by MOD-H where required; do not duplicate MOD-C sales truth.
8. Add idempotency replay, price-change, stock-change, coupon rejection and host/scope mismatch tests.

## H4-CHECKOUT-03 — shipping, country and payment capability

1. Resolve effective country/address/contact requirements through MOD-F.
2. Obtain fulfillment/shipping capability/options from MOD-C.
3. Obtain payment capability/options from MOD-E.
4. Revalidate quote expiry/revision, MOD-A price/tax and MOD-B stock immediately before submission.
5. Render unavailable capability states without inventing fallbacks.

## H4-SUBMIT-04 — idempotent order and payment submission

1. Accept only the current quote ID/revision and buyer choices; do not accept browser totals.
2. Convert/create the order through MOD-C with a stable idempotency key so inventory reservation is owned by MOD-B through MOD-C orchestration.
3. Create payment intent through MOD-E using the authoritative order reference and exact amount.
4. Treat provider/network ambiguity as `unknown` until reconciled; never assume failure and retry side effects blindly.
5. Ensure retries/concurrency cannot duplicate order, reservation, payment or ledger effects.
6. Return confirmation/receipt state only from canonical order/payment evidence.

## Verification gates

- Root format, lint, boundaries, typecheck, build, database validation and tests.
- Unit tests for request/response contracts and forbidden authority injection.
- PostgreSQL 17 integration rehearsal for any MOD-H schema additions with forced RLS and direct-write denial.
- End-to-end quote/revalidation/submit tests with deterministic MOD-A/B/C/E/F dependency doubles or canonical adapters.
- Browser evidence for desktop/mobile, Bengali low-bandwidth, Arabic RTL, Japanese/CJK, keyboard, 200% text and reduced motion.
- Cloudflare preview/runtime/cleanup and non-destructive Neon recovery.

PR #48 remains draft until H4–H7 gates complete.
