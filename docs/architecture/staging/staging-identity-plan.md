# Staging identity and controlled-write plan

Status: read-only identity complete; token exchange active
Depends on: `persistent-admin-pos-staging-checkpoint.md`
Verified checkpoint: `staging-identity-checkpoint.md`

## Goal

Add a real staging login and authenticated API smoke path without weakening the production OIDC, tenant, permission, MFA, revocation or audit boundaries.

## Provider

Neon Auth is provisioned only on the dedicated staging Neon project and branch:

- project: `morning-flower-46531465`;
- branch: `br-empty-sound-afkx5vkj`;
- database: `neondb`;
- trusted browser origin: the persistent staging Workers URL only.

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

1. Neon Auth authenticates the staging user and creates a provider session. **Complete.**
2. The staging Worker validates the provider session against the branch-local Auth service. **Complete.**
3. The Worker resolves the provider subject to a dedicated synthetic platform user. **Pending.**
4. Tenant membership, role grants and resource scope are loaded from the staging database. **Pending.**
5. A short-lived internal staging access token is issued with the claims required by the existing API verifier. **Pending.**
6. The signing private key exists only in Cloudflare secrets; the public key is exposed through a staging-only JWKS endpoint. **Pending.**
7. The browser stores only an HttpOnly, Secure, SameSite session cookie. **Complete.**
8. `/api/*` converts the validated staging session to the existing Bearer contract internally. **Pending.**
9. Logout revokes the staging session; existing database revocation checks remain effective. **Provider logout complete; internal token revocation pending.**

## Completed read-only identity journey

- first-party sign-up, sign-in, session and sign-out routes;
- anonymous Admin/POS redirect to login;
- authenticated Admin and POS presentation;
- Secure, HttpOnly, SameSite=Lax host-local session cookie;
- trusted-origin and Fetch Metadata protection;
- real mobile login, desktop Admin, mobile POS and logout browser evidence;
- zero Axe violations and zero horizontal overflow failures;
- random synthetic account creation and cascade cleanup;
- no credential persistence in source, logs, screenshots, reports or artifacts.

## Test users

- No password, recovery secret, OAuth credential or private signing key may be committed.
- Test accounts use clearly synthetic addresses and names.
- Automated credentials exist only in workflow memory and are deleted with the synthetic account after evidence collection.
- A future retained human test user must receive credentials through a separately controlled secret channel, not a public artifact.
- The first mapped user receives only the minimum permissions needed for selected smoke journeys.

## Next authenticated journeys

- read current tenant/store context through the strict business API;
- read inventory availability for the synthetic store;
- read procurement overview;
- open the POS register context through mapped internal scope;
- execute one low-risk, idempotent synthetic command only after rollback/reversal and audit evidence are defined.

Payments, captures, refunds, journal posting, period close, bank reconciliation, fiscal submission and destructive operations remain outside the first controlled-write milestone.

## Remaining acceptance gates

- provider subject cannot inject internal tenant IDs or permissions;
- inactive memberships and revoked sessions fail closed;
- internal access tokens are short-lived, audience-bound and MFA-policy compliant;
- unauthorized, expired and cross-tenant calls return bounded failures;
- authenticated business reads pass in a real browser;
- any controlled write is idempotent, audited and reversible;
- secrets do not appear in repository files, logs, screenshots or artifacts.

## Provider decision

Neon Auth is accepted as the staging browser identity and session provider. It is not accepted as the business authorization authority. A local server-side subject mapping and token exchange must enforce the existing internal contract. The production verifier will not be loosened to accommodate staging.
