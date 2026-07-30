# Usable Admin/POS controlled-reservation checkpoint

Status: controlled reservation release-candidate checkpoint complete  
Verified implementation head: `e60ab510b65b9e266e8870e1da395faecb9a5e9a`  
Persistent URL: `https://store-pos-staging.rahmatullahzisan.workers.dev`  
Date: 2026-07-30

## Result

The persistent Admin/POS staging environment now supports production-shaped authenticated reads plus one narrow, reversible authoritative business workflow: inventory reservation create and release.

This checkpoint remains synthetic staging, not a production launch. Production credentials, production data and production database branches are prohibited in this workstream. Payment, refund, journal, period-close, banking, fiscal, destructive, stock-posting and transfer commands remain disabled.

## Connected browser surfaces

- `/admin` — database-backed operating dashboard;
- `/admin/catalog` — active products, variants, prices, availability and inventory value;
- `/admin/inventory` — balances, low-stock work and immutable ledger trace;
- `/admin/inventory/reservations` — MFA-protected reservation create/release workspace;
- `/admin/procurement` — suppliers, purchase orders, receipt progress and order value;
- `/admin/customers` — active customer directory;
- `/admin/sales` — independent order, payment, fulfilment and invoice states;
- `/pos` — exact BDT minor-unit product/cart preview with checkout disabled;
- `/auth/context`, `/auth/mfa`, `/api/health` and `/staging/status`.

Unconnected routes continue to show an honest next-workflow state rather than pretending that unverified command processing is ready.

## Custom identity and TOTP MFA

The first-party authentication boundary provides:

- bcrypt cost-12 password hashes;
- opaque 32-byte session tokens with only SHA-256 hashes stored in PostgreSQL;
- eight-hour Secure, HttpOnly, SameSite=Lax host-only session cookies;
- login rate limiting, credential lockout, session revocation and bounded auth events;
- server-side tenant, membership, role and resource-scope resolution;
- current-password recheck before MFA enrolment or step-up;
- RFC-compatible six-digit TOTP with a 30-second period;
- password-derived AES-GCM encryption for the TOTP secret;
- no plaintext TOTP secret in PostgreSQL, logs, screenshots, reports or artifacts;
- a Cloudflare-compatible chained PBKDF2-SHA256 derivation of three sequential 100,000-iteration rounds;
- single-use, session-bound and permission-bound step-up grants valid for at most five minutes;
- active factor, active session, active membership, sensitive role and permission rechecks when a grant is consumed;
- TOTP replay-counter enforcement;
- fail-closed behaviour when authorization drifts.

The step-up cookie is Secure, HttpOnly and SameSite=Strict. It is cleared after a command attempt and is not a normal login session.

## Internal token boundaries

Protected reads use a maximum five-minute audience-bound internal token. The controlled reservation command uses a separate token valid for at most 60 seconds with:

- permission `inventory.reservation.manage` only;
- `amr` assurance equivalent to current password plus TOTP;
- the database-resolved tenant, actor and warehouse scope;
- fresh session and authorization resolution during verification;
- no browser exposure or persistence;
- a Cloudflare Worker secret rotated by each staging deployment run.

The production RS256/JWKS OIDC verifier and its default behaviour remain unchanged. HS256 and in-process verifier injection remain staging-only.

## Protected business reads

Authenticated `GET`/`HEAD` routes:

- `/api/v1/inventory/availability`;
- `/api/v1/inventory/movements`;
- `/api/v1/procurement/suppliers`;
- `/api/v1/procurement/purchase-orders`.

These routes use `buildRequestContext`, existing module handlers and RLS-aware transactions. Cross-warehouse requests fail with `403 PERMISSION_DENIED`; unsupported methods and unapproved routes remain unavailable.

## Controlled reservation workflow

Enabled commands:

- `POST /api/v1/inventory/reservations`;
- `POST /api/v1/inventory/reservations/{reservationId}/release`.

The boundary enforces:

- exactly one line per controlled staging reservation;
- authenticated warehouse scope forced server-side;
- canonical stock unit `EA` and scale `0`;
- integer quantity from `1` to `5`;
- `all_or_nothing` fulfilment policy;
- current password plus TOTP for every create or release;
- a new step-up grant for release;
- single-use grant consumption before command-token issuance;
- consumed-grant replay rejection;
- optimistic version check on release;
- immutable audit and outbox evidence;
- availability reduction after create and restoration after release;
- synthetic reservation cleanup after evidence collection.

