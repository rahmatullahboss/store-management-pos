# Usable Admin/POS operability implementation checkpoint

Status: aggregate operability live evidence complete; outbox publisher review remains open
Verified implementation head: `46f21db536ccbdc4f3937373543d43bbd9e815b6`
Persistent URL: `https://store-pos-staging.rahmatullahzisan.workers.dev`
Date: 2026-07-31

## Result

The persistent Admin/POS staging environment now supports:

- production-shaped authenticated business reads;
- one narrow reversible authoritative business workflow: inventory reservation create/release;
- encrypted TOTP MFA and privileged step-up;
- hashed, single-use password-recovery and email-verification token lifecycles;
- fixed aggregate operability signals, deterministic alert policies, atomic schema-v6 evidence and linked response runbooks.

This remains synthetic staging, not a production launch. Production credentials, production data and production database branches are prohibited. Payment, refund, journal, period-close, banking, fiscal, destructive, stock-posting and transfer commands remain disabled.

## Connected browser surfaces

- `/admin` — database-backed operating dashboard;
- `/admin/catalog` — active products, variants, prices, availability and inventory value;
- `/admin/inventory` — balances, low-stock work and immutable ledger trace;
- `/admin/inventory/reservations` — MFA-protected reservation create/release workspace;
- `/admin/procurement` — suppliers, purchase orders, receipt progress and order value;
- `/admin/customers` — active customer directory;
- `/admin/sales` — independent order, payment, fulfilment and invoice states;
- `/pos` — exact BDT minor-unit product/cart preview with checkout disabled;
- `/forgot-password`, `/reset-password`, `/verify-email` and completion pages;
- `/auth/context`, `/auth/mfa`, `/api/health` and `/staging/status`.

Unconnected routes continue to show an honest next-workflow state rather than pretending unverified commands are ready.

## Custom identity and TOTP MFA

The first-party authentication boundary provides:

- bcrypt cost-12 password hashes;
- opaque 32-byte session tokens with only SHA-256 hashes stored in PostgreSQL;
- eight-hour Secure, HttpOnly, SameSite=Lax host-only session cookies;
- login rate limiting, credential lockout, session revocation and bounded auth events;
- server-side tenant, membership, role and resource-scope resolution;
- current-password recheck before MFA enrolment or step-up;
- RFC-compatible six-digit TOTP with a 30-second period;
- password-derived AES-GCM encryption for TOTP secrets;
- no plaintext TOTP secret in PostgreSQL, logs, screenshots, reports or artifacts;
- Cloudflare-compatible chained PBKDF2-SHA256 with three sequential 100,000-iteration rounds;
- single-use, session-bound and permission-bound step-up grants valid for at most five minutes;
- active factor, session, membership, sensitive role and permission rechecks when consuming a grant;
- TOTP replay-counter enforcement;
- fail-closed authorization-drift handling.

The step-up cookie is Secure, HttpOnly and SameSite=Strict. It is cleared after a command attempt and is not a normal login session.

## Password recovery and email verification

Implemented routes:

- `GET /forgot-password`;
- `POST /auth/password-recovery/request`;
- `GET /reset-password?token=...`;
- `POST /auth/password-recovery/complete`;
- `GET /password-reset-complete`;
- `GET /verify-email?token=...`;
- `POST /auth/email-verification/complete`;
- `GET /email-verification-complete`.

Security properties:

- opaque 32-byte tokens;
- only SHA-256 token hashes persisted;
- password-recovery lifetime at most 15 minutes;
- email-verification lifetime at most 24 hours;
- purpose-bound, single-use tokens;
- newest active token supersedes older tokens for the same user and purpose;
- request throttling using email/client fingerprints;
- known and unknown accounts receive the same visible response;
- invalid, expired, wrong-purpose and replayed tokens fail closed;
- password reset atomically rotates the bcrypt credential;
- password reset clears lockout state;
- every existing login session is revoked;
- outstanding step-up grants are consumed/revoked;
- pending and active password-derived TOTP factors are revoked, requiring re-enrolment;
- browser session and step-up cookies are cleared;
- audit events record successful reset and verification;
- raw tokens, passwords and database URLs are absent from logs and artifacts.

