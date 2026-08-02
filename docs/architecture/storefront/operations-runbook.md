# Storefront Operations Runbook

Status: **H7 hardening runbook — active**

Scope: MOD-H buyer storefront, storefront admin/control-plane surfaces, Cloudflare preview/runtime evidence, Neon/PostgreSQL storefront recovery evidence and the currently fail-closed commerce/domain/private-route boundaries.

## 1. Non-negotiable safety invariants

1. PostgreSQL remains canonical; Cloudflare Cache API, KV, browser storage and Worker memory are bounded auxiliary systems only.
2. Public cache keys must remain isolated by tenant, storefront, sales channel, request hostname, canonical hostname, locale, currency, price-list revision, publication generation, build, cache family and family generation/resource.
3. Account, cart, checkout and other private/mutation routes must never enter public cache families.
4. Browser state never becomes price, tax, stock, customer, shipping, payment, order, refund, accounting or provider authority.
5. Custom-domain ownership/certificate facts may come only from the trusted provider/control-plane path. Tenant/admin bodies cannot assert `verified`, certificate `active` or provider IDs.
6. Private customer/order responses are credentialed and `no-store`; customer identity comes from a trusted authenticated-session binding, not browser `customerId`.
7. A production abuse limiter must be distributed/provider-backed. Do not replace it with a per-isolate Worker-memory counter.
8. Never force-push, reset, discard or repurpose existing work/Neon branches to recover MOD-H.

## 2. Privacy-safe operational events

Runtime emitters should use `storefront-operational-event.v1` from `modules/storefront/src/observability.ts` once connected to the shared logging/telemetry sink.

Allowed event names:

- `storefront.cache.decision`
- `storefront.public_host.resolve`
- `storefront.private_access.decision`
- `storefront.abuse_control.decision`
- `storefront.domain.lifecycle`
- `storefront.checkout.guard`

The envelope intentionally has no free-form metadata object.

### Never log in the operational envelope

- customer IDs, email addresses, phone numbers or postal addresses;
- request/custom hostname values when they can identify a customer/site;
- raw IP addresses, `X-Forwarded-For`, `CF-Connecting-IP` or abuse opaque keys;
- provider hostname IDs, provider references, challenge values/hashes or provider tokens;
- payment intent/provider IDs;
- reservation IDs, warehouse IDs or internal stock evidence;
- R2 object keys/private file paths;
- internal notes, staff IDs, commission metadata or arbitrary exception bodies;
- arbitrary user-entered search/query/body content.

Use low-cardinality safe reason categories and request/trace correlation tokens instead.

## 3. Standard verification commands

From the repository root, the normal evidence sequence is:

```text
npm run verify
npm run storefront:build
npm run storefront:design:verify
npm run storefront:db:rehearsal
npm run ci:cloudflare-preview
npm run metrics:cloudflare-runtime
npm run cleanup:cloudflare-preview
npm run ci:neon-recovery
```

CI remains the authoritative completion evidence because Cloudflare/Neon credentials and disposable resources are environment-controlled.

Do not claim a checkpoint fully green when a downstream Storefront CI lane is still queued/in-progress/cancelled. A concurrency-cancelled Neon job may be targeted-rerun; do not rerun unrelated green jobs without cause.

## 4. Public hostname/storefront unavailable

Symptoms:

- active-looking merchant configuration but public hostname returns unavailable/404;
- custom domain stopped resolving after lifecycle/certificate change;
- one hostname works while another does not.

Check in order:

1. resolved domain local status is `active`;
2. certificate status is `active`;
3. storefront and sales channel are active;
4. hostname belongs to the expected tenant/storefront/channel;
5. canonical hostname does not point to a stale/suspended/deleting/deleted domain;
6. publication/cache revisions are current;
7. no custom-domain provider mutation was attempted through the external tenant API.

Current provider boundary: Issue #104. External verification/certificate mutation deliberately returns `503 DOMAIN_PROVIDER_CONTROL_UNAVAILABLE` until the trusted MOD-G/shared provider adapter exists.

Do not manually write provider IDs/certificate state into PostgreSQL to bypass this boundary.

## 5. Suspected cross-tenant/hostname cache contamination

Treat any cross-tenant or cross-host content observation as high severity.

Immediate response:

1. stop relying on the suspected cache entry; preserve request/trace IDs and safe cache-family dimensions;
2. verify the effective cache scope includes tenant/storefront/channel/request-host/canonical-host/localisation/commercial revisions;
3. verify private paths are classified with no public cache family;
4. reproduce with two tenants and two hostnames using the H7 cache-isolation unit evidence;
5. invalidate/bump the affected cache generation through the owned mechanism; do not mutate canonical publication state merely to clear cache;
6. rerun Storefront CI and Cloudflare preview/runtime/cleanup evidence.

