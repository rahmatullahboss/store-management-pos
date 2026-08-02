# MOD-H H7 Hardening Progress

Status: **active with external authority/runtime blockers**

Completed slices: `H7-CACHE-ISOLATION-01`, `H7-ABUSE-CONTRACT-02`, `H7-OBS-RUNBOOK-03`, `H7-FAIL-CLOSED-MATRIX-04`, `H7-PERF-CACHE-05`, `H7-RUNTIME-BRIDGES-06`, `H7-INTEGRATION-READINESS-07`, `H7-DEPENDENCY-GATE-08`, `H7-DEPENDENCY-EVIDENCE-09`

Latest fully verified implementation head: `8b44f666a42fc50aaec1333b22a5b5eee678165e`

Latest fully verified Storefront CI: `30755307713`

## Objective

Close blocker-independent storefront hardening and make future owning-module/shared-runtime integration executable and fail closed without moving pricing, tax, inventory, customer/order, payment, localization, provider or telemetry authority into MOD-H.

## H7-CACHE-ISOLATION-01 — complete and verified

Verified head: `0f4c14bfddad9e69ac1b51976f6a6fe262c9ae43`

Storefront CI: `30724190935`

Public cache keys are isolated by tenant, storefront, sales channel, request/canonical hostname, locale, currency, commercial revisions, build, family, generation and bounded resource token. Evidence covers delimiter-collision resistance, two-tenant/two-host isolation, private-route bypass and unsafe-token fail closed.

## H7-ABUSE-CONTRACT-02 — complete and verified; runtime provider blocked

Verified head: `967a66e58ae89c408a5b3e75afc3a95a2d13fad4`

Storefront CI: `30724380521`

Provider-independent hardening defines public/search/media/private/checkout/admin policy classes, trusted-edge and authenticated-session opaque keys, strict allow/deny/unavailable decisions, bounded Retry-After, safe 429 behavior and sensitive-route 503 fail closed. Raw forwarding/IP headers are not accepted as identity authority. No Worker-isolate in-memory limiter is presented as production distributed enforcement.

Issue #107 owns the actual cross-isolate/region runtime/provider.

## H7-OBS-RUNBOOK-03 — complete and verified; shared sink blocked

Verified head: `a4030ef44814b740538bb3d8a2b7a192bf44ba2a`

Storefront CI: `30724857648`

`storefront-operational-event.v1` is bounded and rejects free-form/sensitive/high-cardinality data including customer/contact identity, hostnames/raw IP/forwarding headers, abuse keys, provider/challenge data, payment/reservation/storage authority and arbitrary metadata.

`docs/architecture/storefront/operations-runbook.md` covers public host/domain failures, cross-tenant cache contamination, private account anomalies, checkout guard failure, abuse-provider failure, domain ambiguity, Cloudflare cleanup and PostgreSQL/Neon recovery.

Issue #108 owns the approved shared sink.

## H7-FAIL-CLOSED-MATRIX-04 — complete and verified

Verified future-safe head: `7b858b601cc83fc7bd65d3847ebaa7d9e5998cdc`

Storefront CI: `30726144155`

`tests/unit/storefront-fail-closed-release-matrix.test.mjs` proves blocked quote/checkout/private handlers are absent from live API roots, tenant domain provider requests are intercepted before command execution, runtime abuse/telemetry implementations are not silently wired and H4–H7 blockers stay visible.

## H7-PERF-CACHE-05 — complete and verified

Verified head: `8666a1440d5139a132c5028f3b64ad0912855eaf`

Storefront CI: `30726322406`

The bounded local performance rehearsal uses only synthetic evidence routes, 64 requests at concurrency 8, response-size bounds and a deliberately generous local p95 regression gate. Every report records `evidenceKind: bounded-local-rehearsal` and `productionSla: false`.

PostgreSQL invalidation evidence verifies reason→cache-family fan-out for theme/category/collection/product changes, conservative all-family fallback, targeted media isolation, idempotent replay, conflict rejection, audit/outbox/receipt evidence and internal-policy privilege restrictions.

## H7-RUNTIME-BRIDGES-06 — complete and verified; provider/sink activation blocked

Verified head: `c5e6fa19db9494eb6e8b7970ee7e69db64986342`

Storefront CI: `30732951052`

### Distributed abuse provider bridge

`modules/storefront/src/abuse-control-provider-bridge.ts`:

- accepts only normalized MOD-H abuse requests;
- revalidates anonymous `trusted_edge` versus authenticated `authenticated_session` key provenance;
- emits a versioned trusted-runtime request;
- requires `source: trusted-distributed-provider` results;
- rejects raw IP, provider rule IDs/tokens, raw fingerprints and arbitrary metadata;
- maps through the existing strict abuse decision parser so route-specific fail-open/fail-closed policy cannot be widened.

This is an integration contract, not a distributed limiter.

### Operational sink bridge

`modules/storefront/src/operational-sink-bridge.ts`:

