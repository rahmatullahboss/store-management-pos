# MOD-H Storefront Commerce — Progress Handoff

Status: **active / not final**

Branch: `module/storefront-commerce-v1`

Integration target: `program/integration-v1`

Draft PR: #48

Latest fully verified implementation/documentation head: `a4030ef44814b740538bb3d8a2b7a192bf44ba2a`

Latest fully verified Storefront CI: `30724857648`

This document is a progress handoff, not a completion receipt. MOD-H must remain draft until the owning-module/runtime blockers and final H7 gates listed below are resolved and verified.

## 1. Integration safety

- Do not merge current `main` into MOD-H ad hoc.
- Integrate serially through the approved `program/integration-v1` programme path.
- Do not reset, discard, overwrite or force-push existing MOD-H work.
- Do not delete/reset/repurpose another module's Neon branch to create capacity for MOD-H.
- Storefront remains a presentation/buyer-interaction channel; it is not a parallel commerce/provider backend.

## 2. Verified checkpoint ledger

### H1–H3 — foundation, publication, public storefront

Status: **complete and verified**

Latest fully verified H3 code head: `d5e5c6a0b0a780a89c9702f0ade6f632c0dc60ab`

Storefront CI: `30693905643`

Delivered areas include Astro/Cloudflare storefront foundation, tenant/storefront/hostname runtime context, theme/layout/content/navigation/homepage/public catalog/search/filter/discovery, explicit publication, SEO/canonical/robots/sitemap/feed, media/cache-generation boundaries, PostgreSQL migrations/RLS/admin controls and multilingual browser/accessibility evidence.

### H4 — exact cart/checkout boundaries

Status: **blocker-independent boundaries complete; live authority blocked**

Latest fully verified H4 code head: `db135e7c72ac418ee1158ab10cb3665ee88ab943`

Storefront CI: `30710984952`

Implemented:

- authority-free browser cart persistence;
- exact quantity/money contracts;
- strict buyer-intent quote request;
- publication/customer/multi-warehouse inventory revalidation;
- MOD-C quote bridge without privilege synthesis;
- checkout capability contract and stale/changed/unavailable recovery;
- submit freshness/idempotency/request-hash preflight;
- accessible multilingual checkout recovery UI/evidence.

Still deliberately unregistered/fail closed:

- public cart quote route;
- checkout capability route;
- checkout submission mutation route.

Blockers: #97, #98, #100.

### H5 — private customer/order read experience

Status: **blocker-independent reads/presentation complete; live private routes blocked**

Verified private/security head: `b35b0e260abdcfd882240437f47f59f98a2e7548`

Storefront CI: `30723499435`

Implemented:

- private versioned customer profile/order history/order detail contracts;
- trusted authenticated-session principal boundary;
- no browser-selected customer authority;
- tenant/legal-entity/store/customer/storefront/sales-channel revalidation;
- exact-money order projection;
- internal authority/privacy redaction;
- credentialed HTTPS/no-store clients;
- unregistered private account handler;
- generic private 403 denial without ownership-detail leakage;
- multilingual read-only order tracking without synthetic carrier event/ETA/refund/return authority.

Still deliberately unregistered:

- private customer profile route;
- private order history/detail route;
- live private order-tracking page.

Blockers: #101 and #102.

### H6 — custom-domain trust hardening

Status: **local lifecycle safe; trusted provider integration blocked**

Latest fully verified H6 code head: `f0ed777350cc67145381ec02911ea53e9ab72c4d`

Storefront CI: `30723955210`

Implemented:

- tenant-scoped local domain/verification schema and lifecycle invariants;
- fail-closed public hostname resolution;
- external tenant/admin provider verification/certificate mutation returns 503 `DOMAIN_PROVIDER_CONTROL_UNAVAILABLE` before command execution;
- domain registration intent remains available;
- strict provider-secret-free read-only lifecycle projection;
- active presentation requires local domain active + verification verified + certificate active simultaneously.

Provider verification/certificate lifecycle remains blocked on #104.

### H7 — hardening

#### H7-CACHE-ISOLATION-01 — complete/verified

Exact head: `0f4c14bfddad9e69ac1b51976f6a6fe262c9ae43`

Storefront CI: `30724190935`

Evidence proves public cache isolation across tenant/storefront/channel/request-host/canonical-host/locale/currency/commercial revisions/build/family/generation/resource, delimiter-collision resistance, private-route bypass and unsafe-token fail-closed behavior.

#### H7-ABUSE-CONTRACT-02 — complete/verified

Exact head: `967a66e58ae89c408a5b3e75afc3a95a2d13fad4`

Storefront CI: `30724380521`

Implemented provider-independent policy/key/decision contracts and safe 429/503 semantics. No Worker-isolate in-memory production limiter was introduced. Runtime distributed enforcement is blocked on #107.