Never include cached response bodies containing customer/private data in logs or issue comments.

## 6. Private account/order access anomaly

Symptoms:

- unexpected 401/403/404;
- suspected cross-customer or cross-storefront order visibility;
- private response appears cacheable.

Required checks:

1. private account routes must remain unregistered until Issue #101 is resolved;
2. trusted session principal must already contain required permissions;
3. canonical customer must be active and tenant/legal-entity scoped;
4. order ownership must match tenant, legal entity, store, customer, storefront and sales channel;
5. response headers must remain private/no-store with `Vary: Authorization, Cookie`;
6. 403 response must remain generic `ACCOUNT_ACCESS_DENIED` without scope detail.

If cross-customer visibility is suspected, fail closed and disable the private route rather than widening repository queries.

## 7. Checkout/commerce guard unavailable

Public quote/capability/submit mutation routes are currently unregistered because Issues #97, #98 and #100 remain unresolved.

Do not activate them by substituting:

- displayed catalog price for checkout authority;
- flattened tax rate for compound/inclusive/exempt tax;
- one warehouse for multi-warehouse stock evidence;
- zero/free shipping;
- browser payment/provider configuration;
- synthetic guest customer/privilege.

The checkout guard may return changed/unavailable/recovery state; never silently fallback to another shipping/payment choice or stale quote.

## 8. Abuse-control provider unavailable

Current provider boundary: Issue #107.

The provider-independent contract defines:

- public read/search/media/private read: `fail_open_observe`;
- checkout quote/submit/admin mutation: `fail_closed`.

When the provider is integrated:

- denial returns 429, optional bounded `Retry-After`, `no-store`;
- fail-closed provider unavailability returns 503 `STOREFRONT_ABUSE_CONTROL_UNAVAILABLE`;
- do not expose policy revision, raw abuse keys or provider diagnostic detail to the buyer.

Do not introduce emergency in-memory counters as a production substitute. If provider enforcement is unavailable for a sensitive route, preserve the declared fail behavior.

## 9. Domain provider/control-plane outage

Until Issue #104 is complete, provider observation mutation remains fail closed by design.

After provider integration, an ambiguous network/provider result must remain ambiguous. Do not assume:

- hostname creation succeeded;
- verification failed;
- certificate is active;
- provider deletion completed.

Reconcile against the trusted provider before advancing irreversible local lifecycle state.

## 10. Cloudflare preview/runtime anomaly

Storefront CI performs:

1. build;
2. preview deploy;
3. runtime metric verification;
4. cleanup in an `always()` path;
5. evidence upload.

The current runtime metric gate requires successful Cloudflare GraphQL sampling for the preview script window and zero runtime errors for sampled preview requests.

If preview deploy succeeds but later evidence fails:

- inspect the runtime evidence artifact;
- run cleanup even when metric verification failed;
- do not leave disposable preview Workers as a substitute for a passing deployment gate;
- rerun only after source/configuration cause is understood.

## 11. PostgreSQL/Neon recovery anomaly

Storefront PostgreSQL 17 rehearsal and non-destructive Neon recovery are separate gates.

If PostgreSQL rehearsal fails:

- treat it as migration/command evidence failure and fix the source/schema rehearsal;
- do not hide it by relying only on a previous Neon pass.

If Neon recovery is concurrency-cancelled with no executed steps:

- confirm other lanes are source-green;
- targeted-rerun the cancelled Neon job;
- require the exact-head recovery drill to pass before claiming the checkpoint fully green.

Never delete/reset another module’s Neon branch to create quota for MOD-H.

## 12. Buyer return/support requests

Current blocker: Issue #102.

Do not expose privileged MOD-C credit-note/order-cancel/internal communication operations as buyer return actions. The storefront may show current buyer-safe order status only.

Return eligibility, quantities, approval state and refund effects must come from the owning customer-safe return capability when implemented.

## 13. Current cross-module blockers

- #97 — lossless MOD-A price/tax + MOD-C pre-order shipping;
- #98 — MOD-E public payment capability;
- #100 — MOD-F typed checkout country/address/contact policy;
- #101 — trusted customer binding + storefront-scoped MOD-C order reads;
- #102 — buyer-safe return/support request;
- #104 — trusted custom-hostname verification/certificate provider lifecycle;
- #107 — distributed storefront abuse/rate-limit provider.

These blockers are not justification to create parallel authority in MOD-H.

## 14. Release/handoff rule

PR #48 remains draft until the workpack completion gates are satisfied. Final handoff must name exact verified heads/runs, migrations, provider/cross-module blockers, known limitations and serial integration instructions.

Do not mark MOD-H complete merely because H1–H3 and blocker-independent H4–H7 slices are green. Live checkout, private customer/order routes and trusted custom-domain provider lifecycle must have their owning-module integrations and exact evidence first.
