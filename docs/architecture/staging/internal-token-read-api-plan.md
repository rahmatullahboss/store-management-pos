# Internal token and protected read API plan

Status: active
Date: 2026-07-30
Branch: `ops/persistent-admin-pos-staging-v1`
Depends on: `usable-release-candidate-checkpoint.md`
Target: dedicated synthetic staging only

## Goal

Move the usable Admin/POS release candidate from direct server-side presentation reads to the same request-context and module-handler boundary used by protected business APIs, without weakening the production OIDC verifier.

## Security boundary

- The existing production verifier remains RS256/JWKS based and continues to enforce issuer, audience, expiry, maximum token age, MFA evidence, session identity and database revocation state.
- No production verifier fallback to development tokens is allowed in staging or production.
- The staging Worker may inject a dedicated verifier dependency only for requests that it creates internally after validating the custom session and resolving database authorization context.
- The browser never supplies tenant IDs, role codes, permissions, store, warehouse or register scope.
- The internal token is short-lived, audience-bound, tamper-evident and contains only database-resolved claims.
- Every token verification rechecks the active custom session and current database-resolved authorization context so logout, expiry, membership suspension and role removal fail closed.
- Internal token material is not persisted in cookies, HTML, screenshots, reports or artifacts.

## Initial protected reads

1. Inventory availability for the authenticated warehouse.
2. Inventory balance summary and low-stock exceptions.
3. Procurement supplier and open purchase-order overview.
4. Tenant/store/register context discovery.

The UI may continue using existing server-rendered views while the deployment evidence proves that the protected module APIs return the same tenant-scoped data.

## Implementation outline

1. Add an explicit optional `TokenVerifier` dependency to the API environment. Production creates the current OIDC verifier unless a trusted in-process verifier is supplied.
2. Create a staging-only compact token issuer/verifier using a Cloudflare secret, strict issuer/audience, a maximum five-minute lifetime, unique token ID and constant-time signature comparison.
3. Resolve the custom session and database role context before issuing the token.
4. Convert a first-party `/api/*` request into an internal Bearer request and pass an injected verifier into the existing API Worker.
5. Add narrowly scoped protected read endpoints only where existing inventory/procurement handlers do not already expose the required read model.
6. Prove anonymous, tampered, expired, revoked, inactive-membership and cross-tenant requests fail closed.
7. Keep every mutation, payment, accounting, banking, fiscal and destructive route unavailable from the staging browser.

## Acceptance gates

- production OIDC code and default behavior remain unchanged;
- custom session is required before any internal token is issued;
- internal token lifetime is at most five minutes;
- issuer and audience are exact;
- signature verification is constant-time and rejects tampering;
- user, tenant, permissions and resource scope match a fresh database context;
- expired/revoked/inactive/cross-tenant requests fail with bounded 401/403 responses;
- inventory and procurement reads execute through `buildRequestContext` and existing module handlers;
- no write/manage/approve/execute permission appears in the token;
- browser and artifacts contain no token or signing secret;
- exact-head repository, staging, design and preview workflows pass.

## Deferred

- production asymmetric signing key and JWKS lifecycle;
- MFA enrollment and privileged step-up;
- authoritative commands;
- payment, refund, journal, banking and fiscal actions;
- production domain, backup, monitoring and launch approval.
