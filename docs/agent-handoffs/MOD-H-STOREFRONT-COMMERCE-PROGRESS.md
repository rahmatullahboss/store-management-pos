# MOD-H Storefront Commerce — Progress Handoff

Status: **active / not final**

Branch: `module/storefront-commerce-v1`

Integration target: `program/integration-v1`

Draft PR: #48

Latest fully verified implementation head: `4d4b48ee6f882ed40a067676f5dba7a8e013f49b`

Latest fully verified Storefront CI: `30733358590`

This document is a progress handoff, not a completion receipt. MOD-H must remain draft until the owning-module/runtime blockers and final activation gates below are resolved and verified.

## 1. Integration safety

- Do not merge current `main` into MOD-H ad hoc.
- Integrate serially through the approved `program/integration-v1` programme path.
- Do not reset, discard, overwrite or force-push existing MOD-H work.
- Do not delete/reset/repurpose another module's Neon branch to create capacity for MOD-H.
- Storefront remains a presentation/buyer-interaction channel; it is not a parallel commerce/provider backend.
- A blocker acceptance document never authorizes activation by itself; owner delivery + exact-head evidence is mandatory.

## 2. Verified checkpoint ledger

### H1–H3 — foundation, publication, public storefront

Status: **complete and verified**

Latest H3 head: `d5e5c6a0b0a780a89c9702f0ade6f632c0dc60ab`

Storefront CI: `30693905643`

Delivered areas include Astro/Cloudflare storefront foundation, tenant/storefront/hostname runtime context, theme/layout/content/navigation/homepage, public catalog/search/filter/discovery, explicit publication, SEO/canonical/robots/sitemap/feed, media/cache-generation boundaries, PostgreSQL migrations/RLS/admin controls and multilingual browser/accessibility evidence.

### H4 — exact cart/checkout boundaries

Status: **blocker-independent boundaries complete; live authority blocked**

Latest verified recovery refinement head: `2f8569a2e47922bb5d77e584f605fac85dabeb5f`

Storefront CI: `30726829026`

Implemented authority-free cart persistence, exact quantity/money contracts, strict buyer quote intent, publication/customer/multi-warehouse revalidation, MOD-C quote bridge without privilege synthesis, checkout capability/recovery contracts and submit freshness/idempotency preflight.

Public quote/capability/submit routes remain unregistered/fail closed.

Blockers: #97, #98, #100.

### H5 — private customer/order read experience

Status: **blocker-independent reads/presentation complete; live private routes blocked**

Latest verified pagination refinement head: `7485f4e80c468de328093fcc09fd22efdc25a110`

Storefront CI: `30727323408`

Implemented private profile/order contracts, authenticated-session-only principal, no browser-selected customer authority, strict tenant/legal-entity/store/customer/storefront/sales-channel revalidation, exact-money projection, privacy/internal-authority redaction, HTTPS/no-store clients, generic private 403 denial and multilingual read-only order tracking.

Order-history cursors are bounded URL-safe opaque tokens; customer/order/product/variant identities remain UUID-only.

Still deliberately unregistered: private profile, order history/detail and live private tracking routes.

Blockers: #101 and #102.

### H6 — custom-domain trust hardening

Status: **MOD-H bridge ready; trusted provider transport/lifecycle still blocked**

Latest verified H6 head: `c52b688f28595cd41c5d735d038436670e638b68`

Storefront CI: `30727839962`

Implemented tenant-scoped domain/verification schema and lifecycle invariants, fail-closed public host resolution, external tenant/admin provider verification/certificate 503 guard, domain-registration intent, provider-secret-free read-only lifecycle projection and strict trusted-provider observation bridge.

`domain-provider-bridge.ts` rejects raw provider tokens, free-form failure detail, tenant-style canonical authority and arbitrary metadata. Provider observations cannot assert local canonical state. The bridge remains unreachable from public/tenant roots.

Blocker: #104.

### H7 — hardening

#### H7-CACHE-ISOLATION-01 — complete/verified