A delivery adapter boundary exists, but production transactional email is intentionally not configured. The persistent Worker never returns the recovery token to the requester.

## Internal token boundaries

Protected reads use a maximum five-minute audience-bound internal token. The controlled reservation command uses a separate token valid for at most 60 seconds with:

- permission `inventory.reservation.manage` only;
- current-password plus TOTP assurance;
- database-resolved tenant, actor and warehouse scope;
- fresh session and authorization resolution during verification;
- no browser exposure or persistence;
- a Cloudflare Worker secret rotated by each staging deployment run.

Production RS256/JWKS OIDC behaviour remains unchanged. HS256 and in-process verifier injection remain staging-only.

## Protected business reads

Authenticated `GET`/`HEAD` routes:

- `/api/v1/inventory/availability`;
- `/api/v1/inventory/movements`;
- `/api/v1/procurement/suppliers`;
- `/api/v1/procurement/purchase-orders`.

They use `buildRequestContext`, existing module handlers and RLS-aware transactions. Cross-warehouse requests fail with `403 PERMISSION_DENIED`; unsupported methods and unapproved routes remain unavailable.

## Controlled reservation workflow

Enabled commands:

- `POST /api/v1/inventory/reservations`;
- `POST /api/v1/inventory/reservations/{reservationId}/release`.

The boundary enforces:

- exactly one line;
- authenticated warehouse scope forced server-side;
- canonical stock unit `EA`, scale `0`;
- integer quantity from `1` to `5`;
- `all_or_nothing` fulfilment;
- current password plus TOTP for every create or release;
- a new step-up grant for release;
- consumed-grant replay rejection;
- optimistic version checking;
- immutable audit/outbox evidence;
- availability reduction after create and restoration after release;
- synthetic reservation cleanup after evidence.

It does not post stock, capture payment, create journals, initiate transfers or mutate accounting/banking state.

## Operational synthetic dataset

The deterministic `synthetic-beta` dataset contains:

- active products / variants: `5 / 5`;
- suppliers / open purchase orders: `3 / 3`;
- active customers / sales orders: `4 / 3`;
- sellable / initially reserved / available quantity: `238 / 4 / 234`;
- inventory value: `BDT 114,480.00`;
- active sales-order value: `BDT 5,100.00`.

Opening stock is represented by five immutable inventory ledger entries. The seed does not manufacture balance totals; quantity and value reconcile to the ledger. Complete replay is skipped, partial state fails closed, and exact money remains integer minor units.

## Aggregate operability implementation

The operational staging runner now derives eleven fixed low-cardinality signals from the existing release report and synthetic-tenant database aggregates:

- HTTP probe, browser scenario, Axe and horizontal-overflow failures;
- identity, recovery and MFA control failures;
- controlled reservation command failures;
- artifact secret-leak controls;
- inventory ledger/projection reconciliation mismatches;
- journal header/line imbalance count;
- outbox backlog count and oldest unpublished age.

Critical integrity, identity, accessibility and leakage signals are zero-tolerance. The runner writes a schema-v6 report atomically before enforcing a critical launch block, and the workflow summary exposes only fixed alert IDs, severity, owner and runbook path. Outbox backlog remains a review-only warning until a continuous publisher and approved production SLO are commissioned.

Implementation evidence:

- `tooling/scripts/staging-operability.mjs`;
- `tests/unit/staging-operability.test.mjs`;
- `tests/unit/staging-operational-release.test.mjs`;
- `docs/architecture/staging/operability-alerts-runbook.md`;
- `docs/superpowers/plans/2026-07-31-staging-operability-hardening.md`.

Live schema-v6 evidence was produced and independently inspected for implementation head `46f21db536ccbdc4f3937373543d43bbd9e815b6`:

- Persistent Admin POS Staging run: `30574918673`;
- job: `90980664683`;
- artifact: `8772324055`;
- digest: `sha256:ec184485ac425ba84945ec0f312a1d174b22610e3d3bffdb7289579916063e91`;
- report schema / policy schema: `6 / 1`;
- HTTP probes: `24/24`;
- browser scenarios: `6/6`;
- Axe violations / horizontal-overflow failures: `0 / 0`;
- identity, controlled-command, artifact-leak, inventory-reconciliation and journal-balance failures: all `0`;
- outbox backlog: `40`;
- oldest unpublished outbox age: `9,751` seconds;
- operability warnings / critical alerts: `1 / 0`;
- status / launch gate: `degraded / review`.

