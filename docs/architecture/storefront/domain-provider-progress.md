# MOD-H H6 Custom Domain Provider Progress

Status: **active, provider-blocked**

Completed slices: `H6-PROVIDER-TRUST-01`, `H6-DOMAIN-READ-02`, `H6-PROVIDER-BRIDGE-03`

Latest fully verified implementation head: `c52b688f28595cd41c5d735d038436670e638b68`

Storefront CI: `30727839962`

## Objective

Keep tenant/storefront domain registration and local lifecycle modelling available while ensuring that ownership verification, certificate state and provider identifiers can only originate from a trusted provider/control-plane integration.

A merchant/admin request may express domain intent. It must never manufacture provider-observed facts.

## Existing MOD-H foundation

The storefront domain foundation includes:

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
- public hostname resolution that requires active domain + active certificate + active storefront/channel binding and fails closed for stale/failed/suspended/deleting/deleted hosts.

## H6-PROVIDER-TRUST-01 — complete and verified

A trust-boundary defect was found in the original tenant/admin command path: body-supplied verification status, provider references, certificate status and provider hostname IDs could reach domain commands under tenant-facing domain management authority.

The external merchant/admin provider-observation endpoints now fail closed before command execution:

- `POST /v1/storefront/domains/:id/verifications`
- `POST /v1/storefront/domains/:id/transition`

Both return HTTP `503` with `DOMAIN_PROVIDER_CONTROL_UNAVAILABLE`, `no-store` and `nosniff` semantics. Domain registration intent remains available.

Forged `verified`, certificate `active`, provider IDs and canonical activation therefore cannot reach the domain command service through the tenant-facing API.

This slice was fully verified at exact head `1e56068eb924876754a97afa58935a4b92aa4157`, Storefront CI `30723743976`.

## H6-DOMAIN-READ-02 — complete and verified

Added a strict provider-independent read-only lifecycle projection in `modules/storefront/src/domain-lifecycle.ts`.

The safe snapshot contains only domain/storefront identity, normalized hostname, domain kind, local domain/certificate/verification status, canonical flag and update timestamp. Provider hostname IDs, provider references, challenge values/hashes and provider failure detail are rejected from this merchant/admin lifecycle view contract.

The projection derives only local read-only phases:

- `setup_pending`;
- `ownership_pending`;
- `certificate_pending`;
- `active`;
- `attention`;
- `suspended`;
- `removing`;
- `removed`.

An `active` phase requires local domain `active`, verification `verified` and certificate `active` simultaneously. Provider availability may change guidance only; it cannot change authority facts.

This slice was fully verified at exact head `f0ed777350cc67145381ec02911ea53e9ab72c4d`, Storefront CI `30723955210`.

## H6-PROVIDER-BRIDGE-03 — complete and verified; provider transport still blocked

Added `modules/storefront/src/domain-provider-bridge.ts` as a pure trusted-observation parser/mapper. It does **not** own Cloudflare credentials, network calls, webhook verification or provider polling.

### Trusted verification observation

`storefront-trusted-domain-verification-observation.v1` requires:

- source exactly `trusted-control-plane`;
- bounded opaque observation ID;
- canonical domain UUID;
- attempt 1..1000;
- bounded DNS/HTTP challenge metadata;
- SHA-256 challenge-value digest only, never raw challenge secret;
- explicit `pending | verified | failed | expired` verification state;
- optional bounded provider reference;
- observation/expiry timestamps with expiry strictly after observation.

The mapper produces existing internal `RecordDomainVerificationInput` with deterministic idempotency `domain-provider-verification:<observationId>`. `observedDetail` is fixed to `{ source, observationId }`; raw provider payload/detail cannot enter the command.

### Trusted lifecycle observation

`storefront-trusted-domain-lifecycle-observation.v1` requires:

- source exactly `trusted-control-plane`;
- bounded observation ID and domain UUID;
- normalized local domain and certificate states;
- optional bounded provider hostname ID;
- optional low-cardinality failure code;
- observation timestamp.

Important invariants:

- an `active` provider observation requires certificate `active` and a provider hostname ID;
- a `failed` observation requires a bounded low-cardinality failure code;
- raw failure detail/provider token/free-form metadata is rejected;
- provider observation cannot assert local `canonical` state;
- `canonical` is supplied separately as a local MOD-H fact and may be preserved only for an active trusted provider observation.

The mapper produces existing internal `TransitionDomainInput` with deterministic idempotency `domain-provider-lifecycle:<observationId>`.

### Public/tenant isolation

The fail-closed release matrix now statically proves that the trusted provider bridge and mapper functions are not imported by:

- `apps/api/src/index.ts`;
- `apps/api/src/modules/storefront/handler.ts`;
- `apps/storefront-web/src/runtime.ts`.

The bridge therefore cannot become an accidental tenant/public route. External provider verification/certificate mutation remains 503 until Issue #104 supplies the approved trusted transport/control-plane integration.

### Exact verified evidence

Implementation head: `c52b688f28595cd41c5d735d038436670e638b68`

Storefront CI: `30727839962`

- verify `91442940083` — **passed**;
- PostgreSQL 17 rehearsal `91442990684` — **passed**;
- buyer/admin browser, accessibility and bounded performance `91442990692` — **passed**;
- Cloudflare preview/runtime/cleanup `91442789500` — **passed**;
- non-destructive Neon recovery `91442990854` — **passed** after targeted rerun of the earlier concurrency-cancelled job.

No public provider route was enabled and no provider/runtime authority was moved into MOD-H.

## Provider blocker

Issue #104 remains open because the trusted transport/provider capability still has to own:

1. Cloudflare custom-hostname creation;
2. DNS/HTTP ownership challenge material and secure provider interaction;
3. ownership verification observation;
4. certificate pending/active/expiring/failed/revoked observation;
5. provider hostname identifiers;
6. suspension/deletion/offboarding reconciliation;
7. ambiguous provider/network outcomes, retry/backoff and idempotency;
8. provider-secret redaction and audit/correlation evidence.

The existing integrated MOD-G release provides generic connector/webhook/credential infrastructure, but no storefront custom-hostname lifecycle authority was found. The bridge added here is therefore preparation for #104, not a replacement for it.

## Current safety posture

Until Issue #104 is resolved and integrated:

- merchant/admin may register domain intent but cannot assert it verified;
- merchant/admin cannot assert certificate activation or provider IDs;
- merchant/admin lifecycle projection remains read-only/provider-secret-free;
- local public host resolution still requires active + certificate-active state;
- trusted provider bridge remains unreachable from tenant/public roots;
- no custom domain can be safely advanced to production-active through the external tenant API;
- provider mutation endpoints remain fail closed with 503.

## Next work

Issue #104 is now integration-ready on the MOD-H side: a trusted control-plane implementation can feed the strict observation bridge without changing tenant/public contracts. Actual Cloudflare credentials/network/provider reconciliation must stay in the approved MOD-G/shared runtime authority, followed by conflict/takeover/certificate/offboarding tests and fresh exact-head Storefront CI.
