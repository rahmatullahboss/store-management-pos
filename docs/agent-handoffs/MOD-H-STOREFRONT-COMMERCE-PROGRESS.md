# MOD-H Storefront Commerce — Progress Handoff

Status: **active / not final**

Branch: `module/storefront-commerce-v1`

Integration target: `program/integration-v1`

Draft PR: #48

Latest fully verified implementation head: `c5e6fa19db9494eb6e8b7970ee7e69db64986342`

Latest fully verified Storefront CI: `30732951052`

This document is a progress handoff, not a completion receipt. MOD-H must remain draft until the owning-module/runtime blockers and final activation gates listed below are resolved and verified.

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

Original verified recovery code head: `db135e7c72ac418ee1158ab10cb3665ee88ab943`

Latest verified recovery refinement head: `2f8569a2e47922bb5d77e584f605fac85dabeb5f`

Storefront CI: `30726829026`

Implemented authority-free cart persistence, exact quantity/money contracts, strict buyer quote intent, publication/customer/multi-warehouse revalidation, MOD-C quote bridge without privilege synthesis, checkout capability/recovery contracts and submit freshness/idempotency preflight.

Recovery derivation consumes only the factual quote/capability fields it needs. Full production envelopes remain structurally compatible, while the synthetic evidence route no longer uses escape casts. Public quote/capability/submit routes remain unregistered/fail closed.

Blockers: #97, #98, #100.

### H5 — private customer/order read experience

Status: **blocker-independent reads/presentation complete; live private routes blocked**

Verified private/security head: `b35b0e260abdcfd882240437f47f59f98a2e7548`

Latest verified pagination refinement head: `7485f4e80c468de328093fcc09fd22efdc25a110`

Storefront CI: `30727323408`

Implemented private profile/order contracts, authenticated-session-only principal, no browser-selected customer authority, strict tenant/legal-entity/store/customer/storefront/sales-channel revalidation, exact-money projection, privacy/internal-authority redaction, HTTPS/no-store clients, unregistered private handler, generic private 403 denial and multilingual read-only order tracking.

`H5-PAGINATION-04` treats MOD-C order-history cursors as bounded URL-safe opaque tokens instead of assuming UUID structure. Customer/order/product/variant identities remain UUID-only. The module forwards and validates opaque cursors without interpreting them, and the private client round-trips them without sending customer identity.

Still deliberately unregistered: private profile, order history/detail and live private tracking routes.

Blockers: #101 and #102.

### H6 — custom-domain trust hardening

Status: **MOD-H bridge ready; trusted provider transport/lifecycle still blocked**

Latest fully verified H6 head: `c52b688f28595cd41c5d735d038436670e638b68`

Storefront CI: `30727839962`

Implemented:

- tenant-scoped domain/verification schema and lifecycle invariants;
- fail-closed public host resolution;
- external tenant/admin provider verification/certificate 503 guard;
- domain-registration intent;
- provider-secret-free read-only lifecycle projection;
- strict trusted-provider observation bridge for future MOD-G/shared control-plane integration.

`H6-PROVIDER-BRIDGE-03` adds a pure trusted observation parser/mapper, not a provider client. Verification observations require `source: trusted-control-plane`, bounded observation/domain/challenge data, SHA-256 challenge digest and strict time ordering. Lifecycle observations require normalized provider-derived domain/certificate facts, and active state requires active certificate plus provider hostname ID.

The bridge rejects raw provider tokens, free-form failure detail, tenant-style canonical authority and arbitrary metadata. Provider observations cannot assert local canonical state; canonical is supplied separately as a local MOD-H fact. Mapping produces the existing internal domain command inputs with deterministic idempotency keys.

The fail-closed release matrix statically proves the bridge is not imported by the API root, tenant-facing storefront handler or buyer runtime. External provider verification/certificate routes therefore remain 503 until #104 supplies the approved transport/control-plane authority.

The integrated MOD-G release was inspected and contains generic connector/webhook/credential infrastructure, but no storefront custom-hostname lifecycle authority. #104 is therefore a real remaining capability gap, not a stale integration gap.

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

CI proves blocked commerce/private handlers are absent from live roots, domain provider observation stays intercepted before command execution, abuse/telemetry providers are not silently wired and H4–H7 blocker state remains machine-visible.

#### H7-PERF-CACHE-05 — complete/verified

Exact implementation head: `8666a1440d5139a132c5028f3b64ad0912855eaf`

Storefront CI: `30726322406`

Bounded local performance rehearsal uses only synthetic evidence, 64 requests at concurrency 8, a <=512 KiB response budget and explicitly records `productionSla: false`. The original slice passed 64/64 at p95 86.31 ms; later verified heads continue to rerun the same gate. This is regression/load evidence, not a production SLA claim.

PostgreSQL cache invalidation evidence verifies theme/category/collection/product reason→family fan-out, conservative all-family fallback, targeted media isolation, replay/conflict behavior, audit/outbox/receipt evidence and internal-policy privilege restrictions.

#### H7-RUNTIME-BRIDGES-06 — complete/verified; provider and sink activation blocked

Exact implementation head: `c5e6fa19db9494eb6e8b7970ee7e69db64986342`

Storefront CI: `30732951052`

