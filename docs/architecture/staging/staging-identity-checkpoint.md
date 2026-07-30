# Staging identity checkpoint

Status: read-only identity milestone complete
Verified implementation head: `1771fa2bc03c14018ab53178979b5095a825d28f`
Persistent URL: `https://store-pos-staging.rahmatullahzisan.workers.dev`

## Delivered

- Neon Auth provisioned only on the dedicated staging Neon project and branch;
- email/password staging authentication enabled by the provider;
- trusted origin restricted to the persistent Workers URL;
- first-party `/login`, `/auth/sign-up`, `/auth/sign-in`, `/auth/session` and `/auth/sign-out` routes;
- provider session cookie localized to the persistent staging host with root path, `Secure`, `HttpOnly` and `SameSite=Lax`;
- anonymous Admin and POS requests redirected to login;
- authenticated user identity shown in the Admin and POS staging notices;
- provider session does not bypass the existing business API OIDC, permission, tenant, MFA or revocation boundary;
- auth errors return bounded platform responses instead of unhandled Worker exceptions;
- exact-origin and Fetch Metadata checks reject cross-site and mismatched-origin form posts;
- opaque or omitted browser Origin is accepted only with `Sec-Fetch-Site: same-origin`;
- deployment creates a random synthetic account, verifies the full journey and deletes the user so sessions and password accounts cascade cleanly;
- generated credentials are never written to the report, screenshot, artifact or repository.

## Live journey verified

1. Anonymous `/admin` redirects to `/login`.
2. Login page loads on a 390 × 844 viewport with no Axe violation or horizontal overflow.
3. A synthetic account is created through the first-party Worker proxy.
4. The provider session endpoint returns an authenticated session.
5. A clean browser signs in through the rendered email/password form.
6. Authenticated Admin inventory opens at 1440 × 900.
7. Authenticated POS register opens at 390 × 844.
8. Admin keyboard skip navigation reaches `#main`.
9. POS checkout remains disabled.
10. Browser sign-out succeeds and a subsequent Admin request returns to login.
11. The synthetic user is deleted; account and session records are removed by verified cascade relationships.

## Exact evidence

Persistent Admin POS Staging workflow:

- run: `30530378430`;
- job: `90831184879`;
- artifact: `8754460568`;
- artifact digest: `sha256:3f3575b1d15f86b03db64652526b92d6614edbd181c8f1beaf325beef33c3bfe`;
- HTTP probes: `10/10`;
- browser scenarios: `3/3`;
- Axe violations: `0`;
- horizontal overflow failures: `0`;
- registered migrations: `55`;
- synthetic platform tenants: `2`;
- Neon Auth tables: `9`;
- synthetic auth account cleanup: passed;
- credentials persisted: false.

## Preserved business authority boundary

This checkpoint authenticates access to read-only synthetic Admin and POS browser surfaces. A Neon Auth provider session is not accepted as proof of:

- platform tenant membership;
- internal user UUID;
- role or permission grants;
- MFA evidence;
- legal entity, store, warehouse, register or device scope;
- payment, order, inventory, accounting or fiscal authority.

The existing business API verifier remains strict. Its placeholder staging OIDC configuration intentionally fails closed for protected business routes until a server-side subject mapping and short-lived internal token exchange are implemented.

## Next checkpoint

- map provider subject to a synthetic internal platform user;
- resolve active tenant membership and minimum role grants from the staging database;
- issue an audience-bound, short-lived internal token without trusting provider-supplied permissions;
- prove inactive membership, revoked session, expired token and cross-tenant failure behavior;
- enable one low-risk, idempotent and reversible controlled-write journey with audit and outbox evidence;
- keep payments, refunds, journals, period close, banking, fiscal submission and destructive operations disabled.
