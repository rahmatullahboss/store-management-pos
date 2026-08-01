# MOD-H H5 Customer Account and Order Read Progress

Status: **active, contract-first**

Current slice: `H5-ACCOUNT-01`

Latest fully verified implementation head: `d86cd8e8c55a7e51dda8099c428c2e17adc4c277`

Storefront CI: `30722815560`

## Objective

Provide buyer-owned profile and order read experiences without allowing browser-selected customer identity, cross-storefront order disclosure, public caching of private data, or leakage of operational/payment/inventory authority.

H5 is progressing only through blocker-independent read/presentation work while H4 mutation authority remains fail closed.

## Completed safely

### Private account contracts

- Added versioned `storefront-customer-account.v1` profile projection.
- Added bounded `storefront-order-history-request.v1` and versioned order history/detail contracts.
- History request contains pagination intent only; browser customer identity is not part of the request contract.
- Exact money remains currency + integer-minor string + scale; fractional/binary floating-point money is rejected.
- Private contracts use strict key allowlists and reject internal authority fields.

### Trusted account composition boundary

- Added `StorefrontAccountPrincipalV1`; the only accepted principal source is `authenticated-session`.
- MOD-H never grants `customer.profile.read` or `sales.order.read` and never derives canonical customer identity from browser input.
- Canonical customer must be active and match tenant/legal-entity scope.
- Profile projection exposes only buyer-facing display name, supported email/phone/mobile contacts, addresses, profile revision and update time.
- Tax registrations, credit profile, consent history, tags/groups, website contacts and staff/audit identities are not projected.

### Storefront-scoped order read boundary

- Added `StorefrontCustomerOrderReadPort` that requires trusted request context, canonical customer ID, storefront ID and sales-channel ID.
- Returned order records must carry explicit storefront + sales-channel ownership evidence.
- Order detail revalidates tenant, legal entity, store, customer, storefront and sales-channel identity before projection.
- Persisted price/tax snapshot item and quantity identity are revalidated before line projection.
- Buyer projection exposes exact order/line money and public statuses only.
- Warehouse IDs, reservation IDs, payment intent/provider state, R2 object keys, internal notes, salesperson/commission metadata, calculation/rule IDs and staff/audit identities are not projected.

### Private typed client

- Added credentialed GET-only customer profile, order history and order detail clients.
- Requests use `credentials: include` and `cache: no-store`.
- HTTPS is required except bounded localhost development.
- Base-path joining is safe and hostname is normalized/revalidated on responses.
- Order detail requires exact requested/returned order identity.
- 401/403 HTTP status is preserved.
- Malformed private response details are converted to generic client errors rather than exposing parser internals.

### Unregistered private API boundary

- Added private account handler for profile, history and detail, but it is deliberately **not registered** in storefront runtime routers.
- Handler requires a trusted authenticated-session principal resolver dependency.
- Browser `customerId` query/body ownership proof is rejected before principal resolution.
- Private responses use `private, no-cache, no-store, must-revalidate`, `Pragma: no-cache`, `Vary: Authorization, Cookie`, and `X-Content-Type-Options: nosniff`.
- History pagination is bounded; malformed requests are 400, authentication absence is 401, ownership/permission denial is 403, and unknown order is 404.
- Unit tests statically assert that account paths/handler remain absent from runtime router registration.

## Verified evidence

Exact head `d86cd8e8c55a7e51dda8099c428c2e17adc4c277`, Storefront CI `30722815560`:

- root format, lint, module boundaries, TypeScript, database validation, full test gate and security/dependency gates: **passed**;
- Astro Cloudflare build: **passed**;
- PostgreSQL 17 storefront rehearsal: **passed**;
- buyer/admin browser and accessibility baseline: **passed**;
- Cloudflare preview deploy, runtime metrics and cleanup: **passed**;
- non-destructive Neon recovery: **passed**.

## Deliberately not exposed yet

No private customer account/order API route is registered in production. No storefront account page is connected to live private data yet.

Route activation requires the owning-module capabilities tracked in Issue #101:

1. trusted authenticated session → canonical active customer binding for the current tenant/legal-entity/storefront scope;
2. MOD-C customer + storefront + sales-channel scoped bounded order history/detail capability with canonical channel-origin evidence.

MOD-H will not substitute browser `customerId`, actor ID, `externalSource`, repository scans or tenant-wide customer matches for those capabilities.

## Related blockers

- Issue #97 — lossless MOD-A price/tax into MOD-C quote persistence and MOD-C pre-order shipping capability.
- Issue #98 — MOD-E side-effect-free public payment capability projection.
- Issue #100 — typed MOD-F checkout country/address/contact policy.
- Issue #101 — H5 trusted customer binding and storefront-scoped MOD-C order reads.

## Next safe H5 slice

`H5-TRACKING-02`: build a read-only order-status/tracking view model and accessible multilingual evidence UI from `StorefrontOrderDetailV1` only. Do not invent carrier events, provider tracking URLs, refund/return mutations or fulfillment authority that is not present in the canonical buyer-safe contract.