Head `0f4c14bfddad9e69ac1b51976f6a6fe262c9ae43`, CI `30724190935`.

Cache isolation covers tenant/storefront/channel/request-host/canonical-host/locale/currency/commercial revisions/build/family/generation/resource; private routes bypass public cache and unsafe tokens fail closed.

#### H7-ABUSE-CONTRACT-02 — complete/verified; runtime provider blocked

Head `967a66e58ae89c408a5b3e75afc3a95a2d13fad4`, CI `30724380521`.

Provider-independent policy/key/decision contracts and safe 429/503 semantics are verified. No Worker-isolate in-memory production limiter was introduced.

#### H7-OBS-RUNBOOK-03 — complete/verified; sink blocked

Head `a4030ef44814b740538bb3d8a2b7a192bf44ba2a`, CI `30724857648`.

Verified privacy-safe operational event envelope, strict sensitive/high-cardinality field rejection and operations runbook. No ad-hoc logger is wired.

#### H7-FAIL-CLOSED-MATRIX-04 — complete/verified

Head `7b858b601cc83fc7bd65d3847ebaa7d9e5998cdc`, CI `30726144155`.

CI proves blocked commerce/private handlers are absent from live roots, tenant domain provider observations remain intercepted, abuse/telemetry providers are not silently wired and blocker state stays explicit.

#### H7-PERF-CACHE-05 — complete/verified

Head `8666a1440d5139a132c5028f3b64ad0912855eaf`, CI `30726322406`.

Bounded local synthetic performance rehearsal and PostgreSQL cache invalidation reason→family evidence are verified. Performance evidence is explicitly not a production SLA.

#### H7-RUNTIME-BRIDGES-06 — complete/verified; provider/sink activation blocked

Head `c5e6fa19db9494eb6e8b7970ee7e69db64986342`, CI `30732951052`.

Added strict integration-side bridges without inventing missing runtime services:

- `abuse-control-provider-bridge.ts` accepts only normalized MOD-H requests, revalidates trusted-edge/authenticated-session key provenance, requires `trusted-distributed-provider` results and rejects raw IP/provider token/fingerprint/free-form metadata;
- `operational-sink-bridge.ts` validates the privacy-safe event envelope before sink invocation, collapses transport failure to bounded `sink_unavailable`, malformed sink output to `configuration_error`, and never lets telemetry alter commerce/domain authority.

Both bridges are statically absent from live API/buyer runtime roots. #107 and #108 remain open for actual runtime/provider delivery.

#### H7-INTEGRATION-READINESS-07 — complete/verified

Exact implementation head: `4d4b48ee6f882ed40a067676f5dba7a8e013f49b`

Storefront CI: `30733358590`

Added:

- `docs/architecture/storefront/dependency-integration-acceptance.json`;
- `docs/architecture/storefront/dependency-integration-acceptance.md`;
- `tests/unit/storefront-dependency-integration-acceptance.test.mjs`;
- verified checkpoint receipt: `docs/architecture/storefront/h7-integration-readiness-checkpoint.md`.

The machine-readable acceptance manifest covers exactly #97/#98/#100/#101/#102/#104/#107/#108. Every entry has an owner, capability, existing MOD-H boundary, activation surfaces, required evidence and `activationAllowed: false`.

The executable gate proves:

- every current external blocker appears exactly once;
- every referenced integration boundary exists under repository-owned MOD-H/API roots;
- #104/#107/#108 map to their verified domain/abuse/telemetry bridge paths;
- live API/buyer roots still do not import cart-quote, checkout-capability, customer-account, domain-provider, abuse-provider or operational-sink bridges;
- documentation cannot silently authorize a blocked route/provider.

Serial activation instructions require owner delivery into `program/integration-v1`, no arbitrary `main` merge, no browser/provider authority synthesis, negative scope/stale/retry/idempotency/privacy tests before registration, and fresh exact-head Storefront CI in the same activation checkpoint.

Exact CI evidence, run `30733358590` latest successful attempt:

