# MOD-G API Client Credentials Checkpoint

**Date:** 2026-07-30  
**Branch:** `module/reporting-integrations-saas-v1`  
**Migration:** `INT-0003-api-client-credentials.sql`

## Scope

This checkpoint adds the persistent service-principal and API-client security layer required before partner data routes are exposed.

## Credential boundary

- Credential material is never stored in PostgreSQL, domain results, audit metadata, outbox payloads or diagnostics.
- PostgreSQL stores only a reference in the form `secret://namespace/resource`, `vault://namespace/resource`, `kms://namespace/resource` or `provider://namespace/resource`.
- References require a namespace and resource path so raw one-token API keys cannot be mistaken for a reference.
- Runtime verification delegates the secret comparison to an injected credential provider and fails closed when the provider is unavailable.
- Verification checks tenant, client, authentication mode, client status/expiry and credential status/validity before the external provider is invoked.

## Persistent command layer

`INT-0003` adds:

- API-client request idempotency, request-hash evidence and credential versioning;
- append-only `integration.api_client_security_events` with forced tenant RLS;
- `integration.register_api_client`;
- `integration.rotate_api_client_credential`;
- `integration.change_api_client_status`.

The commands use tenant-context checks, optimistic versions, advisory locks, replay conflict detection, explicit runtime execute grants and transactional audit/outbox evidence. Revocation is terminal. Rotation requires a new external reference and the exact current credential version.

## Domain layer

`modules/integrations/src/credentials.ts` provides:

- external credential-reference validation;
- versioned active/retired/revoked bindings;
- fail-closed credential verification through a provider port;
- deterministic credential rotation that retires the prior binding and increments the version;
- bounded verification decisions that never echo presented credentials or secret references.

## Security invariants

1. No raw API key, OAuth client secret, access token or credential value is persisted.
2. Invalid tenant/client/authentication bindings are rejected before calling the secret provider.
3. Suspended, revoked, expired, retired or not-yet-valid credentials cannot authenticate.
4. Provider errors produce `credential_unavailable`, not permissive fallback.
5. Runtime roles cannot directly insert, update or delete API-client security evidence.
6. Every create, rotation and status transition is idempotent, auditable and emitted through the transactional outbox.

## Verification coverage

- unit tests cover external-reference enforcement, tenant-bound verification, provider failure and versioned rotation;
- architecture tests validate migration checksum/order, forced RLS, append-only evidence, command-only runtime access and absence of secret-value columns;
- the assigned MOD-G Neon rehearsal applies the complete migration chain and repeats it to prove deterministic replay.
