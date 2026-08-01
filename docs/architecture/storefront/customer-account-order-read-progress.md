# MOD-H H5 Customer Account and Order Read Progress

Status: **active, contract-first**

Completed slices: `H5-ACCOUNT-01`, `H5-TRACKING-02`

Latest fully verified implementation head: `5d7e8bfb4958d7ab53d2abb50192cefde6a8aba2`

Storefront CI: `30723253734`

## Objective

Provide buyer-owned profile, order history/detail and status presentation without allowing browser-selected customer identity, cross-storefront order disclosure, public caching of private data, or leakage/invention of operational, payment, inventory, carrier or return authority.

H5 is progressing only through blocker-independent read/presentation work while H4 mutation authority remains fail closed.

## H5-ACCOUNT-01 — complete and verified

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

H5-ACCOUNT-01 was fully verified at exact head `d86cd8e8c55a7e51dda8099c428c2e17adc4c277`, Storefront CI `30722815560`.

## H5-TRACKING-02 — complete and verified

- Added a read-only `StorefrontOrderTrackingViewV1` derived solely from strict `StorefrontOrderDetailV1` buyer-safe facts.
- Presentation state is derived only from canonical order/payment/fulfillment/return statuses: `pending`, `in_progress`, `attention`, `complete`, `cancelled`, `returned`, or `refunded`.
- No synthetic shipment timeline, carrier event, tracking URL, estimated delivery date, refund/return mutation or fulfillment authority is invented.
- Exact money and quantity display is derived from integer strings without converting financial values through binary floating point, including values beyond JavaScript safe-integer range.
- Added a server-rendered accessible order-status component with fully externalized English, Bengali, Arabic/RTL and Japanese/CJK state/status/method labels.
- Added a synthetic evidence-only route gated behind `STOREFRONT_EVIDENCE_MODE`; it contains no customer or production data.
- Added a process-group-bounded browser evidence runner covering English mobile, Bengali bounded-3G, Arabic RTL and Japanese/CJK.
- Tracking evidence checks Axe WCAG 2 A/AA/2.1 AA, locale/direction, exact state translation, exact large-money rendering, no raw internal enum leakage, no internal authority/provider/storage/staff leakage, no upstream branding, clipping/overflow, keyboard skip-link, reduced motion and 200% text scaling.
- Storefront CI now treats order-tracking browser evidence as an additive buyer gate without weakening existing catalog/recovery/admin evidence.

## Latest verified evidence

Exact head `5d7e8bfb4958d7ab53d2abb50192cefde6a8aba2`, Storefront CI `30723253734`:

- root format, lint, module boundaries, TypeScript, database validation, full test gate and security/dependency gates: **passed**;
- Astro Cloudflare build/check: **27 files, 0 errors, 0 warnings, 0 hints**;
- PostgreSQL 17 storefront rehearsal: **passed**;
- existing buyer browser/accessibility evidence: **5/5** across 4 locales with Bengali low-bandwidth coverage;
- checkout recovery browser/accessibility evidence: **4/4**;
- order tracking browser/accessibility evidence: **4/4** across English, Bengali bounded-3G, Arabic RTL and Japanese/CJK; the runner requires zero Axe violations for a passing scenario;
- admin browser/accessibility evidence: **4/4**;
- Cloudflare preview deploy, runtime metrics and cleanup: **passed**;
- non-destructive Neon recovery: **passed**.

The Storefront evidence artifact for this run contains the order-tracking context, screenshots and machine-readable report in `docs/architecture/storefront/order-tracking-design-evidence/`.

## Deliberately not exposed yet

No private customer account/order API route is registered in production. No live storefront account/order tracking page is connected to private canonical customer data yet.

Route activation requires the owning-module capabilities tracked in Issue #101:

1. trusted authenticated session → canonical active customer binding for the current tenant/legal-entity/storefront scope;
2. MOD-C customer + storefront + sales-channel scoped bounded order history/detail capability with canonical channel-origin evidence.

MOD-H will not substitute browser `customerId`, actor ID, `externalSource`, repository scans or tenant-wide customer matches for those capabilities.

## Related blockers

- Issue #97 — lossless MOD-A price/tax into MOD-C quote persistence and MOD-C pre-order shipping capability.
- Issue #98 — MOD-E side-effect-free public payment capability projection.
- Issue #100 — typed MOD-F checkout country/address/contact policy.
- Issue #101 — H5 trusted customer binding and storefront-scoped MOD-C order reads.

## Next safe H5 hardening

1. Keep 403 account-access responses generic so ownership/scope mismatch details cannot be reflected to an untrusted buyer.
2. Keep order-history pagination cursor opaque to MOD-H rather than assuming an owning-module UUID cursor format.
3. Continue to keep all live account/order routes unregistered until Issue #101 has concrete owning-module adapters and exact integration evidence.
