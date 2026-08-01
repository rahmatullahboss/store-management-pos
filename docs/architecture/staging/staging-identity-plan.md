# Staging identity and controlled-write plan

Status: custom read-only identity complete; business authorization pending
Depends on: `persistent-admin-pos-staging-checkpoint.md`
Verified checkpoint: `staging-identity-checkpoint.md`

## Goal

Provide first-party account creation, login and session management for the persistent staging web software without weakening the production OIDC, tenant, permission, MFA, revocation or audit boundaries.

## Provider decision

The staging browser no longer depends on Neon Auth or another external identity provider. Ozzyl custom authentication runs inside the existing Cloudflare Worker and stores only controlled authentication state in the dedicated staging PostgreSQL database:

- project: `morning-flower-46531465`;
- branch: `br-empty-sound-afkx5vkj`;
- database: `neondb`;
- browser host: the persistent staging Workers URL.

The legacy `neon_auth` schema is removed during persistent staging deployment after the custom migrations are verified.

## Custom authentication design

1. Account creation validates normalized email, display name and password length at the Worker and database boundaries.
2. `platform.custom_auth_register` creates the internal platform user, bcrypt credential, active synthetic-tenant membership, initial session and audit event atomically.
3. Passwords are hashed in PostgreSQL with `pgcrypto` bcrypt cost 12; plaintext passwords are never stored.
4. The browser receives a 32-byte opaque random session token in a host-only `Secure`, `HttpOnly`, `SameSite=Lax` cookie.
5. PostgreSQL stores only the SHA-256 token hash, not the plaintext session token.
6. Sessions expire after eight hours and can be revoked explicitly on logout.
7. Active session resolution requires an active user, active tenant and active membership.
8. Login failures are rate-limited by hashed email/IP key; repeated user failures cause a 15-minute credential lock.
9. Authentication events record sign-up, sign-in, sign-out, rejected and blocked outcomes without credentials.
10. Exact-origin and Fetch Metadata checks reject cross-site form posts. Opaque or omitted Origin is accepted only with `Sec-Fetch-Site: same-origin`.

## Preserved business authority boundary

A valid custom browser session currently permits only read-only synthetic Admin and POS presentation. It does not grant:

- business API bearer authority;
- role or permission grants;
- MFA evidence;
- legal-entity, store, warehouse, register or device scope;
- payment, order, inventory, accounting, banking or fiscal authority.

The production OIDC verifier remains strict. Protected `/api/*` business routes still fail closed until a server-side role/scope resolver and short-lived internal business token are implemented.

## Completed read-only journey

- first-party `/login`, `/auth/sign-up`, `/auth/sign-in`, `/auth/session` and `/auth/sign-out` routes;
- anonymous Admin/POS redirect to login;
- authenticated Admin and POS presentation;
- secure host-only session cookie;
- real signup and login through the Cloudflare Worker;
- Neon HTTP-driver registration and login preflight;
- mobile login, desktop Admin, mobile POS and logout browser evidence;
- zero Axe violations and zero page-level horizontal overflow failures;
- random synthetic account creation and deterministic cleanup;
- no credential persistence in source, logs, screenshots, reports or artifacts.

## Migrations

- `FND-0006-custom-auth.sql`: credentials, sessions, rate limits, auth events and initial custom auth functions;
- `FND-0007-custom-auth-login-fix.sql`: qualified login function references and deterministic login behavior.

Applied migration files are immutable. The login correction is a separate migration rather than an edit to the already-applied FND-0006.

## Test accounts

- Automated credentials exist only in workflow memory.
- Test addresses use the `staging-smoke-* @example.com` pattern.
- The user, membership, credentials and sessions are deleted after evidence collection.
- Human staging users may create their own staging-only credentials on the login page.
- Production passwords must not be reused.

## Next authenticated journeys

- resolve minimum role grants for the internal staging user and active membership;
- issue an audience-bound, short-lived internal business token;
- prove inactive membership, revoked session, expired token and cross-tenant failures;
- read tenant/store context, inventory availability and procurement overview through the strict business API;
- enable one low-risk, idempotent and reversible synthetic command with audit and outbox evidence.

Payments, captures, refunds, journal posting, period close, bank reconciliation, fiscal submission and destructive operations remain outside the first controlled-write milestone.