- verify `91457708872` — passed;
- PostgreSQL `91457709078` — passed;
- browser/accessibility/performance `91457709262` — passed;
- Cloudflare `91457722062` — passed;
- Neon recovery `91457708663` — passed after targeted rerun of an earlier concurrency cancellation.

Exact browser evidence:

- Astro: 27 files, 0 errors, 0 warnings, 0 hints;
- buyer: 5/5 across 4 locales with one low-bandwidth scenario;
- admin: 4/4;
- public content/catalog/discovery/search all passed; discovery/search Axe violations 0;
- checkout recovery: 4/4;
- order tracking: 4/4;
- bounded synthetic load: 64/64 requests, p95 **83.24 ms**, `productionSla: false`.

Artifact: 45 files, 1,465,761 bytes, ID `8828703975`, SHA-256 `ccd4c0ef2a83ac51711062e7e816f1a2b06abb6f33ef2d892ddfe6b63be7a15a`.

No blocker was resolved or activated by this readiness checkpoint.

## 3. Current cross-module/runtime blockers

- #97 — lossless MOD-A price/tax into MOD-C quote persistence plus MOD-C pre-order shipping/rate;
- #98 — side-effect-free MOD-E public payment capability projection;
- #100 — typed MOD-F checkout country/address/contact policy;
- #101 — trusted authenticated-session → canonical customer binding plus storefront/sales-channel scoped MOD-C order reads;
- #102 — buyer-safe idempotent return/support request capability;
- #104 — trusted MOD-G/shared Cloudflare custom-hostname transport/lifecycle feeding the verified MOD-H bridge;
- #107 — actual distributed/provider-backed storefront abuse/rate-limit runtime feeding the verified bridge;
- #108 — approved shared operational telemetry sink feeding the verified privacy-safe bridge.

No owning-module delivery was found for #97/#98/#100/#101/#102 during the latest checkpoint review. These blockers are not justification to create parallel authority inside MOD-H.

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
| Distributed abuse provider bridge | Verified but unreachable from live roots |
| Distributed rate-limit enforcement | Not wired until #107 runtime exists |
| Operational sink bridge | Verified but unreachable from live roots |
| Operational event sink | Not wired until #108 runtime exists |

## 5. Evidence policy

A coherent checkpoint is not fully verified until the exact code head passes root format/lint/boundaries/typecheck/database/full tests/security, Astro build, PostgreSQL 17 rehearsal, buyer/admin browser/accessibility, Cloudflare preview/runtime/cleanup and non-destructive Neon recovery.

If an external lane is concurrency-cancelled or transiently fails while source gates remain green, target only that affected job. Do not weaken source assertions or budgets to obtain green CI.

## 6. Machine tracker note

`docs/architecture/storefront/status.yaml` preserves a large H0–H3 historical evidence ledger. Repository tooling currently exposes whole-file replacement rather than a safe semantic partial patch for that tracker. Do not truncate historical evidence merely to advance the newest H7 slice; the checkpoint receipt, this handoff and PR #48 carry the current verified state until a history-preserving tracker patch is available.

## 7. Final completion gate still outstanding

MOD-H is **not complete** until, at minimum:

1. H4 owning-module quote/shipping/payment/country-policy capabilities exist and live checkout is safely activated;
2. retries/concurrency prove no duplicate order/reservation/payment/ledger effects;
3. H5 trusted customer binding and scoped order read capability exist before private routes activate;
4. buyer return/support entry point exists within owning-module policy;
5. H6 trusted provider transport/control-plane implementation feeds the verified bridge and conflict/takeover/certificate/offboarding evidence passes;
6. H7 actual distributed abuse provider/native runtime feeds the verified abuse bridge and passes integration/load evidence;
7. H7 approved shared telemetry sink consumes only the verified privacy-safe envelope through the verified sink bridge;
8. fresh migration/recovery/Cloudflare/browser/performance evidence is recorded on the final exact activation head;
9. this progress handoff is replaced with the final completion receipt and serial integration instructions.