The workflow does not post stock, capture payment, create journals, initiate transfers or mutate accounting/banking state.

## Operational synthetic dataset

The deterministic `synthetic-beta` dataset uses module-owned schemas:

- active products / variants: `5 / 5`;
- suppliers / open purchase orders: `3 / 3`;
- active customers / sales orders: `4 / 3`;
- sellable / initially reserved / available quantity: `238 / 4 / 234`;
- inventory value: `BDT 114,480.00`;
- active sales-order value: `BDT 5,100.00`.

Opening stock is represented by five immutable inventory ledger entries. The seed does not manufacture totals in `inventory.stock_balances`; quantity and value reconcile to the immutable ledger. Complete seed replay is skipped, partial state fails closed, and exact money remains integer minor units.

## Exact staging evidence

Persistent Admin POS Staging:

- implementation head: `e60ab510b65b9e266e8870e1da395faecb9a5e9a`;
- workflow run: `30566029622`;
- job: `90950634049`;
- artifact: `8768881733`;
- artifact digest: `sha256:add76a0f8ac5306ab91887a8bb492d0b7772c7cfde43c5bbe45d8a8dd051f6e7`;
- registered migrations: `62`;
- custom-auth tables: `4`;
- legacy Neon Auth tables: `0`;
- HTTP probes: `23/23`;
- browser scenarios: `6/6`;
- Axe violations: `0`;
- root horizontal-overflow failures: `0`;
- login/logout/session/context: passed;
- synthetic auth-account cleanup: passed;
- TOTP encrypted at rest: passed;
- password recheck: passed;
- TOTP/grant replay rejection: passed;
- single-use step-up grants consumed: `2`;
- reservation create: passed;
- reservation release with second step-up: passed;
- availability reconciliation: passed;
- immutable reservation audit events: `2`;
- reservation outbox events: `2`;
- synthetic reservation cleanup: passed;
- inventory ledger reconciliation: passed;
- cross-warehouse denial: passed.

Independent artifact inspection confirmed the report rather than relying only on the workflow conclusion. No credentials, TOTP secret, session token, step-up token, signing secret or database URL were persisted in the artifact.

Browser scenarios:

1. mobile custom-auth login;
2. desktop operational dashboard;
3. mobile catalog;
4. desktop inventory control;
5. mobile controlled-reservation workspace;
6. mobile POS with disabled checkout.

The reservation table is a labelled keyboard-focusable scroll region. This resolved the mobile accessibility gate without suppressing an Axe rule.

## Exact repository evidence

All exact implementation-head workflows passed:

- Foundation CI run `30566029516`:
  - verify job `90950698847`;
  - Cloudflare preview/runtime/cleanup job `90950787723`;
  - Neon recovery job `90950788302`;
  - Neon preview job `90950881791`;
- Foundation Design CI run `30566029604`, job `90950633578`;
- Marketing Pages Preview run `30566029586`:
  - verification job `90950633518`;
  - preview deployment job `90950810733`;
- Persistent Admin POS Staging run `30566029622`, job `90950634049`.

## Production launch blockers

Before this can honestly be called production, the following remain required:

- approved public domain and product identity;
- production Cloudflare environment with restricted secret governance;
- production Neon project/branch, backup, restore and retention policy;
- transactional email, email verification and password recovery;
- production MFA recovery, factor replacement and support governance;
- asymmetric internal-token signing and JWKS lifecycle;
- protected read integration for remaining enabled modules;
- dedicated gates for every additional write, especially payment, refund, journal, period close, banking, fiscal and destructive actions;
- production monitoring, alerting, privacy, incident and support runbooks;
- controlled launch approval.

## Next checkpoint

Prioritise production-operability foundations rather than enabling risky financial commands:

1. add email verification and password-recovery flows with rate limits and token invalidation;
2. define production MFA recovery and factor-replacement policy;
3. establish production Cloudflare/Neon backup and restore governance;
4. add stable monitoring and alerting for authentication, command failures, outbox lag and database availability;
5. keep the controlled reservation workflow as the only authoritative write until those gates pass.
