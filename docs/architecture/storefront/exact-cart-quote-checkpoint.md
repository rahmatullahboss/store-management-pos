# MOD-H H4 Exact Cart Quote Contract Checkpoint

Status: **complete**

Checkpoint: `H4-QUOTE-01`

Verified source head: `677d3364b6959289a358a47a0848aeb530d5bb51`

Storefront CI run: `30694549781`

## Delivered

- Versioned `storefront-cart-quote-request.v1` buyer-intent contract.
- Versioned `storefront-cart-quote-envelope.v1` exact server-quote contract.
- Browser request fields are strict allowlists; browser-supplied price, discount, tax, total, availability, stock or payment facts are rejected before transport.
- Product/variant identity, exact quantity, cart revision, idempotency key, bounded coupon codes, destination country, customer ID and shipping-choice intent are validated.
- Exact integer-minor quote values are parsed without floating-point authority.
- Quote authority evidence requires the resolved price-list revision, publication generation, one MOD-A calculation ID and one MOD-B inventory version per quoted line.
- Quote recovery state is explicit as `ready`, `changed` or `unavailable` and must agree with referenced quote-line markers.
- Storefront quote boundary resolves active host context before authority invocation and rejects host/scope, cart-revision, line-identity, quantity, quote-revision or expiry mismatch.
- Typed public client sends only the strict buyer-intent payload, uses `Idempotency-Key`, `no-store`, bounded timeout and safe trailing-slash URL joining.
- Server conflict status is preserved for higher-level recovery handling.

## Exact-head verification

| Gate | Evidence | Result |
|---|---|---|
| Storefront verify | job `91355437867` | Pass |
| PostgreSQL 17 rehearsal | job `91355582944` | Pass |
| Buyer/browser evidence | job `91355582918` | Pass |
| Cloudflare preview/runtime/cleanup | job `91355582915` | Pass |
| Non-destructive Neon recovery | job `91355583009` | Pass |

The first Neon recovery job in the same workflow attempt was cancelled before source execution. Only that cancelled evidence job was rerun; the rerun passed. No existing Neon branch was deleted, reset or repurposed.

## Authority boundary

This checkpoint deliberately defines only the public boundary. It does **not** make MOD-H a pricing, tax, inventory, sales, payment or accounting authority.

- MOD-A remains authoritative for product pricing, promotions, discounts and tax calculation.
- MOD-B remains authoritative for current stock and reservation evidence.
- MOD-C remains authoritative for sales quote/order persistence and fulfillment capability.
- MOD-E remains authoritative for payment and accounting effects.
- MOD-F remains authoritative for country, address/contact and jurisdictional behavior.
- MOD-H owns buyer cart intent, public validation, host-context reconciliation and recovery presentation only.

## Security invariant

A browser cannot make an authoritative commercial assertion merely by adding fields to the cart payload, and a malformed, stale, expired or scope-mismatched server quote cannot pass the MOD-H quote boundary.

## Next slice

`H4-QUOTE-02` wires an authority adapter behind this boundary. The adapter must resolve a trusted customer/guest principal, revalidate published product/variant intent, obtain MOD-A price/tax and MOD-B inventory evidence, and persist the quote through MOD-C. It must not create a synthetic privileged sales actor or bypass MOD-C permission checks.
