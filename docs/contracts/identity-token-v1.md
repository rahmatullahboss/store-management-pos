# Identity Access Token Contract v1

The Foundation API accepts provider-issued asymmetric JWT access tokens through a provider-neutral OIDC/JWKS verifier.

## JOSE header

- `alg`: exactly `RS256` in v1. Algorithm selection is allowlisted and never inferred from a key.
- `kid`: required and resolved from the configured HTTPS JWKS endpoint.
- `typ`: exactly `at+jwt` or `JWT`.

## Required claims

- `iss`: exact configured issuer URL.
- `aud`: configured API audience, as a string or member of an array.
- `sub`: stable provider subject; retained as identity evidence and never treated as the internal database identifier.
- `user_id`: internal UUID for `platform.users.id`.
- `tenant_id`: internal tenant UUID.
- `exp`, `iat`; optional `nbf` is validated when present.
- `sid` or `jti`: stable session identifier used for revocation checks.
- `amr` containing `mfa`, or an `acr` value explicitly allowlisted by deployment configuration.

## Optional scoped claims

- `permissions`: permission-code array.
- `scope`: space-delimited permission codes; merged with `permissions`.
- `legal_entity_id`, `store_id`, `warehouse_id`, `register_id`, `device_id`, `impersonator_id`: UUID values.

## Validation and failure behavior

- Tokens larger than 16 KiB fail closed.
- Signature, issuer, audience, token type, algorithm, time, MFA, membership, session and device state are verified before a request context is created.
- JWKS fetches require HTTPS, reject redirects and use a bounded cache.
- Unknown keys, malformed claims, revoked sessions/devices and inactive memberships fail closed.
- Production does not fall back to the development token format when OIDC configuration is missing.

Breaking changes require a new contract version and ADR review.
