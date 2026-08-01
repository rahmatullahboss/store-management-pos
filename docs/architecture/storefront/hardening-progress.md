# MOD-H H7 Hardening Progress

Status: **active**

Completed slice: `H7-CACHE-ISOLATION-01`

Latest fully verified implementation head: `0f4c14bfddad9e69ac1b51976f6a6fe262c9ae43`

Storefront CI: `30724190935`

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

This supplements the earlier media/cache tests and makes the H7 multi-tenant cache-isolation acceptance criterion explicit.

## Verified evidence

Exact head `0f4c14bfddad9e69ac1b51976f6a6fe262c9ae43`, Storefront CI `30724190935`:

- root format, lint, boundaries, TypeScript, database validation, complete test gate and security/dependency gates: **passed**;
- Astro Cloudflare build: **passed**;
- PostgreSQL 17 storefront rehearsal: **passed**;
- buyer/recovery/order-tracking/admin browser and accessibility evidence: **passed**;
- Cloudflare preview deploy, runtime metrics and cleanup: **passed**;
- non-destructive Neon recovery: **passed**.

## Abuse/rate-limit gap

No storefront-specific production distributed limiter was found. MOD-H will not add a Worker-isolate in-memory counter and call it production abuse protection.

Issue #107 tracks the shared/runtime distributed rate-limit capability. It must support separate public-read/search/private/checkout/admin policy classes, trusted edge-normalized opaque abuse keys, privacy-safe observability, 429 + bounded Retry-After, explicit unavailable behavior and cross-isolate/provider-backed state.

## Next safe slice

`H7-ABUSE-CONTRACT-02`: add provider-independent route classification, strict trusted abuse-key/decision contracts and safe 429 response semantics. Do not wire a fake local counter. Runtime enforcement remains blocked on Issue #107.
