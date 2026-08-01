# MOD-H H4 Canonical Quote and Checkout Authority Progress

Status: **active**

Current slices: `H4-QUOTE-02` + `H4-CHECKOUT-03` + pre-side-effect `H4-SUBMIT-04` + verified buyer recovery

Latest fully verified code head: `db135e7c72ac418ee1158ab10cb3665ee88ab943`

## Completed safely

### Buyer cart state and quote intent

- Added strict `storefront-cart-draft.v1` browser persistence containing product ID, variant ID, exact quantity, coupons, destination country, monotonic revision and update time only.
- Cart draft persistence is storefront-scoped, bounded to 64 KiB and explicitly recovers corrupt/oversized local storage by removing it and returning a safe empty draft with a recovery signal.
- Draft schema rejects price, discount, tax, total, stock, shipping amount, payment capability and unsupported fields; local state is never commercial authority.
- Cart draft projects deterministically into `storefront-cart-quote-request.v1`; empty carts or malformed/local commercial injection fail before any canonical authority call.

### Quote authority boundary

- Strict cart quote request accepts buyer intent only and rejects browser-supplied price, discount, tax, total, stock, shipping amount and payment authority.
- Canonical quote composition port keeps explicit ownership boundaries for buyer principal, published item, commercial seed, inventory evidence, MOD-C quote persistence and MOD-C shipping amount.
- Trusted authenticated principal resolver uses an existing authorised `RequestContext` and active canonical MOD-C customer; MOD-H never adds `sales.quote.create`, never synthesizes a privileged actor and never creates a guest customer.
- Requested customer identity must match the canonical customer resolved by the trusted principal adapter.
- Published product/variant UUID pairs are revalidated through the existing host/channel-scoped publication composition before commercial processing.
- MOD-A commercial seed revision must match the bootstrap price-list revision before MOD-C quote persistence.
- MOD-B checkout availability is re-read across the complete sales-channel warehouse scope, aggregated with exact decimal arithmetic and represented by deterministic opaque stale evidence; no single-warehouse shortcut is used.
- Canonical MOD-C `SalesService.createQuote` bridge forwards the exact trusted `RequestContext` without synthesizing privilege.
- Canonical sales quote scope, customer, currency, line identity, quantity, price-tax snapshot identity, revision and expiry are revalidated before projection.
- Public totals are exact integer-minor projections/aggregations of canonical snapshot values; no browser arithmetic is accepted.
- A bounded no-store cart quote handler and typed client exist but remain deliberately unregistered in production routing.

### Checkout capability/revalidation boundary

- Added `storefront-checkout-capability-request.v1` for quote ID/revision, cart revision, buyer destination and opaque selected shipping/payment capability IDs only.
- The checkout request rejects browser shipping amount, payment amount, tax and total authority.
- Added `storefront-checkout-capability-envelope.v1` with versioned exact shipping options, safe payment capability references, quote expiry and explicit authority revisions: `quoteAuthorityToken`, country policy, shipping and payment revisions.
- Capability state is explicit: `ready`, `changed` or `unavailable`; stale choices are never silently replaced.
- Host/bootstrap context, quote identity/revision, selected option eligibility and quote/shipping/payment expiry are reconciled before a response can be treated as ready.
- Added a bounded no-store checkout capability API handler and a typed HTTPS client. The handler is intentionally not registered in the public router.

### Checkout submission preflight and idempotency

- Added strict `storefront-checkout-submission-intent.v1` for quote/cart revisions, stable idempotency key, destination, `quoteAuthorityToken`, country/shipping/payment authority revisions, exact selected capability versions and optional opaque payment-method reference.
- Browser totals, tax, payment amount, provider-account ID, warehouse ID and unsupported commercial/infrastructure fields are rejected.
- Pre-side-effect submission guard requires current capability state `ready` and exact-matches quote ID/revision, quote authority token, country-policy revision, shipping/payment authority revisions and selected option versions.
- Quote/shipping/payment expiry is checked before any MOD-C/MOD-E side-effect layer can run.
- Added deterministic SHA-256 submission request hashing over the normalized strict intent. Property/key order does not change the hash; quote/shipping/payment authority evidence changes do.
- No order creation/conversion, inventory reservation, payment intent or accounting side effect is wired from MOD-H yet.

### Buyer recovery UX