#### H7-OBS-RUNBOOK-03 — complete/verified; sink integration blocked

Exact verified head: `a4030ef44814b740538bb3d8a2b7a192bf44ba2a`

Storefront CI: `30724857648`

Job evidence:

- verify `91434520353` — passed;
- PostgreSQL 17 rehearsal `91434580011` — passed;
- buyer/admin browser/accessibility `91434579986` — passed;
- Cloudflare deploy/runtime/cleanup `91434579971` — passed;
- non-destructive Neon recovery `91434580104` — passed.

Implemented:

- strict privacy-safe `storefront-operational-event.v1` envelope;
- fixed low-cardinality cache/public-host/private-access/abuse/domain/checkout event taxonomy;
- rejection of customer IDs/contact data, hostnames, raw IP/forwarding headers, abuse keys, provider IDs/challenges, payment IDs, warehouse/reservation/storage/internal free-form metadata;
- operations runbook for cache contamination, private access, checkout guard, domain/provider, abuse-control, Cloudflare and PostgreSQL/Neon incidents;
- machine tracker synchronized through H7 without deleting historical H0–H3 evidence.

Issue #108 tracks the approved shared operational telemetry sink. MOD-H does not create an ad-hoc logger or permit the sink to widen the strict event envelope.

## 3. Current cross-module/runtime blockers

- #97 — lossless MOD-A price/tax into MOD-C quote persistence plus MOD-C pre-order shipping/rate;
- #98 — side-effect-free MOD-E public payment capability projection;
- #100 — typed MOD-F checkout country/address/contact policy;
- #101 — trusted authenticated-session → canonical customer binding plus storefront/sales-channel scoped MOD-C order reads;
- #102 — buyer-safe idempotent return/support request capability;
- #104 — trusted MOD-G/shared Cloudflare custom-hostname provider lifecycle;
- #107 — distributed/provider-backed storefront abuse/rate-limit runtime;
- #108 — approved shared operational telemetry sink preserving the strict storefront envelope.

These blockers are not justification to create parallel authority inside MOD-H.

## 4. Current fail-closed matrix

| Surface | Current posture |
|---|---|
| Public catalog/content/search | Enabled through verified H1–H3 contracts |
| Browser cart draft | Enabled as authority-free local state |
| Public quote mutation | Unregistered/fail closed |
| Checkout capability | Unregistered/fail closed |
| Checkout submit/order/payment mutation | Unregistered/fail closed |
| Private account/order routes | Unregistered/fail closed |
| Buyer return/support mutation | Not exposed |
| Domain registration intent | Available |
| Tenant/admin provider verification mutation | 503 fail closed |
| Tenant/admin certificate/provider transition | 503 fail closed |
| Public custom-domain resolution | Requires verified local active/certificate-active state |
| Distributed rate-limit enforcement | Not wired until #107 |
| Operational event sink | Not wired until #108; strict envelope verified |

## 5. Evidence policy

A coherent checkpoint is not fully verified until the exact code head passes the relevant Storefront CI lanes:

- root format/lint/boundaries/typecheck/database/full tests/security;
- Astro Cloudflare build;
- PostgreSQL 17 storefront rehearsal;
- buyer/admin browser/accessibility evidence;
- Cloudflare preview deploy/runtime metrics/cleanup;
- non-destructive Neon recovery.

If Neon is concurrency-cancelled without executing source steps, targeted-rerun only that cancelled job and require it to pass before claiming exact-head full green.

## 6. Existing browser evidence

Representative storefront evidence covers English, Bengali bounded-3G, Arabic RTL, Japanese/CJK, keyboard skip-link/focus, reduced motion, 200% text, Axe WCAG checks, root overflow/clipping, buyer content/catalog/discovery/search, checkout recovery, read-only order tracking and admin storefront surfaces.

All evidence fixtures are synthetic; no production/customer data is used.

## 7. Final completion gate still outstanding

MOD-H is **not complete** until, at minimum:

1. H4 owning-module quote/shipping/payment/country-policy adapters exist and live checkout is safely activated;
2. retries/concurrency prove no duplicate order/reservation/payment/ledger effects;
3. H5 trusted customer binding and scoped order read capability exist before private routes activate;
4. buyer return/support entry point exists within owning-module policy;
5. H6 trusted provider custom-domain lifecycle exists and exact domain conflict/takeover/certificate/offboarding evidence passes;
6. H7 distributed abuse provider is integrated or an approved production alternative is supplied;
7. H7 shared telemetry sink accepts only the verified privacy-safe envelope;
8. fresh migration/recovery/Cloudflare/browser evidence is recorded on the final exact head;
9. this progress handoff is replaced with the final completion receipt and serial integration instructions.
