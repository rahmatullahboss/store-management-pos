# MOD-G Partner API Routes Checkpoint

**Checkpoint date:** 2026-07-30  
**Branch:** `module/reporting-integrations-saas-v1`  
**Review PR:** `#45`

## Scope completed

The public partner API now exposes implemented, tenant-scoped reporting and webhook operations rather than discovery metadata only:

- `GET /public/v1/reporting/metrics`
- `POST /public/v1/reporting/queries`
- `POST /public/v1/reporting/exports`
- `GET /public/v1/reporting/exports/{exportId}`
- `GET /public/v1/integrations/webhook-deliveries`
- `POST /public/v1/integrations/webhook-deliveries/{deliveryId}/replay`

The OpenAPI 3.1 document contains every implemented operation, required headers, authentication alternatives, scopes, cursor pagination, idempotency requirements, response schemas and standard problem responses.

## Authentication boundary

`INT-0004` adds an explicit pre-authentication directory function. It returns only the API-client identity, service-principal identity, scopes, status, expiry, rate limit and external credential reference required to perform credential verification.

The directory function:

- is `SECURITY DEFINER`;
- is revoked from `PUBLIC`;
- is executable only by `store_app_runtime`;
- accepts an exact tenant, client and authentication mode;
- never returns a raw API key, OAuth secret or tenant business record.

API-client credentials continue to live behind `secret://`, `vault://`, `kms://` or `provider://` references. If the credential-verification or rate-limit binding is unavailable, the public API fails closed with `503`.

## Authorization and isolation

After credential verification:

1. the API-client service user becomes the audited actor;
2. a normal repository `RequestContext` is created;
3. `platform.set_request_context` establishes tenant RLS inside the database transaction;
4. the operation checks its explicit client scope before executing its business query or command.

Implemented scopes:

- `reporting.metrics.read`
- `reporting.exports.write`
- `reporting.exports.read`
- `integration.webhook.read`
- `integration.webhook.manage`

No public route bypasses the module command layer for mutations. Export requests call `reporting.request_export`; webhook replay calls `integration.request_webhook_replay`. Both preserve database idempotency, audit and outbox evidence.

## Information disclosure controls

- Webhook delivery responses exclude payloads, signatures and signing-key references.
- Export status does not expose an internal R2 object reference.
- Authentication failures return one generic client error and do not reveal tenant, client, status, expiry or credential-match details.
- Scope denial occurs before a reporting or integration business query executes.
- Cursor tokens contain only normalized opaque UUID material and are bounded before database use.

## Verification

Implementation checkpoint `13ed32f3ec8c1f92f9f9bc5e86ff08f043113acb` passed Foundation verification with `319/319` tests. Added behavioural evidence covers:

- successful credential verification before tenant transaction creation;
- service-principal actor and tenant context propagation;
- scope denial before business-row access;
- fail-closed unavailable credential services;
- required mutation idempotency;
- accepted asynchronous export commands;
- complete OpenAPI operation coverage.

The same checkpoint passed the complete MOD-G Neon migration chain and deterministic replay with `INT-0004` included. Final documentation-only head is revalidated through the standard core, Design, Neon recovery and Cloudflare preview gates.

## Remaining MOD-G sequence

The next coherent checkpoint is the concrete connector layer:

1. generic CSV connector;
2. generic REST connector;
3. one launch-priority ecommerce adapter;
4. mapping, loop prevention, conflict reconciliation, outage and cursor recovery evidence.