MOD-H now has strict integration-side bridges for the two remaining H7 runtime dependencies without inventing either missing runtime service.

Distributed abuse bridge:

- `modules/storefront/src/abuse-control-provider-bridge.ts` accepts only normalized MOD-H abuse requests;
- revalidates anonymous trusted-edge versus authenticated-session key provenance;
- creates a versioned trusted-runtime provider request;
- accepts only `source: trusted-distributed-provider` results;
- rejects raw IP, provider rules/tokens, raw fingerprints and arbitrary metadata;
- maps through the existing strict abuse decision parser, preserving 429/503, Retry-After and route-specific fail-open/fail-closed policy.

Operational sink bridge:

- `modules/storefront/src/operational-sink-bridge.ts` validates `storefront-operational-event.v1` before sink invocation;
- sensitive/free-form fields therefore cannot reach the sink;
- sink exceptions become bounded `sink_unavailable` without exception leakage;
- malformed/provider-internal receipts become bounded `configuration_error` without secret leakage;
- telemetry delivery never mutates commerce/domain authority.

The fail-closed release matrix additionally proves both bridges remain absent from API/buyer runtime roots. They are integration-ready contracts, not live providers.

Exact successful attempt:

- verify `91456600965` — passed;
- PostgreSQL `91456595248` — passed;
- browser/accessibility/performance `91456595266` — passed;
- Cloudflare `91456595173` — passed;
- Neon recovery `91456595008` — passed after targeted rerun of an earlier concurrency cancellation.

Browser evidence at this exact head: Astro 27 files / 0 errors / 0 warnings / 0 hints; buyer 5/5 across 4 locales with one bounded low-bandwidth scenario; admin 4/4; checkout recovery 4/4; order tracking 4/4; discovery/search Axe 0; bounded synthetic load 64/64 at p95 **78.24 ms**, explicitly not a production SLA.

Issues #107 and #108 now contain the verified MOD-H integration contracts. They remain open for the actual distributed provider/native runtime and approved shared telemetry sink respectively.

## 3. Current cross-module/runtime blockers

- #97 — lossless MOD-A price/tax into MOD-C quote persistence plus MOD-C pre-order shipping/rate;
- #98 — side-effect-free MOD-E public payment capability projection;
- #100 — typed MOD-F checkout country/address/contact policy;
- #101 — trusted authenticated-session → canonical customer binding plus storefront/sales-channel scoped MOD-C order reads;
- #102 — buyer-safe idempotent return/support request capability;
- #104 — trusted MOD-G/shared Cloudflare custom-hostname transport/lifecycle implementation feeding the verified MOD-H bridge;
- #107 — actual distributed/provider-backed storefront abuse/rate-limit runtime feeding the verified MOD-H bridge;
- #108 — approved shared operational telemetry sink feeding the verified privacy-safe bridge.

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
| Trusted domain provider bridge | Verified but unreachable from public/tenant roots |
| Public custom-domain resolution | Requires verified local active/certificate-active state |
| Distributed abuse provider bridge | Verified but unreachable from live API/buyer roots |
| Distributed rate-limit enforcement | Not wired until #107 runtime exists |
| Operational sink bridge | Verified but unreachable from live API/buyer roots |
| Operational event sink | Not wired until #108 runtime exists |

## 5. Evidence policy

A coherent checkpoint is not fully verified until the exact code head passes root format/lint/boundaries/typecheck/database/full tests/security, Astro build, PostgreSQL 17 rehearsal, buyer/admin browser/accessibility, Cloudflare preview/runtime/cleanup and non-destructive Neon recovery.

If an external lane is concurrency-cancelled or transiently fails while source gates remain green, target only that affected job. Do not weaken source assertions or budgets to obtain green CI.

## 6. Existing browser/performance evidence

Representative evidence covers English, Bengali bounded-3G, Arabic RTL, Japanese/CJK, keyboard/focus, reduced motion, 200% text, Axe WCAG checks, overflow/clipping, buyer content/catalog/discovery/search, checkout recovery, order tracking, admin surfaces and bounded local performance rehearsal.

Latest verified implementation head `c5e6fa19db9494eb6e8b7970ee7e69db64986342` reran the bounded synthetic 64-request rehearsal at p95 78.24 ms with `productionSla: false`.

All fixtures are synthetic; no production/customer data is used.

## 7. Final completion gate still outstanding

MOD-H is **not complete** until, at minimum:

1. H4 owning-module quote/shipping/payment/country-policy adapters exist and live checkout is safely activated;
2. retries/concurrency prove no duplicate order/reservation/payment/ledger effects;
3. H5 trusted customer binding and scoped order read capability exist before private routes activate;
4. buyer return/support entry point exists within owning-module policy;
5. H6 trusted provider transport/control-plane implementation feeds the verified bridge and exact conflict/takeover/certificate/offboarding evidence passes;
6. H7 actual distributed abuse provider/native runtime feeds the verified abuse bridge and passes production integration/load evidence;
7. H7 approved shared telemetry sink accepts only the verified privacy-safe envelope through the verified sink bridge;
8. fresh migration/recovery/Cloudflare/browser/performance evidence is recorded on the final exact head;
9. this progress handoff is replaced with the final completion receipt and serial integration instructions.
