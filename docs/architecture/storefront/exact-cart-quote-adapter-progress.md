# MOD-H H4 Canonical Quote Adapter Progress

Status: **active**

Slice: `H4-QUOTE-02`

## Completed in this slice

- Canonical quote composition port with explicit ownership boundaries for buyer principal, published item, commercial seed, inventory evidence, MOD-C quote persistence and MOD-C shipping amount.
- Trusted principal validation requires tenant/locale/legal-entity/store scope plus existing `sales.quote.create`; MOD-H never adds that permission.
- Requested customer identity must match the canonical customer resolved by the trusted principal adapter.
- Published product/variant UUID pairs are revalidated through the existing host/channel-scoped publication composition before commercial processing.
- MOD-A commercial seed revision must match the bootstrap price-list revision before MOD-C quote persistence.
- MOD-B inventory evidence is carried into the public quote and insufficient evidence produces an explicit unavailable draft quote.
- Canonical MOD-C `SalesService.createQuote` bridge forwards the exact trusted `RequestContext` without synthesizing privilege.
- Canonical sales quote scope, customer, currency, line identity, quantity, price-tax snapshot identity, revision and expiry are revalidated before projection.
- Shipping amount is an injected MOD-C-owned authority and must match storefront currency/scale.
- Public totals are exact integer-minor projections/aggregations of canonical snapshot values; no browser arithmetic is accepted.

## Deliberately not exposed yet

`POST /v1/storefront/cart/quote` is **not** registered in the public API yet. The typed client and public boundary exist, but enabling the route before the following dependencies are concrete would create an unsafe anonymous commerce path.

### Required before route activation

1. **Trusted buyer principal resolver** — must resolve an authenticated customer or an approved guest/customer principal from canonical customer/country policy. It must return an already-authorised sales `RequestContext`; MOD-H must not manufacture `sales.quote.create`.
2. **Lossless MOD-A price/tax adapter** — current MOD-C line input includes a legacy single `taxRateBasisPoints` seed while MOD-A supports multi-component, compound, inclusive/exclusive and exempt tax calculations. The storefront must not flatten that richer model into a guessed single rate. Final `PriceTaxSnapshotV1` must be produced by a MOD-A-backed MOD-C `PriceTaxPort`.
3. **MOD-B checkout availability adapter** — must re-read current sellable availability and produce stale-detection evidence for the complete sales-channel inventory scope. Multi-warehouse evidence must not be reduced to an unsafe single-warehouse assumption.
4. **MOD-C shipping amount/capability adapter** — shipping choice and amount must be canonical; the storefront must not invent free or zero shipping as a fallback.

## Integration observation

The existing H3 public catalog projection already reads published MOD-A price and MOD-B availability for display. H4 does not promote those displayed values into checkout authority. Quote creation re-resolves canonical dependencies and then projects the resulting MOD-C/MOD-A/MOD-B evidence back to the buyer.

## Current safety posture

Until all required adapters are concrete, production behavior remains fail closed: no anonymous public quote endpoint is activated, no synthetic privileged sales actor exists, and no price/tax/stock/payment fact supplied by the browser can become canonical commerce state.
