# Usable Admin/POS release-candidate plan

Status: active
Date: 2026-07-30
Branch: `ops/persistent-admin-pos-staging-v1`
Target: dedicated synthetic staging only

## Why this checkpoint exists

Authentication and database-resolved read authorization are working, but most operational module tables contain no rows. The current browser therefore proves identity and shell integration without giving an operator a useful business workspace.

Repository safety rules prohibit using production credentials, production data or production database branches from this workstream. This checkpoint creates a production-shaped release candidate on the dedicated staging project; it does not claim a production launch.

## Scope

1. Load deterministic, idempotent synthetic business records into the existing module-owned PostgreSQL tables for the `synthetic-beta` tenant.
2. Preserve stock provenance by generating opening stock through immutable inventory ledger entries rather than directly manufacturing balance totals.
3. Expose database-backed read models for:
   - operating dashboard;
   - catalog and pricing;
   - inventory availability and value;
   - suppliers and purchase orders;
   - customer directory;
   - sales orders;
   - POS product and cart preview.
4. Resolve tenant, legal entity, store, warehouse, register and permissions from the authenticated custom session. Browser-supplied scope remains untrusted.
5. Keep payment capture, checkout, stock mutation, order mutation, accounting posting, banking and fiscal actions disabled until separate controlled-write evidence passes.

## Data rules

- Synthetic records use deterministic UUIDs and `STG-`/`DEMO-` references.
- Seed execution is idempotent and safe to repeat during deployment.
- No real email, phone, tax registration, customer or financial data is used.
- Money is stored as exact minor units and quantities use explicit scales.
- Inventory balances must reconcile to immutable ledger entries.
- Existing manually created staging users are preserved.

## UI rules

- Reuse the Operations Ledger shell and existing module renderers.
- Replace generic empty module screens for the initial seven operational areas.
- Show clear synthetic/release-candidate notices without hiding useful data.
- Every dashboard number must link or point to its source table/document context.
- Mobile, 200% text, keyboard skip navigation and Axe checks remain mandatory.

## Acceptance gates

- operational seed loads after all registered migrations;
- rerunning the deployment does not duplicate data;
- dashboard, catalog, inventory, procurement, customers, sales and POS return HTTP 200 for an authenticated session;
- anonymous access remains redirected or denied;
- module rows are scoped to the authenticated tenant;
- inventory balance totals match ledger projections;
- no privileged/write permission appears in the custom-auth context;
- browser evidence has zero Axe violations and zero root horizontal overflow;
- exact-head Foundation CI, Foundation Design CI, persistent staging and preview workflows pass.

## Deferred production gates

- approved product name and public domain;
- production Neon project/branch and backup policy;
- production Cloudflare account/environment secrets;
- transactional email and password recovery;
- MFA and privileged step-up authentication;
- internal short-lived bearer token exchange for protected business APIs;
- authoritative command journeys with idempotency, audit, outbox, reversal and recovery evidence;
- production observability, alerting, retention, privacy and incident runbooks;
- controlled launch approval.