- validates `storefront-operational-event.v1` before sink invocation;
- prevents sensitive/free-form event fields reaching a sink;
- converts sink transport exceptions to bounded `sink_unavailable` without exception leakage;
- converts malformed/provider-internal receipts to bounded `configuration_error` without secret leakage;
- never lets telemetry availability change commerce/domain authority.

The release matrix proves both bridges remain absent from live API/buyer roots.

Exact CI `30732951052` latest successful attempt:

- verify `91456600965` — passed;
- PostgreSQL `91456595248` — passed;
- browser/accessibility/performance `91456595266` — passed;
- Cloudflare `91456595173` — passed;
- Neon recovery `91456595008` — passed after targeted rerun.

Browser regression evidence at that head: Astro 27/0/0/0; buyer 5/5 across 4 locales with one low-bandwidth scenario; admin 4/4; checkout recovery 4/4; order tracking 4/4; discovery/search Axe 0; bounded synthetic performance 64/64 at p95 78.24 ms, not a production SLA.

## H7-INTEGRATION-READINESS-07 — complete and verified

Verified implementation head: `4d4b48ee6f882ed40a067676f5dba7a8e013f49b`

Storefront CI: `30733358590`

Checkpoint receipt: `docs/architecture/storefront/h7-integration-readiness-checkpoint.md`

Added:

- `docs/architecture/storefront/dependency-integration-acceptance.json`;
- `docs/architecture/storefront/dependency-integration-acceptance.md`;
- `tests/unit/storefront-dependency-integration-acceptance.test.mjs`.

The machine-readable manifest covers exactly Issues #97, #98, #100, #101, #102, #104, #107 and #108. Every entry names the owning module/runtime, missing capability, existing repository-owned MOD-H boundary, surfaces that would eventually activate, required acceptance evidence and `activationAllowed: false`.

The executable test proves:

1. all eight blockers exist exactly once;
2. each referenced integration boundary exists under approved MOD-H/API roots;
3. #104/#107/#108 point only to their verified domain/abuse/telemetry bridge paths;
4. live API/buyer roots still do not import cart quote, checkout capability, private customer account, domain provider, distributed abuse-provider or operational-sink bridges;
5. dependency documentation cannot silently authorize activation.

The human integration instructions require owner delivery into `program/integration-v1`, prohibit arbitrary `main` merges and browser/provider authority synthesis, and require negative scope, stale/retry/idempotency/privacy evidence before route/provider registration in the same exact-head activation checkpoint.

Exact CI `30733358590`, latest successful attempt:

- verify `91457708872` — passed;
- PostgreSQL `91457709078` — passed;
- browser/accessibility/performance `91457709262` — passed;
- Cloudflare preview/runtime/cleanup `91457722062` — passed;
- Neon recovery `91457708663` — passed after targeted rerun of an earlier concurrency cancellation.

Exact browser evidence:

- Astro check: 27 files, 0 errors, 0 warnings, 0 hints;
- buyer evidence: 5/5 across 4 locales with one low-bandwidth scenario;
- admin: 4/4;
- public content: 3/3;
- public catalog: 3/3;
- public discovery: 3/3 with 0 Axe violations;
- public search/filter: passed with 0 Axe violations;
- checkout recovery: 4/4;
- order tracking: 4/4;
- bounded synthetic performance: 64/64 requests, p95 **83.24 ms**, `productionSla: false`.

Evidence artifact: 45 files, 1,465,761 bytes, ID `8828703975`, SHA-256 `ccd4c0ef2a83ac51711062e7e816f1a2b06abb6f33ef2d892ddfe6b63be7a15a`.

No blocker was resolved or activated by this checkpoint.

## H7-DEPENDENCY-GATE-08 — complete and verified

Verified implementation head: `88a38c35e4b18dc254176c2729c030678716b5fd`

Strengthened isolation head: `f06d350d109c5161b03ed26dba852914a6f116f1`

Storefront CI: `30753736803`

Checkpoint receipt: `docs/architecture/storefront/h7-dependency-gate-checkpoint.md`

`modules/storefront/src/dependency-activation.ts` formalizes protected-surface requirements so partial dependency delivery cannot be mistaken for permission to activate a live surface. Checkout requires #97 + #98 + #100 together, buyer return/support requires #101 + #102, private reads require #101, domain provider activation requires #104, distributed abuse enforcement requires #107 and the operational sink requires #108.

Unknown issue numbers cannot substitute for a known blocker. Static integration-acceptance tests also prove `dependency-activation` and its evaluator/assertion helpers are not imported or invoked by the live API root or buyer runtime.

Exact strengthened CI `30753736803` passed all five lanes:

- verify `91512213388` — passed;
- PostgreSQL `91512301655` — passed;
- browser/accessibility/performance `91512301671` — passed;
- Cloudflare `91512301660` — passed;
- Neon recovery `91512301823` — passed.

