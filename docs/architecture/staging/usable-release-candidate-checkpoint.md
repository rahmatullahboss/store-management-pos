# Usable Admin/POS release-candidate checkpoint

Status: complete
Verified implementation head: `866e99b69b1ccd8f0789f8328fdbc9437fb3bfec`
Persistent URL: `https://store-pos-staging.rahmatullahzisan.workers.dev`
Date: 2026-07-30

## Result

The authenticated staging experience is no longer an empty shell. It now reads production-shaped module tables in the dedicated synthetic staging database and presents a usable operating workspace.

This checkpoint is deliberately a release candidate, not a production launch. The repository safety policy prohibits using production credentials, production data or production database branches from this workstream.

## Connected browser surfaces

- `/admin` — database-backed operating dashboard;
- `/admin/catalog` — active products, variants, POS prices, availability and inventory value;
- `/admin/inventory` — balances, reservations, low-stock work and immutable ledger trace;
- `/admin/procurement` — suppliers, open purchase orders, receipt progress and order value;
- `/admin/customers` — active customer directory;
- `/admin/sales` — independent order, payment, fulfillment and invoice states;
- `/pos` — database-backed product/cart preview with exact BDT minor-unit totals;
- `/auth/context` — database-resolved identity, tenant, role, permissions and resource scope;
- `/api/health` and `/staging/status` — health and release-boundary probes.

Other module routes keep an honest connected-next-workflow state rather than pretending that unverified command processing is ready.

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

## Authorization boundary

- Ozzyl custom PostgreSQL authentication remains the identity provider;
- the session cookie is opaque, Secure, HttpOnly and SameSite=Lax;
- the database stores only the session-token hash;
- tenant, active membership, role and resource scope are resolved server-side;
- `staging-read-only` grants 16 explicit standard-risk permissions;
- browser-supplied tenant, role or permission claims are not accepted;
- payment, checkout, stock, order, accounting, banking and fiscal commands remain disabled.

## Exact staging evidence

Persistent Admin POS Staging:

- workflow run: `30540227545`;
- job: `90863023950`;
- artifact: `8758383720`;
- artifact digest: `sha256:5c9404b4b6d10e326cc073a83e9ddf53f21346f1e6c0ec2148c812342beab583`;
- registered migrations: `58`;
- custom-auth tables: `4`;
- legacy Neon Auth tables: `0`;
- authenticated HTTP probes: `15/15`;
- browser scenarios: `5/5`;
- Axe violations: `0`;
- root horizontal-overflow failures: `0`;
- leaked database URLs: `0`;
- keyboard skip-navigation checks: passed;
- login/logout/session/context checks: passed;
- synthetic auth-account cleanup: passed;
- inventory ledger reconciliation: passed;
- authoritative checkout: disabled as designed.

Browser scenarios:

1. mobile custom-auth login;
2. desktop operational dashboard;
3. mobile catalog;
4. desktop inventory control;
5. mobile POS with disabled checkout.

## Production launch blockers

The following are still required before this can honestly be called production:

- approved production domain and product identity;
- production Cloudflare environment and restricted secrets;
- production Neon project/branch, backup, restore and retention policy;
- transactional email, email verification and password recovery;
- MFA and privileged step-up authentication;
- short-lived internal bearer-token exchange for protected business APIs;
- authoritative read API integration for all enabled screens;
- controlled writes with idempotency, permissions, audit, outbox, reversal and recovery evidence;
- production monitoring, alerting, privacy, incident and support runbooks;
- controlled launch approval.

## Next checkpoint

Enable the first controlled business workflow without weakening the existing production verifier:

1. exchange the custom session for a short-lived, audience-bound internal token;
2. prove inactive membership, revoked session, expiry and cross-tenant failures;
3. connect authoritative inventory and procurement read APIs;
4. enable one low-risk reversible command with audit and outbox evidence;
5. keep financial, banking, fiscal and destructive actions disabled until their dedicated gates pass.
