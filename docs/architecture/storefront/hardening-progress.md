# MOD-H H7 Hardening Progress

Status: **active**

Completed slices: `H7-CACHE-ISOLATION-01`, `H7-ABUSE-CONTRACT-02`, `H7-OBS-RUNBOOK-03`

Latest fully verified implementation head: `a4030ef44814b740538bb3d8a2b7a192bf44ba2a`

Storefront CI: `30724857648`

## Objective

Close the remaining storefront hardening gates without inventing runtime authority outside MOD-H. H7 covers cache isolation, abuse controls, security/observability evidence, recovery/runbooks and final handoff readiness.

## H7-CACHE-ISOLATION-01 — complete and verified

The existing public cache implementation already scopes keys by:

- tenant ID;
- storefront ID;
- sales-channel ID;
- request hostname;
- canonical hostname;
- locale;
- currency;
- price-list revision;
- publication generation;
- build ID;
- cache family;
- family generation;
- bounded resource token.

The hardening slice added deterministic acceptance evidence in `tests/unit/storefront-cache-isolation-hardening.test.mjs` without changing working cache behavior.

New evidence proves:

1. changing any authority dimension changes the public cache key;
2. two tenants and two hostnames cannot share an otherwise identical product cache key;
3. encoded cache segments prevent delimiter reshaping/collision between adjacent scope fields;
4. private/mutation-oriented buyer paths such as account, cart and checkout do not classify into public cache families;
5. evidence routes also stay outside public cache families;
6. unsafe scope tokens and path-like resources fail closed instead of being normalized into another cache key.

H7-CACHE-ISOLATION-01 was fully verified at exact head `0f4c14bfddad9e69ac1b51976f6a6fe262c9ae43`, Storefront CI `30724190935`.

## H7-ABUSE-CONTRACT-02 — complete and verified

No storefront-specific production distributed limiter was found. MOD-H deliberately did **not** add a Worker-isolate in-memory counter and call it production abuse protection.

Issue #107 tracks the shared/runtime distributed rate-limit capability.

Provider-independent hardening exists in `modules/storefront/src/abuse-control.ts`:

- explicit route policy classes: `public_read`, `public_search`, `public_media`, `private_read`, `checkout_quote`, `checkout_submit`, `admin_mutation`;
- public/search/media/private reads declare `fail_open_observe` for limiter-provider unavailability;
- checkout quote/submit and admin mutation policies declare `fail_closed` for limiter-provider unavailability;
- anonymous requests require a `trusted_edge` opaque abuse key;
- authenticated private/sensitive requests require an `authenticated_session` opaque abuse key;
- raw IP strings and arbitrary forwarding-header key sources are rejected;
- spoofed `X-Forwarded-For`, `CF-Connecting-IP` and `True-Client-IP` headers cannot select the abuse key;
- provider decisions are strict `allow | deny | unavailable` contracts;
- deny returns HTTP 429 with no-store/nosniff and bounded Retry-After when supplied;
- policy/provider revision and opaque abuse-key details are not reflected in buyer responses;
- fail-closed provider unavailability returns HTTP 503 `STOREFRONT_ABUSE_CONTROL_UNAVAILABLE`.

Runtime counting/enforcement remains intentionally unwired until Issue #107 supplies distributed/provider-backed state across Worker isolates/regions.

H7-ABUSE-CONTRACT-02 was fully verified at exact head `967a66e58ae89c408a5b3e75afc3a95a2d13fad4`, Storefront CI `30724380521`.

## H7-OBS-RUNBOOK-03 — complete and verified

Added `storefront-operational-event.v1` in `modules/storefront/src/observability.ts` as a strict, privacy-safe operational event envelope.

The event taxonomy is bounded to:

- `storefront.cache.decision`;
- `storefront.public_host.resolve`;
- `storefront.private_access.decision`;
- `storefront.abuse_control.decision`;
- `storefront.domain.lifecycle`;
- `storefront.checkout.guard`.

The envelope supports only bounded request/trace correlation, safe tenant/storefront/channel identifiers and fixed low-cardinality cache/abuse/domain dimensions. It intentionally has no free-form metadata object.

Strict tests prove the envelope rejects:

- customer IDs and contact details;
- request/custom hostnames;
- raw IP/forwarding-header identity and opaque abuse keys;
- provider hostname/reference/challenge data;
- payment intent/provider IDs;
- warehouse/reservation authority;
- R2 object keys/private storage paths;
- arbitrary staff/internal/free-form metadata;
- arbitrary high-cardinality event/cache/policy labels.

`docs/architecture/storefront/operations-runbook.md` now defines incident handling for:

- public-host/domain resolution failures;
- cross-tenant/hostname cache contamination;
- private account/order access anomalies;
- checkout/commerce guard unavailability;
- abuse-control provider failure;
- domain provider ambiguity/outage;
- Cloudflare preview/runtime anomalies and cleanup;
- PostgreSQL and non-destructive Neon recovery;
- buyer return/support boundaries.

The runbook explicitly forbids bypassing fail-closed authority, manually manufacturing provider state, widening repository ownership queries, or substituting Worker-memory rate limiting for distributed enforcement.

Issue #108 tracks the remaining shared telemetry-sink integration. MOD-H does not create an ad-hoc logger or allow a future sink to widen the validated envelope with request/body/exception metadata.

## Latest verified evidence

Exact head `a4030ef44814b740538bb3d8a2b7a192bf44ba2a`, Storefront CI `30724857648`:

- verify job `91434520353`: format, lint, module boundaries, TypeScript, database validation, complete tests, Astro build and security/dependency gates — **passed**;
- PostgreSQL 17 rehearsal job `91434580011` — **passed**;
- buyer/admin browser and accessibility job `91434579986` — **passed**;
- Cloudflare preview deploy/runtime metrics/cleanup job `91434579971` — **passed**;
- non-destructive Neon recovery job `91434580104` — **passed**.

The same exact head also passed Storefront H1 Validation, Storefront Lockfile, Foundation Design CI and Foundation CI.

## Remaining H7 work

1. integrate the distributed runtime abuse provider once Issue #107 is available;
2. connect the validated operational envelope to the approved shared telemetry sink once Issue #108 is resolved;
3. keep final hardening/handoff documentation current while cross-module H4–H6 blockers are resolved;
4. run fresh exact-head migration/recovery/Cloudflare/browser evidence after the final owning-module integrations;
5. do not mark MOD-H complete while checkout, private customer/order or trusted provider lifecycle remains fail closed.

## Current blockers carried into hardening

- #97 — lossless MOD-A price/tax + MOD-C pre-order shipping;
- #98 — MOD-E public payment capability;
- #100 — MOD-F typed checkout country/address/contact policy;
- #101 — trusted customer binding + storefront-scoped MOD-C order reads;
- #102 — buyer-safe return/support request capability;
- #104 — trusted custom-hostname verification/certificate provider lifecycle;
- #107 — distributed storefront abuse/rate-limit provider;
- #108 — approved shared operational telemetry sink preserving the strict storefront envelope.
