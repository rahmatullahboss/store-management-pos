# MOD-H Storefront Commerce — Progress Handoff

Status: **active / not final**

Branch: `module/storefront-commerce-v1`

Integration target: `program/integration-v1`

Draft PR: #48

Latest fully verified implementation head: `8666a1440d5139a132c5028f3b64ad0912855eaf`

Latest fully verified Storefront CI: `30726322406`

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

Implemented authority-free cart persistence, exact quantity/money contracts, strict buyer quote intent, publication/customer/multi-warehouse revalidation, MOD-C quote bridge without privilege synthesis, checkout capability/recovery contracts and submit freshness/idempotency preflight.

Still deliberately unregistered/fail closed: public quote, checkout capability and checkout submission mutation routes.

Blockers: #97, #98, #100.

### H5 — private customer/order read experience

Status: **blocker-independent reads/presentation complete; live private routes blocked**

Verified private/security head: `b35b0e260abdcfd882240437f47f59f98a2e7548`

Storefront CI: `30723499435`

Implemented private profile/order contracts, authenticated-session-only principal, no browser-selected customer authority, strict tenant/legal-entity/store/customer/storefront/sales-channel revalidation, exact-money projection, privacy/internal-authority redaction, HTTPS/no-store clients, unregistered private handler, generic private 403 denial and multilingual read-only order tracking.

Still deliberately unregistered: private profile, order history/detail and live private tracking routes.

Blockers: #101 and #102.

### H6 — custom-domain trust hardening

Status: **local lifecycle safe; trusted provider integration blocked**

Latest fully verified H6 code head: `f0ed777350cc67145381ec02911ea53e9ab72c4d`

Storefront CI: `30723955210`

Implemented tenant-scoped domain/verification schema/invariants, fail-closed public host resolution, external tenant/admin provider verification/certificate 503 guard, domain-registration intent and strict provider-secret-free read-only lifecycle projection.

Provider verification/certificate lifecycle remains blocked on #104.

### H7 — hardening

#### H7-CACHE-ISOLATION-01 — complete/verified

Exact head: `0f4c14bfddad9e69ac1b51976f6a6fe262c9ae43`

Storefront CI: `30724190935`

Evidence proves cache isolation across tenant/storefront/channel/request-host/canonical-host/locale/currency/commercial revisions/build/family/generation/resource, delimiter-collision resistance, private-route bypass and unsafe-token fail closed.

#### H7-ABUSE-CONTRACT-02 — complete/verified; runtime provider blocked

Exact head: `967a66e58ae89c408a5b3e75afc3a95a2d13fad4`

Storefront CI: `30724380521`

Provider-independent public/private/checkout/admin policy/key/decision contracts and safe 429/503 semantics are verified. No Worker-isolate in-memory production limiter was introduced. Runtime distributed enforcement is blocked on #107.

#### H7-OBS-RUNBOOK-03 — complete/verified; sink integration blocked

Exact head: `a4030ef44814b740538bb3d8a2b7a192bf44ba2a`

Storefront CI: `30724857648`

Verified privacy-safe operational event envelope, strict sensitive/high-cardinality field rejection and operations runbook. Issue #108 tracks the approved shared sink; no ad-hoc logger is wired.

#### H7-FAIL-CLOSED-MATRIX-04 — complete/verified

Future-safe exact head: `7b858b601cc83fc7bd65d3847ebaa7d9e5998cdc`

Storefront CI: `30726144155`

Added CI-level release matrix proving blocked commerce/private handlers are absent from live roots, domain provider observation stays intercepted before command execution, abuse/telemetry providers are not silently wired and H4–H7 blocker state remains machine-visible. The tracker assertion validates a progressing non-H3 verified SHA rather than hardcoding one old H7 head.

#### H7-PERF-CACHE-05 — complete/verified

Exact implementation head: `8666a1440d5139a132c5028f3b64ad0912855eaf`

Storefront CI: `30726322406`

Bounded local performance rehearsal:

- synthetic evidence only, no customer/production data;
- 64 requests, concurrency 8;
- 64/64 passed;
- p95 **86.31 ms**;
- response budget <= 512 KiB;
- report explicitly records `productionSla: false`.

This is a regression/load rehearsal, not a production SLA claim.

PostgreSQL cache invalidation evidence now verifies:

- theme → content+sitemap;
- category → catalog+category+search+sitemap;
- collection → catalog+collection+search+sitemap;
- product → catalog+product+category+collection+search+sitemap+media;
- unknown reason → conservative all-nine-family invalidation;
- targeted media advancement does not change catalog;
- replay is single-effect, conflicting replay rejected;
- audit/outbox/receipt evidence exists;
- runtime cannot execute the internal reason→family policy function.

Latest exact-head jobs after targeted recovery:

- verify `91439163345` — passed;
- PostgreSQL `91439153771` — passed;
- browser/accessibility/performance `91439153689` — passed;
- Cloudflare `91439153617` — passed after targeted rerun of a transient local preview 502;
- Neon recovery `91439153353` — passed after targeted rerun of a concurrency-cancelled job.

No source guard, budget or assertion was weakened.

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

A coherent checkpoint is not fully verified until the exact code head passes root format/lint/boundaries/typecheck/database/full tests/security, Astro build, PostgreSQL 17 rehearsal, buyer/admin browser/accessibility, Cloudflare preview/runtime/cleanup and non-destructive Neon recovery.

If an external lane is concurrency-cancelled or transiently fails while source gates remain green, target only that affected job. Do not weaken source assertions or budgets to obtain green CI.

## 6. Existing browser/performance evidence

Representative evidence covers English, Bengali bounded-3G, Arabic RTL, Japanese/CJK, keyboard/focus, reduced motion, 200% text, Axe WCAG checks, overflow/clipping, buyer content/catalog/discovery/search, checkout recovery, order tracking, admin surfaces and the bounded 64-request performance rehearsal.

All fixtures are synthetic; no production/customer data is used.

## 7. Final completion gate still outstanding

MOD-H is **not complete** until, at minimum:

1. H4 owning-module quote/shipping/payment/country-policy adapters exist and live checkout is safely activated;
2. retries/concurrency prove no duplicate order/reservation/payment/ledger effects;
3. H5 trusted customer binding and scoped order read capability exist before private routes activate;
4. buyer return/support entry point exists within owning-module policy;
5. H6 trusted provider custom-domain lifecycle exists and exact conflict/takeover/certificate/offboarding evidence passes;
6. H7 distributed abuse provider is integrated or an approved production alternative is supplied;
7. H7 shared telemetry sink accepts only the verified privacy-safe envelope;
8. fresh migration/recovery/Cloudflare/browser/performance evidence is recorded on the final exact head;
9. this progress handoff is replaced with the final completion receipt and serial integration instructions.
