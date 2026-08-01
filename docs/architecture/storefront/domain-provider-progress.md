# MOD-H H6 Custom Domain Provider Progress

Status: **active, provider-blocked**

Current slice: `H6-PROVIDER-TRUST-01`

Latest fully verified implementation head: `1e56068eb924876754a97afa58935a4b92aa4157`

Storefront CI: `30723743976`

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
- External merchant/admin provider-observation endpoints now fail closed before command execution:
  - `POST /v1/storefront/domains/:id/verifications`
  - `POST /v1/storefront/domains/:id/transition`
- Both return HTTP `503` with `{ "error": { "code": "DOMAIN_PROVIDER_CONTROL_UNAVAILABLE" } }`.
- Responses are `no-store` and `nosniff`.
- Forged `resultStatus: verified`, provider reference, `certificateStatus: active`, provider hostname ID and canonical activation cannot reach the domain command service through the external handler.
- Existing internal MOD-H command/state-machine code remains available for a future trusted provider adapter; the security fix does not delete domain lifecycle capabilities.
- Unit tests prove domain registration still executes while forged provider verification/transition requests return 503 and leave the command call count unchanged.

## Verified evidence

Exact head `1e56068eb924876754a97afa58935a4b92aa4157`, Storefront CI `30723743976`:

- root format, lint, boundaries, TypeScript, database validation, complete test gate and security/dependency gates: **passed**;
- Astro Cloudflare build: **passed**;
- PostgreSQL 17 storefront migration/command rehearsal: **passed**;
- buyer/recovery/order-tracking/admin browser and accessibility evidence: **passed**;
- Cloudflare preview deploy, runtime metrics and cleanup: **passed**;
- non-destructive Neon recovery: **passed**.

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
- local public host resolution continues to require active + certificate-active state;
- no custom domain can be safely advanced to production-active through the external tenant API;
- provider mutation endpoints remain fail closed with 503.

## Next safe H6 slice

Build a provider-independent, read-only domain lifecycle/status projection for merchant/admin UX. It may explain local states such as verification pending, certificate pending, failed and suspended, but it must not expose provider secrets or add any action capable of asserting provider verification/certificate facts.
