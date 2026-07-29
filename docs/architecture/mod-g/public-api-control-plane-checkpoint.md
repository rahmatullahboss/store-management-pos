# MOD-G Public API Control-Plane Checkpoint

**Checkpoint date:** 2026-07-29  
**Implementation head:** `b308f5f1653e9c6a41b6e10bab849a59866893ef`  
**Review PR:** `#45`  
**State:** active

## Scope completed

### API-client authorization contract

- Added strict API-client validation for identity, status, expiry, unique scopes and bounded per-minute limits.
- Added exact and namespace-wildcard scope matching without substring or prefix-confusion grants.
- Authorization fails closed for tenant/client mismatch, suspended or expired clients, missing scopes and mutation requests without idempotency metadata.
- Authorization returns only approved client metadata and never credential material.

### Rate-limit state machine

- Added deterministic per-tenant, per-client, per-minute rate-limit windows.
- Duplicate request IDs do not consume additional quota.
- Limits fail closed with explicit remaining/reset metadata.
- Window rollover is monotonic and rejects observations that precede the current window.

### Idempotency state machine

- Added exact SHA-256 request-hash validation and scoped idempotency records.
- New, in-progress, completed replay, failed and payload-conflict states are distinguished explicitly.
- Expired records can start a new bounded execution window.
- Completion preserves response status/body evidence; server failures are retained as failed rather than replayed as success.

### Pagination contract

- Added bounded page sizes, opaque cursor validation and deterministic sort-field validation.
- Safe camelCase, snake_case, dotted and descending sort names are supported.
- Duplicate/invalid sort fields and oversized pages fail closed.

### OpenAPI discovery

- Added unauthenticated, database-free discovery endpoints:
  - `GET /public/v1/openapi.json`
  - `GET /public/v1/capabilities`
- Published OpenAPI 3.1 metadata for API-key and OAuth2 client-credentials authentication, request tracing, idempotency, cursor pagination and rate-limit headers.
- Discovery is routed before database construction and OIDC tenant authentication, so it exposes no tenant data and remains available during database degradation.
- Responses include bounded caching, explicit API versioning and `nosniff` hardening.

## Verification

Exact implementation head `b308f5f1653e9c6a41b6e10bab849a59866893ef` passed:

- Foundation CI run `30479261530`;
- verify job `90668729127` with format, lint, boundaries, strict typecheck, build, secret scan, licence register, SBOM and dependency audit;
- `311/311` unit and architecture tests;
- MOD-G Neon complete-chain and deterministic replay job `90668845254`;
- Neon recovery job `90668845181`;
- Cloudflare preview, runtime metrics and cleanup job `90668845158`;
- Foundation Design CI run `30479261178`.

The test suite includes API scope/tenant denial, mutation idempotency, rate-limit duplicate/reset behavior, idempotency replay/conflict, pagination validation and discovery execution with an intentionally invalid database configuration.

## Preserved boundaries

- Existing internal OIDC-authenticated business routes are unchanged.
- No external API client is allowed to write authoritative module ledgers directly.
- No API key, OAuth secret or credential value is stored in the public API domain objects or discovery document.
- Discovery endpoints do not initialize the database or resolve tenant identity.
- Mobile application paths and branches were not modified.

## Next checkpoint

Add the persistent API-client/service-principal command layer, credential-reference verification adapters and scoped partner data routes. Then continue with concrete CSV/REST connectors, SaaS lifecycle orchestration and reporting/integration/SaaS administration web surfaces.