The single review warning is `staging.outbox_oldest_unpublished_seconds.warning`. This is expected until a continuous publisher and approved SLO exist; immutable outbox evidence was not deleted or marked published to clear the warning. Artifact inspection found no database URL, bearer/JWT, raw 43-character action token, cookie header, password field or TOTP secret field.

Production alert delivery, paging and approved SLOs are not configured by this checkpoint.

## Previous exact staging evidence

Persistent Admin POS Staging:

- implementation head: `9aba12c3431fc5970ee862a567d31a026389fa85`;
- workflow run: `30569120139`;
- job: `90961133553`;
- artifact: `8770087632`;
- artifact digest: `sha256:52ce091629a8a171cad1f931997234d51ad4bc082cdeb7646d7128380efb1ca3`;
- registered migrations: `64`;
- custom-auth core tables: `4`;
- action-token table: present;
- legacy Neon Auth tables: `0`;
- HTTP probes: `24/24`;
- browser scenarios: `6/6`;
- Axe violations: `0`;
- root horizontal-overflow failures: `0`;
- login/logout/session/context: passed;
- synthetic auth-account cleanup: passed;
- TOTP encrypted at rest and password recheck: passed;
- TOTP/grant replay rejection: passed;
- single-use step-up grants consumed: `2`;
- reservation create/release and availability reconciliation: passed;
- immutable reservation audit/outbox events: `2 / 2`;
- synthetic reservation cleanup: passed;
- password-recovery account non-enumeration: passed;
- hashed-token-only persistence: passed;
- password reset and credential rotation: passed;
- original session revocation: passed;
- old-password rejection and new-password login: passed;
- MFA-factor and outstanding-step-up revocation: passed;
- reset-token replay rejection: passed;
- email verification and verification-token replay rejection: passed;
- password-reset / email-verified audit events: `1 / 1`;
- production email delivery configured: no;
- cross-warehouse denial: passed.

Independent artifact inspection confirmed the report rather than relying only on the workflow conclusion. The artifact contains no 43-character raw action token, password, session/step-up cookie, signing secret or database URL.

Browser scenarios:

1. mobile custom-auth login;
2. desktop operational dashboard;
3. mobile catalog;
4. desktop inventory control;
5. mobile controlled-reservation workspace;
6. mobile POS with disabled checkout.

The reservation table is a labelled keyboard-focusable scroll region. No Axe rule was suppressed.

## Exact repository evidence

All exact implementation-head workflows passed:

- Foundation CI run `30569120275`:
  - verify job `90961097205`;
  - Cloudflare preview/runtime/cleanup job `90961189395`;
  - Neon recovery job `90961189579`;
  - Neon preview job `90961317032`;
- Foundation Design CI run `30569120181`, job `90961026182`;
- Marketing Pages Preview run `30569120118`:
  - verification job `90961036412`;
  - preview deployment job `90961191730`;
- Persistent Admin POS Staging run `30569120139`, job `90961133553`.

## Production launch blockers

Before production launch:

- approved public domain and product identity;
- production Cloudflare environment with restricted secret governance;
- production Neon project/branch, backup, restore and retention policy;
- production transactional-email provider, verified sender domain, templates, bounce handling and delivery monitoring;
- production policy deciding when email verification is mandatory before session issuance;
- production MFA recovery, factor replacement and support governance;
- asymmetric internal-token signing and JWKS lifecycle;
- protected read integration for remaining enabled modules;
- dedicated gates for every additional write, especially payment, refund, journal, period close, banking, fiscal and destructive actions;
- production monitoring, alerting, privacy, incident and support runbooks;
- controlled launch approval.

## Next checkpoint

Prioritise production operability rather than enabling risky financial commands:

1. define production MFA recovery and factor-replacement governance;
2. establish production Cloudflare/Neon backup, restore and retention policy;
3. connect the implemented aggregate policies to an approved monitoring backend, paging path and production SLOs;
4. select and securely configure the production transactional-email provider;
5. keep inventory reservation create/release as the only authoritative business write until those gates pass.
