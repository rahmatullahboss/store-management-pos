# MOD-H H4 Canonical Quote and Checkout Authority Progress

Status: **active**

Current slices: `H4-QUOTE-02` + contract-first `H4-CHECKOUT-03`

Verified code head: `400cfb00e78db334c903a298bc560f05c31ee526`

## Completed safely

### Quote authority boundary

- Strict cart quote request accepts buyer intent only and rejects browser-supplied price, discount, tax, total, stock, shipping amount and payment authority.
- Canonical quote composition port keeps explicit ownership boundaries for buyer principal, published item, commercial seed, inventory evidence, MOD-C quote persistence and MOD-C shipping amount.
- Trusted authenticated principal resolver uses an existing authorised `RequestContext` and active canonical MOD-C customer; MOD-H never adds `sales.quote.create`, never synthesizes a privileged actor and never creates a guest customer.
- Requested customer identity must match the canonical customer resolved by the trusted principal adapter.
- Published product/variant UUID pairs are revalidated through the existing host/channel-scoped publication composition before commercial processing.
- MOD-A commercial seed revision must match the bootstrap price-list revision before MOD-C quote persistence.
- MOD-B checkout availability is re-read across the complete sales-channel warehouse scope, aggregated with exact decimal arithmetic and represented by deterministic opaque stale-evidence; no single-warehouse shortcut is used.
- Canonical MOD-C `SalesService.createQuote` bridge forwards the exact trusted `RequestContext` without synthesizing privilege.
- Canonical sales quote scope, customer, currency, line identity, quantity, price-tax snapshot identity, revision and expiry are revalidated before projection.
- Public totals are exact integer-minor projections/aggregations of canonical snapshot values; no browser arithmetic is accepted.
- A bounded no-store cart quote handler and typed client exist but remain deliberately unregistered in production routing.

### Checkout capability/revalidation boundary

- Added `storefront-checkout-capability-request.v1` for quote ID/revision, cart revision, buyer destination and opaque selected shipping/payment capability IDs only.
- The checkout request rejects browser shipping amount, payment amount, tax and total authority.
- Added `storefront-checkout-capability-envelope.v1` with versioned exact shipping options, safe payment capability references, quote expiry and explicit authority revisions.
- Capability state is explicit: `ready`, `changed` or `unavailable`; stale choices are never silently replaced.
- Host/bootstrap context, quote identity/revision, selected option eligibility and quote/shipping/payment expiry are reconciled before a response can be treated as ready.
- Added a bounded no-store checkout capability API handler and a typed HTTPS client. The handler is intentionally not registered in the public router.

## Verified evidence

Exact code head `400cfb00e78db334c903a298bc560f05c31ee526` passed Storefront CI run `30709204562`:

- root format, lint, module boundaries, TypeScript, database validation, build and security gates: **passed**;
- repository tests: **549 / 549 passed**;
- Astro storefront check: **23 files, 0 errors, 0 warnings, 0 hints**;
- PostgreSQL 17 storefront rehearsal: **passed**;
- buyer/admin browser and accessibility evidence: **passed**;
- Cloudflare preview deploy, runtime metrics and cleanup: **passed**;
- non-destructive Neon recovery: **passed**;
- dependency audit: **0 vulnerabilities**.

## Deliberately not exposed yet

`POST /v1/storefront/cart/quote` and the new checkout capability handler are **not registered in the production public API**. Enabling them before the owning-module capabilities below are concrete would create an unsafe commerce path.

## Remaining owning-module capability gaps

1. **Lossless MOD-A price/tax into MOD-C quote persistence — Issue #97.** Current MOD-C line input still exposes a legacy single `taxRateBasisPoints` seed while MOD-A supports multi-component, compound, inclusive/exclusive, exempt and promotion-aware tax calculation. MOD-H will not flatten that model or promote displayed catalog price into checkout authority. A MOD-C-owned additive path must consume full canonical calculation context or already-calculated immutable `PriceTaxSnapshotV1` values with strict validation.
2. **MOD-C pre-order shipping capability/rate — Issue #97.** Current fulfillment owns post-order fulfillment plans but does not expose a canonical pre-order shipping-option/rate quote. MOD-H will not invent free/zero shipping.
3. **MOD-E side-effect-free public payment capability projection — Issue #98.** MOD-E owns provider capability and payment intent/state, including `unknown` reconciliation, but does not expose a pre-order public eligibility projection. MOD-H will not enumerate payment methods from browser/provider configuration or create an intent merely to discover capability.
4. **Typed MOD-F checkout country/address/contact policy.** Existing localization/country configuration is generic; before submit activation the checkout must consume a canonical typed policy for effective country/address/contact requirements rather than infer mandatory fields in MOD-H.
5. **Guest checkout policy, if required.** Authenticated canonical customer resolution is implemented. Anonymous checkout remains unavailable unless an owning-module policy defines an approved guest/customer principal without MOD-H manufacturing sales privilege.

## Integration observation

The H3 public catalog projection reads published MOD-A price and MOD-B availability for display only. H4 never promotes those displayed values into checkout authority. Quote and checkout flows re-resolve canonical dependencies and project only the resulting MOD-A/MOD-B/MOD-C/MOD-E/MOD-F evidence back to the buyer.

## Current safety posture

Until all required owning-module adapters are concrete, production behavior remains fail closed: no public quote/checkout mutation endpoint is activated, no synthetic privileged sales actor or guest customer exists, and no browser price/tax/stock/shipping/payment fact can become canonical commerce state.