Browser evidence: Astro 27/0/0/0; buyer 5/5 across 4 locales with one low-bandwidth scenario; admin 4/4; public content/catalog/discovery/search passed with discovery/search Axe 0; checkout recovery 4/4; order tracking 4/4; bounded synthetic performance 64/64 at p95 **59.76 ms**, not a production SLA.

Artifact ID `8835292030`, SHA-256 `71866e18b9baae63e2be69f4e71554acf506d5df5c9c619bf510a178573b9e0e`.

## H7-DEPENDENCY-EVIDENCE-09 — complete and verified

Verified implementation head: `8b44f666a42fc50aaec1333b22a5b5eee678165e`

Storefront CI: `30755307713`

Checkpoint receipt: `docs/architecture/storefront/h7-dependency-evidence-checkpoint.md`

The dependency evaluator no longer accepts issue numbers alone. Each claimed verified blocker must carry a strict `StorefrontDependencyVerificationEvidenceV1` record with:

- the exact known issue number;
- integration target `program/integration-v1`;
- owner delivery commit SHA;
- serial integration commit SHA;
- storefront verification commit SHA;
- positive safe-integer Storefront CI run ID.

Commit identities are lowercase 40-character hexadecimal SHAs. Wrong integration targets, malformed/uppercase SHAs, invalid run IDs, duplicate blocker records and arbitrary extra metadata fail closed. The evidence parser rejects unknown fields so provider tokens, credentials or free-form metadata cannot be attached to the release-evidence envelope.

Tests prove issue-number-only evidence is rejected, every required blocker needs a structured evidence record, partial checkout/return sets remain denied, and the assertion helper succeeds only after the complete structured evidence set exists.

Exact CI `30755307713` passed all five lanes:

- verify `91516334537` — passed;
- browser/accessibility/performance `91516418078` — passed;
- PostgreSQL `91516418084` — passed;
- Cloudflare `91516418089` — passed;
- Neon recovery `91516418225` — passed.

Browser evidence:

- Astro check: 27 files, 0 errors, 0 warnings, 0 hints;
- buyer: 5/5 across 4 locales with one low-bandwidth scenario;
- admin: 4/4;
- public content: 3/3;
- public catalog: 3/3;
- public discovery: 3/3 with 0 Axe violations;
- public search/filter: passed with 0 Axe violations;
- checkout recovery: 4/4;
- order tracking: 4/4;
- bounded synthetic performance: 64/64 requests, p95 **78.29 ms**, not a production SLA.

Evidence artifact: 45 files, ID `8835762297`, SHA-256 `8a565bb53121a790754b6568b2f2701be09e26fa7c61c009af1230cee815e443`.

No blocker was resolved or activated by either dependency hardening checkpoint.

## Machine tracker and handoff

`docs/architecture/storefront/status.yaml` preserves a large H0–H3 historical evidence ledger. Repository tooling exposes whole-file replacement rather than a safe semantic partial patch for this tracker; historical evidence must not be truncated merely to advance the newest H7 slice.

Current verified state is therefore also recorded in:

- `docs/architecture/storefront/h7-integration-readiness-checkpoint.md`;
- `docs/architecture/storefront/h7-dependency-gate-checkpoint.md`;
- `docs/architecture/storefront/h7-dependency-evidence-checkpoint.md`;
- `docs/agent-handoffs/MOD-H-STOREFRONT-COMMERCE-PROGRESS.md`;
- draft PR #48.

## Current blockers

- #97 — lossless MOD-A price/tax + MOD-C pre-order shipping/rate;
- #98 — MOD-E side-effect-free public payment capability;
- #100 — MOD-F typed checkout country/address/contact policy;
- #101 — trusted session-to-canonical-customer binding + storefront-scoped MOD-C order reads;
- #102 — buyer-safe idempotent return/support request capability;
- #104 — trusted custom-hostname provider transport/lifecycle feeding the verified domain bridge;
- #107 — actual distributed storefront abuse/rate-limit runtime feeding the verified abuse bridge;
- #108 — approved shared operational telemetry sink feeding the verified privacy-safe sink bridge.

Latest dependency re-check found no owning-module/shared-runtime delivery ahead of `program/integration-v1` for these blockers. MOD-C, MOD-E, MOD-F and MOD-G/shared branches are all ahead 0 relative to the approved integration target.

## Remaining H7/final work

Blocker-independent H7 technical hardening is complete. Remaining implementation work is dependency-driven:

1. serially integrate concrete owner deliveries through `program/integration-v1`;
2. require structured delivery/integration/verification evidence for every blocker before activation;
3. keep each dependent surface fail closed until its acceptance manifest entry is satisfied;
4. run negative authority/scope/stale/retry/idempotency/privacy tests before registration;
5. run fresh root/PostgreSQL/browser/Cloudflare/Neon evidence on each exact activation head;
6. replace the progress handoff with a final completion receipt only when all MOD-H completion gates pass.
