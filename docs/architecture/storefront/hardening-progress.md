# MOD-H H7 Hardening Progress

Status: **active with external runtime blockers**

Completed slices: `H7-CACHE-ISOLATION-01`, `H7-ABUSE-CONTRACT-02`, `H7-OBS-RUNBOOK-03`

Latest fully verified implementation/documentation head: `a4030ef44814b740538bb3d8a2b7a192bf44ba2a`

Latest fully verified Storefront CI: `30724857648`

## Objective

Close storefront hardening gates without inventing runtime authority outside MOD-H. H7 covers cache isolation, abuse controls, privacy-safe observability, recovery/runbooks and final handoff readiness.

## H7-CACHE-ISOLATION-01 — complete and verified

The public cache implementation scopes keys by tenant ID, storefront ID, sales-channel ID, request hostname, canonical hostname, locale, currency, price-list revision, publication generation, build ID, cache family, family generation and bounded resource token.

Deterministic acceptance evidence proves:

1. changing any authority dimension changes the public cache key;
2. two tenants/two hostnames cannot share an otherwise identical product cache key;
3. encoded cache segments prevent delimiter reshaping collisions;
4. account/cart/checkout and evidence routes never classify into public cache families;
5. unsafe scope/resource tokens fail closed.

Verified head: `0f4c14bfddad9e69ac1b51976f6a6fe262c9ae43`

Storefront CI: `30724190935`

## H7-ABUSE-CONTRACT-02 — complete and verified; runtime provider blocked

No storefront-specific distributed production limiter was found. MOD-H deliberately did not add a Worker-isolate in-memory counter and call it production abuse protection.

Provider-independent hardening now provides:

- explicit public-read/search/media/private-read/checkout/admin policy classes;
- trusted-edge opaque keys for anonymous traffic;
- authenticated-session opaque keys for authenticated traffic;
- raw IP/arbitrary forwarding-header key rejection;
- spoofed `X-Forwarded-For`, `CF-Connecting-IP` and `True-Client-IP` resistance;
- strict `allow | deny | unavailable` provider decisions;
- read-path `fail_open_observe` and sensitive checkout/admin `fail_closed` unavailability policy;
- safe HTTP 429 + bounded Retry-After/no-store/nosniff;
- fail-closed HTTP 503 `STOREFRONT_ABUSE_CONTROL_UNAVAILABLE`;
- no provider revision or abuse-key leakage to buyers.

Runtime distributed enforcement remains intentionally unwired until Issue #107 supplies provider-backed state across Worker isolates/regions.

Verified head: `967a66e58ae89c408a5b3e75afc3a95a2d13fad4`

Storefront CI: `30724380521`

## H7-OBS-RUNBOOK-03 — complete and verified; shared sink blocked

Added strict `storefront-operational-event.v1` in `modules/storefront/src/observability.ts`.

Bounded event taxonomy:

- `storefront.cache.decision`;
- `storefront.public_host.resolve`;
- `storefront.private_access.decision`;
- `storefront.abuse_control.decision`;
- `storefront.domain.lifecycle`;
- `storefront.checkout.guard`.

The envelope permits only bounded request/trace correlation, safe tenant/storefront/channel identifiers and fixed low-cardinality cache/abuse/domain dimensions. It intentionally has no free-form metadata object.

Strict tests reject customer/contact data, hostnames, raw IP/forwarding headers, abuse keys, provider IDs/challenges, payment IDs, warehouse/reservation authority, R2 object keys/private paths, staff/internal metadata and arbitrary high-cardinality labels.

`docs/architecture/storefront/operations-runbook.md` covers:

- public-host/domain resolution failures;
- cross-tenant/hostname cache contamination;
- private account/order anomalies;
- checkout guard unavailability;
- abuse-provider failure;
- domain provider ambiguity/outage;
- Cloudflare preview/runtime cleanup;
- PostgreSQL and non-destructive Neon recovery;
- buyer return/support boundaries.

The runbook forbids manually manufacturing provider state, widening customer/order ownership queries, bypassing checkout authority, or substituting Worker-memory rate limiting for distributed enforcement.

Issue #108 tracks the approved shared telemetry sink. MOD-H does not create an ad-hoc logger or permit the future sink to widen the validated event envelope with free-form request/body/exception data.

### Verified evidence

Exact head `a4030ef44814b740538bb3d8a2b7a192bf44ba2a`, Storefront CI `30724857648`:

- verify `91434520353` — passed;
- PostgreSQL 17 rehearsal `91434580011` — passed;
- buyer/admin browser/accessibility `91434579986` — passed;
- Cloudflare preview/runtime/cleanup `91434579971` — passed;
- non-destructive Neon recovery `91434580104` — passed.

The same exact head also passed Storefront H1 Validation, Storefront Lockfile, Foundation Design CI and Foundation CI.

## Machine tracker and handoff

`docs/architecture/storefront/status.yaml` is synchronized through H7 while preserving historical H0–H3 checkpoint evidence.

`docs/agent-handoffs/MOD-H-STOREFRONT-COMMERCE-PROGRESS.md` contains the current verified checkpoint ledger, fail-closed matrix, blockers and serial integration rules.

## Remaining H7 work

1. integrate Issue #107 distributed abuse provider;
2. integrate Issue #108 approved shared telemetry sink without widening the envelope;
3. keep H4–H6 authority surfaces fail closed while Issues #97/#98/#100/#101/#102/#104 are resolved;
4. run fresh exact-head Storefront CI after final owning-module/runtime integration;
5. replace the progress handoff with a final completion receipt only after all workpack gates pass.

## Current blockers

- #97 — lossless MOD-A price/tax + MOD-C pre-order shipping;
- #98 — MOD-E public payment capability;
- #100 — MOD-F typed checkout country/address/contact policy;
- #101 — trusted customer binding + storefront-scoped MOD-C order reads;
- #102 — buyer-safe return/support request capability;
- #104 — trusted custom-hostname verification/certificate provider lifecycle;
- #107 — distributed storefront abuse/rate-limit provider;
- #108 — approved shared operational telemetry sink preserving the strict storefront envelope.
