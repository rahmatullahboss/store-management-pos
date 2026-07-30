# Staging custom identity checkpoint

Status: custom read-only identity milestone complete
Verified implementation head: `c7d8822e580aa6fa41f7d6f12b69446ab6e68ae6`
Persistent URL: `https://store-pos-staging.rahmatullahzisan.workers.dev`

## Delivered

- Neon Auth dependency removed from the staging browser flow;
- legacy `neon_auth` schema removed from the dedicated staging database;
- first-party `/login`, `/auth/sign-up`, `/auth/sign-in`, `/auth/session` and `/auth/sign-out` routes;
- account creation writes an internal platform user, active synthetic-tenant membership, bcrypt credential, initial session and audit event atomically;
- password hashes use PostgreSQL `pgcrypto` bcrypt cost 12;
- plaintext passwords are never persisted;
- browser receives a 32-byte opaque random session token;
- database stores only the SHA-256 session-token hash;
- session cookie is host-only, `Secure`, `HttpOnly`, `SameSite=Lax` and expires after eight hours;
- active session resolution requires active user, tenant and membership records;
- repeated login failures are rate-limited and can lock credentials for 15 minutes;
- sign-up, sign-in, sign-out, rejected and blocked outcomes are captured in bounded auth events;
- exact-origin and Fetch Metadata checks reject cross-site and mismatched-origin form posts;
- opaque or omitted browser Origin is accepted only with `Sec-Fetch-Site: same-origin`;
- anonymous Admin and POS requests redirect to login;
- authenticated identity appears in Admin and POS staging notices;
- custom browser session does not bypass business API OIDC, permission, tenant, MFA or revocation boundaries;
- generated credentials never appear in source, logs, screenshots, reports or artifacts.

## Corrective findings

Two concrete failures were fixed while replacing the provider:

1. `@neondatabase/serverless` 1.1 conventional query calls require `sql.query(text, params)`. The shared foundation database adapter used the removed `sql(text, params)` form, causing Worker-side database routes to fail. `packages/foundation/src/db.ts` now uses the supported API for HTTP queries and transactions.
2. The initial custom login function had ambiguous output and table-column references. The already-applied FND-0006 migration was not edited; FND-0007 replaces the function with fully qualified references.

## Live journey verified

1. Anonymous `/admin` redirects to `/login`.
2. Login page loads on a 390 × 844 viewport.
3. A synthetic account is created through the Cloudflare Worker.
4. The account receives an internal platform user and active `synthetic-beta` membership.
5. The authenticated session endpoint returns the custom user and tenant context.
6. A clean browser signs in through the rendered email/password form.
7. Authenticated Admin inventory opens at 1440 × 900.
8. Authenticated POS register opens at 390 × 844.
9. Admin keyboard skip navigation reaches `#main`.
10. POS checkout remains disabled.
11. Browser sign-out revokes the session and returns to login.
12. The synthetic user, membership, credential and sessions are deleted after evidence collection.

## Exact evidence

Persistent Admin POS Staging workflow:

- exact implementation head: `c7d8822e580aa6fa41f7d6f12b69446ab6e68ae6`;
- deployed merge SHA reported by the artifact: `abffdfa45249c2662a629f648529aa636c6fcabe`;
- run: `30534575070`;
- job: `90844868908`;
- artifact: `8756134289`;
- artifact digest: `sha256:945727d700ec6fca9aa3155b69c5e2fd5cb4e66303da3443259d6fee79e85222`;
- registered migrations: `57`;
- synthetic platform tenants: `2`;
- custom auth tables: `4`;
- legacy Neon Auth tables: `0`;
- HTTP probes: `10/10`;
- browser scenarios: `3/3`;
- Axe violations: `0`;
- page-level horizontal overflow failures: `0`;
- browser signup: passed;
- browser login: passed;
- authenticated session probe: passed;
- browser logout: passed;
- synthetic account cleanup: passed;
- plaintext session token stored in database: false;
- credentials persisted in artifacts: false.

## Preserved business authority boundary

This checkpoint authenticates access to read-only synthetic Admin and POS browser surfaces. A custom browser session is not yet accepted as proof of:

- granted business permissions;
- MFA evidence;
- legal entity, store, warehouse, register or device scope;
- payment, order, inventory mutation, accounting, banking or fiscal authority.

The protected business API remains fail closed until server-side permission resolution and a short-lived internal business token are implemented.

## Next checkpoint

- resolve the authenticated internal user’s active role grants and resource scope;
- issue an audience-bound, short-lived internal token without accepting browser-supplied permissions;
- prove inactive membership, revoked session, expired token and cross-tenant failure behavior;
- enable authenticated read journeys for tenant/store context, inventory availability and procurement overview;
- enable one low-risk, idempotent and reversible controlled-write journey with audit and outbox evidence;
- keep payments, refunds, journals, period close, banking, fiscal submission and destructive operations disabled.
