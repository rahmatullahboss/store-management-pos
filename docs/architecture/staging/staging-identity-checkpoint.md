# Staging custom identity and read-context checkpoint

Status: custom identity and database-resolved read context complete
Verified implementation head: `b578e6c403ae2d5a816eab79ff69c09dd9bca757`
Persistent URL: `https://store-pos-staging.rahmatullahzisan.workers.dev`

## Delivered custom authentication

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
- generated credentials never appear in source, logs, screenshots, reports or artifacts.

## Delivered database-resolved read authorization

- FND-0008 creates a tenant-scoped `staging-read-only` role for custom-auth memberships;
- role assignment is triggered inside the same account-creation transaction;
- only 16 explicit `standard` risk permissions are granted;
- permissions are read from `platform.role_permissions`; no permission claim is accepted from the browser;
- context resolution requires an active session, active user, active tenant, active membership and assigned read-only role;
- legal entity, store, warehouse and register scope are resolved from active synthetic tenant records;
- `/auth/context` returns bounded user, tenant, membership, role, scope and permission information;
- missing session returns 401;
- missing or inactive read authorization returns 403;
- endpoint permits only GET and HEAD;
- write, manage, approve, execute and privileged permissions are excluded from the role gate.

The resolved permissions are:

- `catalog.feed.read`;
- `catalog.product.read`;
- `customer.profile.read`;
- `fulfillment.read`;
- `inventory.replenishment.read`;
- `inventory.stock.read`;
- `inventory.warehouse.read`;
- `platform.device.read`;
- `platform.reference.read`;
- `pricing.price.read`;
- `pricing.price_tax.calculate`;
- `procurement.purchase_order.read`;
- `procurement.requisition.read`;
- `procurement.supplier.read`;
- `sales.order.read`;
- `tax.calculation.read`.

## Corrective findings

Three concrete failures were fixed while replacing and extending authentication:

1. `@neondatabase/serverless` 1.1 conventional query calls require `sql.query(text, params)`. The shared foundation database adapter used the removed `sql(text, params)` form. `packages/foundation/src/db.ts` now uses the supported API for HTTP queries and transactions.
2. The initial custom login function had ambiguous output and table-column references. The already-applied FND-0006 migration was not edited; FND-0007 replaces the function with fully qualified references.
3. Read permissions are not inferred from route names or frontend navigation. FND-0008 assigns a real role and resolves context from database membership and role-grant tables.

## Live journey verified

1. Anonymous `/admin` redirects to `/login`.
2. Login page loads on a 390 × 844 viewport.
3. A synthetic account is created through the Cloudflare Worker.
4. The account receives an internal platform user and active `synthetic-beta` membership.
5. The membership receives the `staging-read-only` role and 16 explicit permissions.
6. Registration, login and read-context pass using the same Neon HTTP driver used by the Worker.
7. `/auth/session` returns the authenticated custom session.
8. `/auth/context` returns `database-resolved-read-only` authorization and scoped Dhaka identifiers.
9. A clean browser signs in through the rendered email/password form.
10. Authenticated Admin inventory opens at 1440 × 900.
11. Authenticated POS register opens at 390 × 844.
12. Admin keyboard skip navigation reaches `#main`.
13. POS checkout remains disabled.
14. Browser sign-out revokes the session and returns to login.
15. The synthetic user, membership, role assignment, credential and sessions are deleted after evidence collection.

## Exact evidence

Persistent Admin POS Staging workflow:

- exact implementation head: `b578e6c403ae2d5a816eab79ff69c09dd9bca757`;
- deployed merge SHA reported by the artifact: `d54491f50791f88fbadb55050f3771ee023b28f2`;
- run: `30535437966`;
- job: `90847641243`;
- artifact: `8756477049`;
- artifact digest: `sha256:0b7c2b3c6d7d20ffdbc5e2ffa5ac45729e9a887028e68c4386cef31611ffe424`;
- registered migrations: `58`;
- synthetic platform tenants: `2`;
- custom auth tables: `4`;
- legacy Neon Auth tables: `0`;
- HTTP probes: `11/11`;
- browser scenarios: `3/3`;
- Axe violations: `0`;
- page-level horizontal overflow failures: `0`;
- registration/login/read-context HTTP-driver preflight: passed;
- browser signup: passed;
- browser login: passed;
- authenticated session probe: passed;
- database-resolved context probe: passed;
- browser logout: passed;
- synthetic account cleanup: passed;
- plaintext session token stored in database: false;
- credentials persisted in artifacts: false.

## Preserved business authority boundary

This checkpoint resolves trusted read-only identity, membership, role and scope. It still does not issue the strict bearer token required by protected business API routes and does not grant:

- MFA evidence accepted by the production API verifier;
- payment, order, inventory mutation, accounting, banking or fiscal authority;
- any write, manage, approve or execute permission.

The protected business API remains fail closed until a short-lived internal token exchange is implemented and verified.

## Next checkpoint

- issue an audience-bound, short-lived internal token from the database-resolved context;
- prove inactive membership, revoked session, expired token and cross-tenant failure behavior;
- enable authoritative read journeys for tenant/store context, inventory availability and procurement overview;
- enable one low-risk, idempotent and reversible controlled-write journey with audit and outbox evidence;
- keep payments, refunds, journals, period close, banking, fiscal submission and destructive operations disabled.
