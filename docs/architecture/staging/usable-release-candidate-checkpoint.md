# Usable Admin/POS release-candidate checkpoint

Status: protected read checkpoint complete
Verified implementation head: `6949b5e39c21203102b1ab51601c334028340d96`
Persistent URL: `https://store-pos-staging.rahmatullahzisan.workers.dev`
Date: 2026-07-30

## Result

The authenticated staging experience is no longer an empty shell. It reads production-shaped module tables in the dedicated synthetic staging database and presents a usable operating workspace.

The custom session now also crosses a strict protected-business-API boundary: the Worker creates a maximum five-minute, audience-bound internal bearer token, verifies it against fresh database authorization context, and invokes existing inventory and procurement handlers through the normal request-context and RLS transaction path.

This checkpoint is deliberately a release candidate, not a production launch. Repository policy prohibits production credentials, production data or production database branches from this workstream.

## Connected browser surfaces

- `/admin` — database-backed operating dashboard;
- `/admin/catalog` — active products, variants, POS prices, availability and inventory value;
- `/admin/inventory` — balances, reservations, low-stock work and immutable ledger trace;
- `/admin/procurement` — suppliers, open purchase orders, receipt progress and order value;
- `/admin/customers` — active customer directory;
- `/admin/sales` — independent order, payment, fulfillment and invoice states;
- `/pos` — database-backed product/cart preview with exact BDT minor-unit totals and disabled checkout;
- `/auth/context` — database-resolved identity, tenant, role, permissions and resource scope;
- `/api/health` and `/staging/status` — health and release-boundary probes.

Other module routes keep an honest connected-next-workflow state rather than pretending that unverified command processing is ready.

## Protected business reads

The following authenticated `GET`/`HEAD` routes are enabled:

- `/api/v1/inventory/availability`;
- `/api/v1/inventory/movements`;
- `/api/v1/procurement/suppliers`;
- `/api/v1/procurement/purchase-orders`.

The browser session cookie is resolved server-side before a token is issued. The token:

- has exact issuer and audience;
- expires after at most `300` seconds;
- contains only database-resolved identity, permissions and resource scope;
- is never written to HTML, cookies, screenshots, reports or artifacts;
- is signed using a Cloudflare Worker secret rotated by the deployment run;
- is checked against the current active session and database authorization context on every request;
- rejects tampering, expiry, logout, membership removal, role/permission drift and scope mismatch;
- cannot contain write, manage, approve, execute, post, capture, refund, close or reopen permissions.

The production RS256/JWKS OIDC verifier and its default behavior remain unchanged. In-process verifier injection remains staging-only.

## Operational synthetic dataset

The deterministic `synthetic-beta` dataset uses existing module-owned schemas:

- active products: `5`;
- active variants: `5`;
- suppliers: `3`;
- open purchase orders: `3`;
- active customers: `4`;
- active sales orders: `3`;
- sellable quantity: `238` units;
- active reserved quantity: `4` units;
- available quantity: `234` units;
- inventory value: `BDT 114,480.00`;
- active sales-order value: `BDT 5,100.00`.

All identities, addresses and references are clearly synthetic. No customer or production data is present.

## Data integrity

- opening stock is represented by five immutable `inventory.stock_ledger_entries`;
- the seed never inserts manufactured totals into `inventory.stock_balances`;
- the balance projection reconciles quantity and value to the immutable ledger;
- pricing versions and rules remain append-only;
- the loader uses an advisory lock;
- complete datasets are verified and immutable replay is skipped;
- partial datasets fail closed instead of being repaired destructively;
- exact money remains integer minor units;
- localized display digits are normalized without changing stored values;
- POS subtotal and payable totals are rebuilt from exact minor units.

## Exact staging evidence

Persistent Admin POS Staging:

- implementation head: `6949b5e39c21203102b1ab51601c334028340d96`;
- workflow run: `30549906829`;
- job: `90895724482`;
- artifact: `8762356904`;
- artifact digest: `sha256:95328722850cd63c1e6dbc454fea54c0059c871271b25579da45cf8da9ffb032`;
- registered migrations: `58`;
- custom-auth tables: `4`;
- legacy Neon Auth tables: `0`;
- HTTP probes: `20/20`;
- browser scenarios: `5/5`;
- Axe violations: `0`;
- root horizontal-overflow failures: `0`;
- login/logout/session/context checks: passed;
- synthetic auth-account cleanup: passed;
- inventory ledger reconciliation: passed;
- inventory availability/movement protected reads: passed;
- supplier/purchase-order protected reads: passed;
- cross-warehouse denial: passed with `403 PERMISSION_DENIED`;
- authoritative checkout and other browser writes: disabled as designed.

Independent artifact inspection confirmed the report rather than relying only on the workflow conclusion.

Browser scenarios:

1. mobile custom-auth login;
2. desktop operational dashboard;
3. mobile catalog;
4. desktop inventory control;
5. mobile POS with disabled checkout.

Exact implementation-head repository evidence also passed:

- Foundation CI run `30549906835`:
  - verify `90895609941`;
  - Cloudflare preview/runtime/cleanup `90895691146`;
  - Neon recovery `90895691302`;
  - Neon preview `90895810213`;
- Foundation Design CI run `30549906840`, job `90895556596`;
- Marketing Pages Preview run `30549906804`:
  - verify `90895557069`;
  - deploy preview `90895750566`.

## Production launch blockers

The following are still required before this can honestly be called production:

- approved production domain and product identity;
- production Cloudflare environment and restricted secrets;
- production Neon project/branch, backup, restore and retention policy;
- transactional email, email verification and password recovery;
- MFA and privileged step-up authentication;
- production asymmetric internal-token signing/JWKS lifecycle;
- authoritative read API integration for remaining enabled modules;
- controlled writes with idempotency, permissions, audit, outbox, reversal and recovery evidence;
- production monitoring, alerting, privacy, incident and support runbooks;
- controlled launch approval.

## Next checkpoint

Enable one low-risk reversible business command without weakening the protected-read boundary:

1. select a command with no payment, journal, banking, fiscal or destructive effect;
2. require a narrow write permission and exact resource scope;
3. prove idempotent replay and version-conflict behavior;
4. emit immutable audit and outbox evidence;
5. provide explicit reversal or compensating recovery evidence;
6. keep payment, refund, journal, period-close, banking, fiscal and destructive actions disabled until their dedicated gates pass.
