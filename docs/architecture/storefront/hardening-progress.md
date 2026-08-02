# MOD-H H7 Hardening Progress

Status: **active with external runtime blockers**

Completed slices: `H7-CACHE-ISOLATION-01`, `H7-ABUSE-CONTRACT-02`, `H7-OBS-RUNBOOK-03`, `H7-FAIL-CLOSED-MATRIX-04`, `H7-PERF-CACHE-05`

Latest fully verified implementation head: `8666a1440d5139a132c5028f3b64ad0912855eaf`

Latest fully verified Storefront CI: `30726322406`

## Objective

Close storefront hardening gates without inventing runtime authority outside MOD-H. H7 covers cache isolation/invalidation, abuse controls, privacy-safe observability, fail-closed release safety, bounded performance evidence, recovery/runbooks and final handoff readiness.

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

Provider-independent hardening provides:

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

Added strict `storefront-operational-event.v1` in `modules/storefront/src/observability.ts` with bounded cache/public-host/private-access/abuse/domain/checkout taxonomy and no free-form metadata.

Strict tests reject customer/contact data, hostnames, raw IP/forwarding headers, abuse keys, provider IDs/challenges, payment IDs, warehouse/reservation authority, R2 object keys/private paths, staff/internal metadata and arbitrary high-cardinality labels.

`docs/architecture/storefront/operations-runbook.md` covers public-host/domain failures, cross-tenant cache contamination, private account/order anomalies, checkout guard failure, abuse-provider failure, domain ambiguity, Cloudflare preview/runtime cleanup, PostgreSQL/Neon recovery and buyer return/support boundaries.

Issue #108 tracks the approved shared telemetry sink. MOD-H does not create an ad-hoc logger or permit the future sink to widen the validated envelope.

Verified head: `a4030ef44814b740538bb3d8a2b7a192bf44ba2a`

Storefront CI: `30724857648`

## H7-FAIL-CLOSED-MATRIX-04 — complete and verified

Added `tests/unit/storefront-fail-closed-release-matrix.test.mjs` as a blocker-aware release safety gate.

The gate proves:

- blocked cart quote, checkout capability/submit and private account handlers/routes remain absent from the API root router;
- buyer/runtime roots do not silently wire a fake abuse-control provider or ad-hoc observability sink;
- external provider verification/certificate requests are intercepted by the 503 domain-provider guard before domain command execution;
- the machine tracker explicitly keeps H4–H7 blockers and blocked states visible;
- relaxing a blocked route/provider requires an explicit code/test/tracker change rather than accidental import/registration.

The tracker assertion was made future-safe: it validates a non-H3 40-hex verified head instead of hardcoding one old H7 SHA.

Verified future-safe head: `7b858b601cc83fc7bd65d3847ebaa7d9e5998cdc`

Storefront CI: `30726144155` — all five Storefront lanes passed.

## H7-PERF-CACHE-05 — complete and verified

### Bounded local performance rehearsal

Added `tooling/scripts/storefront-performance-rehearsal.mjs` and wired it into Storefront browser evidence.

The rehearsal:

- uses only synthetic evidence routes and no customer/production data;
- warms English, Bengali, Arabic recovery and Japanese order-tracking evidence surfaces;
- executes 64 requests at concurrency 8;
- requires HTTP 200 + `text/html` + non-empty response <= 512 KiB;
- uses a deliberately generous local p95 gate <= 5000 ms;
- writes `docs/architecture/storefront/performance-evidence/report.json`;
- explicitly records `evidenceKind: bounded-local-rehearsal` and `productionSla: false`.

Verified run result: **64/64 requests passed, p95 86.31 ms**.

This evidence is a deterministic regression/load rehearsal, not a production latency/throughput SLA claim.

### Cache invalidation policy evidence

Strengthened `tests/integration/storefront-cache-family-rehearsal.sql` to verify both targeted generation advancement and reason→family fan-out:

- theme publish → `content`, `sitemap`;
- category publication → `catalog`, `category`, `search`, `sitemap`;
- collection publish → `catalog`, `collection`, `search`, `sitemap`;
- product publication → `catalog`, `product`, `category`, `collection`, `search`, `sitemap`, `media`;
- unknown reason → conservatively all nine cache families.

The rehearsal also proves targeted media invalidation increments media exactly once without changing catalog, idempotent replay stays single-effect, conflicting replay is rejected, audit/outbox/receipt evidence exists, and runtime cannot execute the internal cache-reason policy function.

### Exact verified evidence

Implementation head: `8666a1440d5139a132c5028f3b64ad0912855eaf`

Storefront CI: `30726322406`

Latest successful attempt jobs:

- verify `91439163345` — passed;
- PostgreSQL 17 rehearsal `91439153771` — passed;
- browser/accessibility + bounded performance `91439153689` — passed;
- Cloudflare preview/runtime/cleanup `91439153617` — passed after targeted rerun of an earlier transient local preview 502;
- non-destructive Neon recovery `91439153353` — passed after targeted rerun of the earlier concurrency-cancelled job.

No source guard, performance budget, or assertion was weakened to recover those external/transient jobs.

## Machine tracker and handoff

`docs/architecture/storefront/status.yaml` preserves historical H0–H3 evidence and tracks H4–H7 blocked/verified slices.

`docs/agent-handoffs/MOD-H-STOREFRONT-COMMERCE-PROGRESS.md` contains the verified checkpoint ledger, fail-closed matrix, blockers and serial integration rules.

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
