# Internal token and protected read API plan

Status: complete
Date: 2026-07-30
Branch: `ops/persistent-admin-pos-staging-v1`
Depends on: `usable-release-candidate-checkpoint.md`
Target: dedicated synthetic staging only
Verified implementation head: `6949b5e39c21203102b1ab51601c334028340d96`

## Goal

Move the usable Admin/POS release candidate from direct server-side presentation reads to the same request-context and module-handler boundary used by protected business APIs, without weakening the production OIDC verifier.

## Security boundary

- The existing production verifier remains RS256/JWKS based and continues to enforce issuer, audience, expiry, maximum token age, MFA evidence, session identity and database revocation state.
- No production verifier fallback to development tokens is allowed in staging or production.
- The staging Worker injects a dedicated verifier only for an internal request created after validating the custom session and resolving current database authorization context.
- The browser never supplies tenant IDs, role codes, permissions, store, warehouse or register scope.
- The internal token is audience-bound, tamper-evident and valid for at most `300` seconds.
- Every verification rechecks the active custom session and current database authorization context, so logout, expiry, membership suspension, role removal and permission drift fail closed.
- Internal token material is not persisted in cookies, HTML, screenshots, reports or artifacts.
- The signing secret is stored as a Cloudflare Worker secret and rotated by each staging deployment run.

## Protected reads delivered

1. `GET /api/v1/inventory/availability` — availability for the authenticated warehouse.
2. `GET /api/v1/inventory/movements` — immutable movement history for the authenticated warehouse.
3. `GET /api/v1/procurement/suppliers` — tenant-scoped supplier directory.
4. `GET /api/v1/procurement/purchase-orders` — open purchase orders constrained to the authenticated warehouse.

`HEAD` is also accepted. Other methods return `405`; unapproved protected routes return `404`. A warehouse outside the resolved session scope returns bounded `403 PERMISSION_DENIED` before repository access.

The browser continues using the existing server-rendered operational views while deployment evidence proves that the protected module APIs return the same tenant-scoped data through `buildRequestContext`, the existing module handlers and RLS-aware transactions.

## Acceptance evidence

All acceptance gates passed on implementation head `6949b5e39c21203102b1ab51601c334028340d96`:

- production OIDC code and default behavior remain unchanged;
- custom session is required before an internal token is issued;
- lifetime is at most five minutes;
- issuer and audience are exact;
- signature comparison is constant-time and tampering is rejected;
- user, tenant, permissions and resource scope must match a fresh database context;
- expired, revoked, inactive and cross-warehouse requests fail with bounded `401`/`403` responses;
- no write, manage, approve, execute, post, capture, refund, close or reopen permission can be issued;
- inventory and procurement reads execute through existing request-context and module-handler boundaries;
- browser and artifacts contain no internal token or signing secret;
- workflow run `30549906829`, job `90895724482`, artifact `8762356904`, digest `sha256:95328722850cd63c1e6dbc454fea54c0059c871271b25579da45cf8da9ffb032` passed;
- independent artifact inspection confirmed `20/20` HTTP probes and `5/5` browser scenarios with zero Axe violations and zero horizontal overflow.

## Deferred

- production asymmetric signing key and JWKS lifecycle;
- MFA enrollment and privileged step-up;
- authoritative commands;
- payment, refund, journal, banking and fiscal actions;
- production domain, backup, monitoring and launch approval.
