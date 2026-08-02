# H7-INTEGRATION-READINESS-07 — Verified Checkpoint

Status: **complete and verified; all external authority/runtime dependencies remain blocked until owner delivery**

Verified implementation head: `4d4b48ee6f882ed40a067676f5dba7a8e013f49b`

Storefront CI: `30733358590`

Integration target: `program/integration-v1`

## Delivered

This checkpoint makes the remaining MOD-H integration gate explicit without activating any blocked commerce, customer, provider, abuse-control or telemetry surface.

Added:

- `docs/architecture/storefront/dependency-integration-acceptance.json` — machine-readable blocker/owner/boundary/activation/evidence manifest;
- `docs/architecture/storefront/dependency-integration-acceptance.md` — human serial-integration and activation instructions;
- `tests/unit/storefront-dependency-integration-acceptance.test.mjs` — executable guard that the manifest remains blocker-complete, repository-owned and fail closed.

The manifest covers exactly Issues `#97`, `#98`, `#100`, `#101`, `#102`, `#104`, `#107` and `#108`. Every entry has `activationAllowed: false` until its owning capability is serially integrated and reverified.

## Acceptance safety

The executable gate proves:

1. all eight current external blockers are present exactly once;
2. every integration boundary points to an existing repository-owned MOD-H/API path;
3. the verified domain/abuse/telemetry bridge paths are assigned only to their respective owners;
4. dependency documentation does not itself authorize route/provider activation;
5. live API/buyer roots still do not import cart quote, checkout capability, private customer account, domain provider, distributed abuse-provider or operational-sink bridges.

The human instructions require owner delivery into the approved serial integration target before MOD-H wiring, prohibit arbitrary `main` merges and browser/provider authority synthesis, and require negative scope/stale/retry/idempotency/privacy evidence plus fresh exact-head Storefront CI before any route/provider registration.

## Exact CI evidence

Run `30733358590`, latest successful attempt:

- verify `91457708872` — **passed**;
- PostgreSQL 17 rehearsal `91457709078` — **passed**;
- browser/accessibility/performance `91457709262` — **passed**;
- Cloudflare preview/runtime/cleanup `91457722062` — **passed**;
- non-destructive Neon recovery `91457708663` — **passed** after targeted rerun of an earlier concurrency cancellation.

Browser evidence at this exact head:

- Astro check: 27 files, 0 errors, 0 warnings, 0 hints;
- buyer evidence: 5/5 across 4 locales with one low-bandwidth scenario;
- admin evidence: 4/4;
- public content: 3/3;
- public catalog: 3/3;
- public discovery: 3/3 with 0 Axe violations;
- public search/filter: passed with 0 Axe violations;
- checkout recovery: 4/4;
- order tracking: 4/4;
- bounded synthetic performance: 64/64 requests, p95 **83.24 ms**;
- performance evidence explicitly remains `productionSla: false`.

Evidence artifact:

- 45 files;
- 1,465,761 bytes;
- artifact ID `8828703975`;
- SHA-256 `ccd4c0ef2a83ac51711062e7e816f1a2b06abb6f33ef2d892ddfe6b63be7a15a`.

## Current blockers

- #97 — lossless MOD-A price/tax + MOD-C pre-order shipping/rate;
- #98 — MOD-E side-effect-free public payment capability;
- #100 — MOD-F typed checkout country/address/contact policy;
- #101 — trusted session-to-canonical-customer binding + storefront-scoped MOD-C order reads;
- #102 — buyer-safe idempotent return/support request capability;
- #104 — trusted Cloudflare custom-hostname transport/lifecycle feeding the verified domain bridge;
- #107 — actual distributed abuse/rate-limit runtime feeding the verified abuse bridge;
- #108 — approved shared telemetry sink feeding the verified privacy-safe sink bridge.

## Activation posture

No blocker was resolved by this checkpoint. Public quote/checkout submission, private customer/order routes, tenant provider verification/certificate transitions, distributed abuse enforcement and operational sink delivery remain deliberately unregistered or fail closed.

The next implementation checkpoint must be triggered by a concrete owning-module/shared-runtime delivery through `program/integration-v1`; MOD-H must not invent that missing authority locally.
