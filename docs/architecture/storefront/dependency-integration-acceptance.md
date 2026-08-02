# MOD-H Dependency Integration Acceptance

Status: **active integration instructions — no blocked surface is authorized by this document**

Machine-readable companion: `docs/architecture/storefront/dependency-integration-acceptance.json`

## Purpose

This document defines how the remaining owning-module/runtime capabilities may be integrated into MOD-H without moving commerce, customer, provider or telemetry authority into the storefront module.

Every blocked surface remains fail closed until its owning capability exists on the approved serial integration target, the MOD-H boundary is connected without privilege synthesis, and a fresh exact-head Storefront CI passes.

## Serial integration rule

1. Integrate the owning-module/shared-runtime delivery into the approved `program/integration-v1` path first.
2. Rebase/merge MOD-H only through the approved serial integration process; do not merge arbitrary `main` into MOD-H.
3. Inspect the delivered contract before changing MOD-H. Do not infer missing fields from browser/provider configuration.
4. Connect only the existing verified MOD-H boundary or an additive versioned boundary.
5. Keep the route/provider registration fail closed while adapter tests are RED/GREEN locally or in CI.
6. Add cross-scope, stale/retry and negative authority tests before registration.
7. Register the surface only in the same coherent checkpoint that proves its owning capability and failure behavior.
8. Run root/source, PostgreSQL, browser/accessibility/performance, Cloudflare and Neon recovery gates on the exact activation head.
9. Update the progress handoff, PR and machine tracker without deleting historical evidence.

## Blocker acceptance matrix

### #97 — price/tax persistence and pre-order shipping

Owner: MOD-C with authoritative MOD-A input.

MOD-H must not flatten price/tax into a single basis-point value or manufacture shipping rates. Activation requires lossless price/tax semantics, MOD-C-owned shipping amount/expiry/revision, stale recovery, and retry/concurrency evidence showing no duplicate order, reservation, payment or ledger effects.

Blocked surfaces: public cart quote, checkout capabilities and checkout submit.

### #98 — public payment eligibility

Owner: MOD-E.

Eligibility discovery must be side-effect free. MOD-H must not create a payment intent merely to discover payment methods, expose provider account/configuration details, or infer payment availability from browser/provider configuration.

Blocked surfaces: checkout capabilities and checkout submit.

### #100 — typed country/address/contact policy

Owner: MOD-F.

MOD-H may render a typed versioned checkout policy but must not interpret arbitrary generic country-pack capability keys as checkout authority. Country-policy revision must participate in checkout freshness/recovery.

Blocked surfaces: checkout capabilities and checkout submit.

### #101 — trusted customer binding and scoped order reads

Owner: authentication/session boundary plus MOD-C.

The canonical customer must come from a trusted authenticated session mapping. Browser customer IDs remain prohibited. MOD-C order reads must be scoped and MOD-H must revalidate tenant, legal entity, store, customer, storefront and sales channel before projection.

Blocked surfaces: private profile, order history/detail and live private tracking routes.

### #102 — buyer return/support request

Owner: MOD-C.

Return/support eligibility and lifecycle remain owning-module policy. MOD-H may collect a buyer request but must not recreate refund, inventory, fulfilment or accounting authority. Duplicate submissions require an owning-module idempotency contract.

Blocked surfaces: buyer return and support mutations.

### #104 — custom-hostname provider lifecycle

Owner: MOD-G or approved shared Cloudflare control plane.

Provider observations must feed `domain-provider-bridge.ts`. Browser/tenant input cannot assert verification, certificate activation, provider hostname identifiers or canonical state. Conflict/takeover, suspension, deletion/offboarding and ambiguous provider outcomes require evidence before activation.

Blocked surfaces: tenant provider verification/transition and production custom-domain activation.

### #107 — distributed abuse/rate-limit runtime

Owner: MOD-G or approved shared edge runtime.

The runtime must feed `abuse-control-provider-bridge.ts`, preserve trusted-edge/authenticated-session opaque key provenance and share state across Worker isolates/regions. Route-specific fail-open/fail-closed semantics remain defined by MOD-H policy; a provider cannot widen them.

Blocked surface: live distributed abuse enforcement.

### #108 — approved operational telemetry sink

Owner: approved shared telemetry runtime.

The sink must consume only the existing validated privacy-safe event envelope through `operational-sink-bridge.ts`. No free-form metadata, customer/contact data, hostname/IP, abuse key, provider secret, payment authority or storage identifier may be added for convenience.

Blocked surface: live operational event delivery.

## Activation evidence checklist

For every dependency integration:

- delivered owner contract is versioned and documented;
- no browser-selected or MOD-H-synthesized authority is introduced;
- negative tests prove cross-tenant/customer/host/provider scope denial where applicable;
- stale revision/expiry behavior is explicit;
- ambiguous network/provider outcomes fail closed or recover according to owning-module policy;
- idempotency/retry behavior is proven for any side-effecting path;
- privacy-safe projection/redaction remains enforced;
- blocked route/provider is absent until the activation checkpoint;
- exact activation head passes all Storefront CI lanes;
- PR #48 remains draft until all workpack completion gates are satisfied.

## Current verified readiness

The latest fully verified implementation before this instruction document is `c5e6fa19db9494eb6e8b7970ee7e69db64986342`, Storefront CI `30732951052`.

At that head, MOD-H has verified pure integration bridges for #104, #107 and #108, but none are wired into public/tenant/live buyer roots. H4/H5 mutation/private activation remains blocked on #97/#98/#100/#101/#102.
