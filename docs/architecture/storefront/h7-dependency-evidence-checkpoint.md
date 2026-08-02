# MOD-H H7 Structured Dependency Evidence Checkpoint

Status: **complete and verified; external dependencies remain unresolved**

Slice: `H7-DEPENDENCY-EVIDENCE-09`

Exact verified implementation head: `8b44f666a42fc50aaec1333b22a5b5eee678165e`

Storefront CI: `30755307713`

## Purpose

Strengthen the previously verified dependency activation policy so an issue number by itself can never be treated as release-readiness evidence.

This checkpoint changes release policy only. It does not register any storefront route, activate checkout/private account/custom-domain/runtime surfaces, call a provider, create a commerce side effect or synthesize authority inside MOD-H.

## Structured verification evidence

`modules/storefront/src/dependency-activation.ts` now requires one strict `StorefrontDependencyVerificationEvidenceV1` record per claimed verified blocker.

Each record is bound to:

- the exact blocker issue number;
- integration target `program/integration-v1`;
- exact owner-delivery commit SHA;
- exact serial-integration commit SHA;
- exact storefront verification commit SHA;
- positive safe-integer Storefront CI run ID.

Commit identities must be lowercase 40-character hexadecimal SHAs. Unknown issue numbers, wrong integration targets, malformed or uppercase SHAs, invalid CI run IDs, duplicate evidence for the same blocker and arbitrary extra metadata all fail closed.

The parser rejects extra fields deliberately. Provider tokens, free-form provider data, credentials or unrelated metadata therefore cannot be smuggled into the release-evidence envelope.

## Activation behavior

The existing conjunctive dependency requirements remain unchanged:

- public cart quote: #97;
- checkout capabilities and submit: #97 + #98 + #100;
- private profile/order history/detail/tracking: #101;
- buyer return/support: #101 + #102;
- tenant domain verification/provider transition/custom-domain activation: #104;
- distributed abuse enforcement: #107;
- operational event sink: #108.

A protected surface may evaluate as ready only when every required blocker has a valid structured evidence record. Missing any required blocker still produces the exact missing issue set.

The activation evaluator remains statically excluded from the live API and buyer runtime by the previously verified integration-acceptance test. Structured evidence is therefore a release-review contract, not a runtime authority source.

## Tests

`tests/unit/storefront-dependency-activation.test.mjs` now proves:

1. issue numbers alone are rejected as activation evidence;
2. every protected surface denies with no structured evidence;
3. every protected surface requires evidence for every blocker in its conjunctive requirement set;
4. checkout still requires #97 + #98 + #100 together;
5. buyer return/support still requires #101 + #102 together;
6. unknown issue numbers cannot substitute for approved blockers;
7. `main` or any non-approved integration target is rejected;
8. short, uppercase or otherwise malformed commit SHAs are rejected;
9. zero, negative, fractional or unsafe Storefront CI run IDs are rejected;
10. duplicate issue evidence is rejected;
11. arbitrary metadata such as `providerToken` is rejected;
12. the assertion helper passes only after complete structured evidence exists.

## Dependency re-check

No new owning-module delivery was found during this checkpoint.

Relative to `program/integration-v1` at `fd63dfde4d5940112a9c77c2743b281e49ff6b55`:

- `module/customer-sales-fulfillment-v1`: ahead 0, behind 549;
- `module/payments-accounting-banking-v1`: ahead 0, behind 535;
- `module/localization-compliance-v1`: ahead 0, behind 130;
- `module/reporting-integrations-saas-v1`: ahead 0, behind 8.

The repository-wide blocker-capability PR search returned no owning delivery beyond MOD-H PR #48. Issues #97, #98, #100 and #101 were also re-read and remain open; no evidence was found that any of #97/#98/#100/#101/#102/#104/#107/#108 has been delivered through the approved serial integration path.

## Verification

Storefront CI `30755307713` passed all five lanes:

- verify `91516334537` — passed;
- browser/accessibility/performance `91516418078` — passed;
- PostgreSQL rehearsal `91516418084` — passed;
- Cloudflare preview/runtime/cleanup `91516418089` — passed;
- non-destructive Neon recovery `91516418225` — passed.

Browser evidence at this head:

- Astro: 27 files, 0 errors, 0 warnings, 0 hints;
- buyer: 5/5 scenarios across 4 locales with one low-bandwidth scenario;
- admin: 4/4;
- public content: 3/3;
- public catalog: 3/3;
- public discovery: 3/3 with 0 Axe violations;
- public search/filter: passed with 0 Axe violations;
- checkout recovery: 4/4;
- order tracking: 4/4;
- bounded synthetic performance: 64/64 requests, p95 **78.29 ms**, explicitly not a production SLA.

Evidence artifact:

- artifact ID: `8835762297`;
- files: 45;
- SHA-256: `8a565bb53121a790754b6568b2f2701be09e26fa7c61c009af1230cee815e443`.

## Safety result

No blocker was resolved by this checkpoint and no blocked surface was activated. Checkout mutations, private account/order routes, buyer return/support mutation, trusted domain-provider transitions, distributed abuse enforcement and telemetry sink delivery remain fail closed until their owning capabilities are delivered through `program/integration-v1`, reviewed, wired explicitly and reverified on a fresh exact head.
