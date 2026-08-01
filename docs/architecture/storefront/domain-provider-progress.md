# MOD-H H6 Custom Domain Provider Progress

Status: **active, provider-blocked**

Completed slices: `H6-PROVIDER-TRUST-01`, `H6-DOMAIN-READ-02`

Latest fully verified implementation head: `f0ed777350cc67145381ec02911ea53e9ab72c4d`

Storefront CI: `30723955210`

## Objective

Keep tenant/storefront domain registration and local lifecycle modelling available while ensuring that ownership verification, certificate state and provider identifiers can only originate from a trusted provider/control-plane integration.

A merchant/admin request may express domain intent. It must never manufacture provider-observed facts.

## Existing MOD-H foundation

The storefront domain foundation already includes:

- tenant-scoped `storefront.domains` and append-only `storefront.domain_verifications`;
- domain states for pending, verification pending, certificate pending, active, suspended, failed, deleting and deleted;
- certificate states for none, pending, active, expiring, failed and revoked;
- platform subdomain and custom-domain kinds;
- canonical-domain flagging;
- audit/outbox effects for domain commands;
- RLS and tenant isolation;
- transition invariants, including completed verification + active certificate before local active state;
- deleted-domain non-reactivation and deleting-before-deleted rules;
- canonical selection only for active domains;
- public hostname resolution that requires active domain + active certificate + active storefront/channel binding and therefore fails closed for stale/failed/suspended/deleting/deleted hosts.

## Trust-boundary defect found

The existing merchant/admin command API exposed:

- `POST /v1/storefront/domains/:id/verifications`, accepting body-supplied verification result, challenge evidence, provider reference and observation timestamps;
- `POST /v1/storefront/domains/:id/transition`, accepting body-supplied domain status, certificate status, provider hostname ID and failure detail.

Both ultimately used the tenant-facing privileged `storefront.domain.manage` authority. Although SQL activation required a completed verification and active certificate, those provider facts themselves were client-assertable. A tenant/admin could therefore attempt to manufacture the facts required for activation.

This is not an acceptable ownership/certificate trust boundary.

## H6-PROVIDER-TRUST-01 — complete and verified

- Domain registration remains available through the tenant/admin API.
- External merchant/admin provider-observation endpoints fail closed before command execution:
  - `POST /v1/storefront/domains/:id/verifications`
  - `POST /v1/storefront/domains/:id/transition`
- Both return HTTP `503` with `{ "error": { "code": "DOMAIN_PROVIDER_CONTROL_UNAVAILABLE" } }`.
- Responses are `no-store` and `nosniff`.
- Forged `resultStatus: verified`, provider reference, `certificateStatus: active`, provider hostname ID and canonical activation cannot reach the domain command service through the external handler.
- Existing internal MOD-H command/state-machine code remains available for a future trusted provider adapter; the security fix does not delete domain lifecycle capabilities.
- Unit tests prove domain registration still executes while forged provider verification/transition requests return 503 and leave the command call count unchanged.

This slice was fully verified at exact head `1e56068eb924876754a97afa58935a4b92aa4157`, Storefront CI `30723743976`.

## H6-DOMAIN-READ-02 — complete and verified

Added a strict provider-independent read-only lifecycle projection in `modules/storefront/src/domain-lifecycle.ts`.

The input snapshot contains only local buyer/admin-safe domain facts:

- domain/storefront identity;
- normalized hostname and domain kind;
- local domain status;
- local certificate status;
- local verification status;
- canonical flag;
- update timestamp.

The parser rejects unsupported fields, including provider hostname IDs, provider references, challenge values/hashes and provider failure detail. Those values therefore cannot accidentally become part of the merchant/admin lifecycle view contract.

The projection derives only read-only local phases:

- `setup_pending`;
- `ownership_pending`;
- `certificate_pending`;
- `active`;
- `attention`;
- `suspended`;
- `removing`;
- `removed`.

An `active` phase requires all three local facts at once: domain status `active`, verification `verified`, and certificate `active`. Any missing/stale fact prevents active presentation.

Provider availability may change guidance only (`review_configuration`, `wait_for_provider`, `contact_support`, `none`); it cannot change domain/verification/certificate facts. No `mark verified`, activation, provider-ID or certificate mutation action exists in the lifecycle view.

Unit tests cover:

- strict provider/challenge/failure-field rejection;
- lifecycle phase derivation;
- active-state conjunction;
- provider-unavailable guidance;
- absence of activation/provider-authority fields in the output.

## Latest verified evidence

Exact head `f0ed777350cc67145381ec02911ea53e9ab72c4d`, Storefront CI `30723955210`:

- root format, lint, boundaries, TypeScript, database validation, complete test gate and security/dependency gates: **passed**;
- Astro Cloudflare build: **passed**;
- PostgreSQL 17 storefront migration/command rehearsal: **passed**;
- buyer/recovery/order-tracking/admin browser and accessibility evidence: **passed**;
- Cloudflare preview deploy, runtime metrics and cleanup: **passed**;
- Neon recovery initially concurrency-cancelled, then the exact cancelled job was targeted-rerun and the non-destructive recovery drill **passed**.

## Provider blocker

Issue #104 tracks the required trusted MOD-G/shared Cloudflare custom-hostname provider capability.

The trusted provider path must own/observe:

1. provider custom-hostname creation;
2. DNS/HTTP ownership challenge material;
3. ownership verification status;
4. certificate pending/active/expiring/failed/revoked status;
5. provider hostname identifiers;
6. suspension/deletion/offboarding reconciliation;
7. ambiguous provider/network outcomes, retry/backoff and idempotency;
8. provider-secret redaction and audit/correlation evidence.

Tenant/admin input must remain distinct from provider-observed facts.

## Current safety posture

Until Issue #104 has a concrete trusted provider adapter:

- merchant/admin can register a domain intent but cannot assert it verified;
- merchant/admin cannot assert certificate activation or provider identifiers;
- merchant/admin-facing lifecycle projection is read-only and provider-secret-free;
- local public host resolution continues to require active + certificate-active state;
- no custom domain can be safely advanced to production-active through the external tenant API;
- provider mutation endpoints remain fail closed with 503.

## Next safe work

Continue H7 blocker-independent hardening while Issue #104 is open: abuse/rate-limit coverage, multi-tenant/hostname cache isolation, observability/runbook evidence and final handoff preparation. Provider lifecycle mutation remains blocked until the trusted MOD-G/shared adapter exists.
