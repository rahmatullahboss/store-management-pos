# MOD-H H7 Hardening Progress

Status: **active**

Completed slices: `H7-CACHE-ISOLATION-01`, `H7-ABUSE-CONTRACT-02`

Latest fully verified implementation head: `967a66e58ae89c408a5b3e75afc3a95a2d13fad4`

Storefront CI: `30724380521`

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

Provider-independent hardening now exists in `modules/storefront/src/abuse-control.ts`:

- route policy classes are explicit: `public_read`, `public_search`, `public_media`, `private_read`, `checkout_quote`, `checkout_submit`, `admin_mutation`;
- public/search/media/private reads declare `fail_open_observe` for limiter-provider unavailability;
- checkout quote/submit and admin mutation policies declare `fail_closed` for limiter-provider unavailability;
- anonymous requests require a `trusted_edge` opaque abuse key;
- authenticated private/sensitive requests require an `authenticated_session` opaque abuse key;
- opaque keys are bounded base64url-like tokens; raw IP strings and arbitrary forwarding-header key sources are rejected;
- spoofed `X-Forwarded-For`, `CF-Connecting-IP` and `True-Client-IP` request headers are not used to select the abuse key;
- provider decisions are strict `allow | deny | unavailable` contracts with bounded safe reason categories, policy revision and optional Retry-After seconds;
- inconsistent provider decisions fail contract validation;
- deny returns HTTP 429 with `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and bounded `Retry-After` when supplied;
- policy/provider revision and opaque abuse-key details are not reflected in 429 responses;
- fail-closed provider unavailability returns HTTP 503 `STOREFRONT_ABUSE_CONTROL_UNAVAILABLE`;
- fail-open read paths return no synthetic allow/limit result and remain observable by the future provider integration.

Unit coverage in `tests/unit/storefront-abuse-control.test.mjs` proves route separation, trusted-key source enforcement, spoofed forwarding-header resistance, fail-open/fail-closed semantics, 429 response safety and strict provider-output validation.

Runtime counting/enforcement is intentionally not wired yet. It remains blocked on Issue #107 because the production state must be distributed/provider-backed across Worker isolates/regions.

## Latest verified evidence

Exact head `967a66e58ae89c408a5b3e75afc3a95a2d13fad4`, Storefront CI `30724380521`:

- root format, lint, boundaries, TypeScript, database validation, complete test gate and security/dependency gates: **passed**;
- Astro Cloudflare build: **passed**;
- PostgreSQL 17 storefront rehearsal: **passed**;
- buyer/recovery/order-tracking/admin browser and accessibility evidence: **passed**;
- Cloudflare preview deploy, runtime metrics and cleanup: **passed**;
- non-destructive Neon recovery: **passed**.

## Remaining H7 work

1. integrate the distributed runtime abuse provider once Issue #107 is available;
2. add storefront-specific operational observability/runbook evidence for cache, public host/domain failures, private route safety and abuse-control decisions without sensitive-key leakage;
3. consolidate final migration/recovery, Cloudflare evidence, known blockers and serial integration instructions into the MOD-H handoff;
4. keep provider/domain, customer/order and H4 commerce mutation routes fail closed until their owning-module blockers are resolved.

## Current blockers carried into hardening

- #97 — lossless MOD-A price/tax + MOD-C pre-order shipping;
- #98 — MOD-E public payment capability;
- #100 — MOD-F typed checkout country/address/contact policy;
- #101 — trusted customer binding + storefront-scoped MOD-C order reads;
- #102 — buyer-safe return/support request capability;
- #104 — trusted custom-hostname verification/certificate provider lifecycle;
- #107 — distributed storefront abuse/rate-limit provider.