- Added a typed recovery model instead of parsing error strings. It maps corrupt-cart recovery, quote expiry/change/unavailability, price-tax change, inventory change, country-policy change, shipping change, payment change and checkout unavailability into explicit blocking buyer actions.
- `canSubmit` is false unless both quote and checkout capabilities are `ready` and no recovery item exists.
- Added an accessible server-rendered `CheckoutRecovery.astro` component with English, Bengali, Arabic RTL and Japanese/CJK copy. It performs no commerce mutation and only renders safe recovery actions.
- Added a dedicated evidence-only recovery route with synthetic data; no production/customer data is used.
- Added a bounded process-group evidence runner so the Astro dev-process tree cannot hang CI after evidence completion.
- Recovery browser gate validates WCAG axe results, locale/direction, exact recovery reason sequence, safe action targets, viewport/clipping, upstream-brand leakage, skip-link keyboard behavior, reduced motion and 200% text.
- Bengali recovery evidence runs under bounded 3G; Arabic runs RTL; Japanese covers CJK presentation.

## Verified evidence

Exact code head `db135e7c72ac418ee1158ab10cb3665ee88ab943` passed Storefront CI run `30710984952`:

- root format, lint, module boundaries, TypeScript, database validation, build, complete repository test gate and security gates: **passed**;
- PostgreSQL 17 storefront rehearsal: **passed**;
- existing buyer browser/accessibility evidence: **5 / 5 scenarios passed**;
- new checkout recovery browser/accessibility evidence: **4 / 4 scenarios passed**, **0 axe violations**;
- admin browser/accessibility evidence: **4 / 4 scenarios passed**;
- Astro check during browser evidence: **25 files, 0 errors, 0 warnings, 0 hints**;
- Cloudflare preview deploy, runtime metrics and cleanup: **passed**;
- non-destructive Neon recovery: **passed directly on the exact head**.

The earlier fully counted H4 baseline at `400cfb00e78db334c903a298bc560f05c31ee526` passed **549 / 549** tests. The exact head above contains additional submit/idempotency/cart-state/recovery suites and its full root test gate passed; no new aggregate numeric count is inferred here without a directly surfaced total.

## Deliberately not exposed yet

The cart quote handler, checkout capability handler and any checkout submission mutation route are **not registered in the production public API**. Enabling them before the owning-module capabilities below are concrete would create an unsafe commerce path.

## Remaining owning-module capability gaps

1. **Lossless MOD-A price/tax into MOD-C quote persistence — Issue #97.** Current MOD-C line input still exposes a legacy single `taxRateBasisPoints` seed while MOD-A supports multi-component, compound, inclusive/exclusive, exempt and promotion-aware tax calculation. MOD-H will not flatten that model or promote displayed catalog price into checkout authority. A MOD-C-owned additive path must consume full canonical calculation context or already-calculated immutable `PriceTaxSnapshotV1` values with strict validation.
2. **MOD-C pre-order shipping capability/rate — Issue #97.** Current fulfillment owns post-order fulfillment plans but does not expose a canonical pre-order shipping-option/rate quote. MOD-H will not invent free/zero shipping.
3. **MOD-E side-effect-free public payment capability projection — Issue #98.** MOD-E owns provider capability and payment intent/state, including `unknown` reconciliation, but does not expose a pre-order public eligibility projection. MOD-H will not enumerate payment methods from browser/provider configuration or create an intent merely to discover capability.
4. **Typed MOD-F checkout country/address/contact policy — Issue #100.** Existing localization/country configuration is generic. Checkout must consume a canonical typed policy for effective country/address/contact requirements rather than interpret arbitrary capability keys inside MOD-H.
5. **Guest checkout policy, if required.** Authenticated canonical customer resolution is implemented. Anonymous checkout remains unavailable unless an owning-module policy defines an approved guest/customer principal without MOD-H manufacturing sales privilege.

## Integration observation

The H3 public catalog projection reads published MOD-A price and MOD-B availability for display only. H4 never promotes those displayed values into checkout authority. Quote and checkout flows re-resolve canonical dependencies and project only the resulting MOD-A/MOD-B/MOD-C/MOD-E/MOD-F evidence back to the buyer.

## Current safety posture

Until Issues #97, #98 and #100 have concrete owning-module adapters, production behavior remains fail closed: no public quote/checkout mutation endpoint is activated, no synthetic privileged sales actor or guest customer exists, no order/payment side effects are wired from MOD-H, and no browser price/tax/stock/shipping/payment fact can become canonical commerce state.
