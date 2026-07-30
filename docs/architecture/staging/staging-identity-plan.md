# Staging identity and controlled-write plan

Status: active
Depends on: `persistent-admin-pos-staging-checkpoint.md`

## Goal

Add a real staging login and authenticated API smoke path without weakening the production OIDC, tenant, permission, MFA, revocation or audit boundaries.

## Provider

Provision Neon Auth only on the dedicated staging Neon project and branch:

- project: `morning-flower-46531465`;
- branch: `br-empty-sound-afkx5vkj`;
- database: `neondb`.

Neon Auth provides user and session authentication. It does not become the source of business permissions, tenant membership, store scope, warehouse scope, register scope or device authority.

## Required boundary

The existing production OIDC verifier requires:

- HTTPS issuer and JWKS;
- RS256 and an accepted JWT type;
- audience, expiry and maximum token age;
- UUID `tenant_id` and `user_id`;
- session ID;
- MFA evidence;
- revocation lookup;
- bounded permissions and optional legal-entity/store/warehouse/register/device scope.

A raw provider token must not be accepted merely because its signature is valid. Provider identity must be mapped to an internal platform user, active tenant membership, active role grants and approved staging scope.

## Adapter design

1. Neon Auth authenticates the staging user and creates a provider session.
2. The staging Worker validates the provider session against the branch-local Auth service.
3. The Worker resolves the provider subject to a dedicated synthetic platform user.
4. Tenant membership, role grants and resource scope are loaded from the staging database.
5. A short-lived internal staging access token is issued with the claims required by the existing API verifier.
6. The signing private key exists only in Cloudflare secrets; the public key is exposed through a staging-only JWKS endpoint.
7. The browser stores only an HttpOnly, Secure, SameSite session cookie.
8. `/api/*` converts the validated staging session to the existing Bearer contract internally.
9. Logout revokes the staging session; existing database revocation checks remain effective.

## Test users

- No password, recovery secret, OAuth credential or private signing key may be committed.
- Test accounts must use clearly synthetic addresses and names.
- Credentials are delivered through protected workflow outputs or a separately controlled secret channel, not public artifacts.
- The first user receives only the minimum permissions needed for the selected smoke journeys.

## First authenticated journeys

- sign in and sign out;
- read current tenant/store context;
- read inventory availability for the synthetic store;
- read procurement overview;
- open the POS register context;
- execute one low-risk, idempotent synthetic command only after its rollback/reversal and audit evidence are defined.

Payments, captures, refunds, journal posting, period close, bank reconciliation, fiscal submission and destructive operations remain outside the first controlled-write milestone.

## Acceptance gates

- Neon Auth is isolated to the dedicated staging branch;
- provider configuration and JWKS are recorded without secrets;
- provider tokens cannot inject tenant IDs or permissions;
- inactive memberships and revoked sessions fail closed;
- login cookie is HttpOnly, Secure and SameSite;
- internal access tokens are short-lived and audience-bound;
- unauthorized, expired and cross-tenant calls return bounded failures;
- an authenticated read journey passes in a real browser;
- any controlled write is idempotent, audited and reversible;
- secrets do not appear in repository files, logs, screenshots or artifacts.

## Decision gate after provider inspection

Neon Auth must first be provisioned and its issuer, JWKS algorithms, token/session APIs and claim surface inspected. If it cannot satisfy the adapter boundary without weakening MFA or permission controls, it will remain a browser identity provider and a local server-side token exchange will enforce the internal contract. The existing production verifier will not be loosened to accommodate staging.
