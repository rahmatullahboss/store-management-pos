# Delivery Roadmap and Program Plan

## 1. Delivery strategy

Build the product in gated phases. Each phase must leave a coherent, testable product baseline; it must not produce disconnected screens whose ledgers, permissions or offline behavior are deferred indefinitely.

The sequence prioritizes architecture risk and financial correctness before breadth:

1. validate runtime/database/offline assumptions;
2. establish tenant, security and ledger foundations;
3. implement purchase-to-stock and sale-to-cash vertical slices;
4. make POS operational online and offline;
5. add accounting close, reports and country validation;
6. pilot, harden and release;
7. expand integrations, countries and verticals.

No source-code implementation should begin until Phase 0 decisions and acceptance examples are approved.

### Parallel execution model

The roadmap describes product dependencies, but implementation delegation is module-based:

1. One foundation agent completes the platform and freezes contract pack v1.
2. Seven module agents then develop their entire large workpacks concurrently in isolated Git worktrees and Neon branches.
3. Agents may not split their internal checklist into sub-agents.
4. Development is concurrent; integration remains one module at a time.
5. Module agents use contract fixtures until dependent implementations are merged.
6. See `docs/17-PARALLEL-AGENT-EXECUTION.md` and `docs/agent-workpacks/` for authoritative ownership, branches and gates.

The later phase descriptions remain acceptance milestones and do not require returning to small task-level agent delegation.

## 2. Phase 0 — Product and architecture validation

### Outcomes

- target segment and first launch country selected;
- product scope/P0 features approved;
- Cloudflare Workers + direct Neon Serverless PostgreSQL decision benchmarked;
- first country-pack requirements gathered;
- accounting/stock golden scenarios approved;
- UX workflow prototypes tested with real store roles;
- open-source/license policy established;
- delivery team and quality gates defined.

### Required spikes

- Workers + Neon serverless-driver HTTP/WebSocket transaction and RLS behavior;
- checkout with tax, FIFO stock and journal posting;
- 24-hour offline sync/replay;
- local hardware printing/terminal approach;
- large import and document generation;
- database backup/restore and outbox replay;
- provider sandbox integration;
- Bengali/English and second-script rendering.

### Exit gate

Proceed only if the architecture meets correctness, latency, operability and portability requirements or an ADR records the revised stack.

## 3. Phase 1 — Platform foundation

### Scope

- monorepo and module boundary enforcement;
- CI/CD, environments and infrastructure as code;
- tenant, legal entity, store, warehouse and register;
- identity, membership, RBAC, MFA and audit;
- entitlements and feature flags;
- PostgreSQL schema/migration framework;
- transactional outbox/inbox/idempotency;
- R2 file service;
- localization primitives;
- observability baseline;
- backup/restore automation.

### Demonstrable result

A tenant can be provisioned in a region, configure an organization, invite scoped users, enroll a register and produce audited API operations.

## 4. Phase 2 — Catalog, pricing and inventory foundation

### Scope

- products, variants, categories, brands and barcodes;
- units and conversions;
- price lists, tax-inclusive/exclusive prices;
- basic tax-rule versioning;
- warehouses/bins and stock status;
- immutable stock ledger and balance projection;
- FIFO cost layers;
- opening stock import through ledger posting;
- adjustments and transfers;
- inventory movement/valuation reports;
- catalog import/export and local POS projection.

### Demonstrable result

A business can import catalog/opening stock, transfer and adjust inventory, and reconcile every balance to stock-ledger entries.

## 5. Phase 3 — Procurement and accounts payable

### Scope

- supplier master and terms;
- purchase order and approval;
- partial goods receiving;
- discrepancy and supplier return;
- supplier bill;
- basic AP posting and aging;
- landed-cost baseline;
- procurement and supplier reports.

### Demonstrable result

A purchase order can be approved, partially received, billed and traced to stock, valuation and balanced accounting entries.

## 6. Phase 4 — Sales, POS, cash and payments

### Scope

- customer master;
- quote/order/invoice/credit note;
- online POS checkout;
- cash, external card and split tender;
- shift/opening float/cash events/blind close;
- return, refund and exchange;
- stock issue and COGS posting;
- payment intent/provider contract and one sandbox adapter;
- receipt semantic snapshot and printing;
- core sales/tender/cash reports.

### Demonstrable result

A sale and return correctly produce linked sales, payment, stock, tax, COGS, journal and receipt artifacts.

## 7. Phase 5 — Offline POS and store operations

### Scope

- installable POS shell and local database;
- catalog/price/config snapshot and incremental sync;
- append-only operation log;
- cash sales and shifts offline;
- conflict/reconciliation console;
- signed offline authorization;
- receipt-number strategy for initial country;
- hardware agent/desktop shell if required;
- device health and update management;
- outage and replay testing.

### Demonstrable result

A register operates for the agreed outage window, survives restart, synchronizes idempotently and exposes all conflicts without duplicated payment/stock/journal effects.

## 8. Phase 6 — Accounting, tax and operational reporting

### Scope

- chart of accounts and posting rules;
- GL journals, periods and locks;
- AR/AP and payment allocation;
- bank/settlement import and reconciliation;
- multi-currency baseline;
- trial balance, P&L, balance sheet and tax reports;
- metric catalog and drill-through dashboards;
- projection reconciliation jobs;
- accountant review tools.

### Demonstrable result

A controlled business period can be closed, statements reconcile to journals, and dashboard figures drill into documents and ledgers.

## 9. Phase 7 — First country pack and compliance readiness

### Scope

- first language/country pack;
- tax, numbering, legal document and correction rules;
- local payment and fiscal/e-invoice adapter where required;
- country chart of accounts/report layouts;
- data-retention/privacy workflows;
- security review, PCI scope analysis and penetration testing;
- accountant/legal validation and limitations;
- customer onboarding/import templates.

### Demonstrable result

The initial country pack reaches the declared support level with documented evidence, limitations and operational runbooks.

## 10. Phase 8 — Pilot and production hardening

### Pilot cohort

Select a small, diverse group:

- one simple single-store retailer;
- one multi-store retailer;
- one wholesale/credit customer if in scope;
- at least two hardware configurations;
- representative catalog and transaction volume.

### Work

- shadow or controlled parallel run;
- opening-balance reconciliation;
- cashier/manager/accountant training;
- daily ledger/cash/stock reconciliation;
- performance and capacity validation;
- support and incident workflow;
- backup/restore and disaster-recovery exercise;
- usability fixes and launch documentation.

### GA gate

- no unresolved critical security issue;
- financial/stock reconciliation passes;
- offline/payment recovery passes;
- country validation complete at advertised level;
- SLO monitoring and on-call/runbooks active;
- tenant export/offboarding tested;
- rollback/forward-fix procedure rehearsed.

## 11. Growth releases

After GA, prioritize by measured demand:

- advanced promotions and loyalty;
- serial/batch/expiry and warranty;
- replenishment and planning;
- pick/pack/ship and carrier integrations;
- ecommerce connectors;
- public API/webhooks;
- additional payment and country packs;
- mobile receiving/counting/approvals;
- multi-entity and advanced accounting;
- analytics warehouse and forecasting;
- vertical packs.

Do not build all verticals simultaneously.

## 12. Suggested workstreams

### Product/domain

- product discovery and workflows;
- country/legal/accounting requirements;
- metric definitions and acceptance examples;
- pilot/customer validation.

### Platform/backend

- tenancy/security;
- domain modules and PostgreSQL;
- Cloudflare services;
- APIs/events/integrations;
- data migration and operations.

### POS/client

- checkout UX;
- offline database/sync;
- printing/hardware;
- device management;
- accessibility/localization.

### Finance/quality

- posting rules and golden tests;
- accounting reports/reconciliation;
- test automation/performance/security;
- country certification evidence.

### Operations

- CI/CD/infrastructure;
- observability/SRE;
- support tooling;
- backups/DR/incident response.

## 13. Minimum core team

Recommended roles, which may be combined only with demonstrated expertise:

- product lead with retail/POS domain ownership;
- solution/domain architect;
- backend engineers experienced in transactional systems/PostgreSQL;
- frontend/POS engineers experienced in offline web/local storage;
- product designer with high-speed operational UX experience;
- QA/SDET with integration/offline/property-testing skills;
- DevOps/SRE/security ownership;
- accountant/finance-domain reviewer;
- local tax/legal advisor per country pack;
- integration/hardware specialist as required.

A single developer can prototype, but a financially correct international product needs independent review and operational ownership before production.

## 14. Definition of done

A feature is done only when it includes:

- approved business rules and state model;
- authorization and audit behavior;
- tenant/timezone/currency/localization handling;
- database migration and indexes;
- API/client behavior;
- idempotency and failure recovery;
- ledger/posting effects where relevant;
- automated tests and observability;
- documentation and support notes;
- data migration/import implications;
- security/privacy review;
- feature flag/rollback path where applicable.

A screen that saves data without these is not complete.

## 15. Release quality gates

Every release candidate passes:

- lint/type/unit/component tests;
- architecture/module-boundary tests;
- database migration compatibility;
- tenant-isolation suite;
- journal/stock invariant suite;
- API/provider contracts;
- offline replay scenarios;
- performance budget;
- security/dependency/license scans;
- accessibility/localization checks;
- smoke test in staging and canary;
- documentation/changelog review.

## 16. Data migration and onboarding plan

Migration is a product capability, not one-off SQL:

1. assess source systems and data quality;
2. map tenant/legal entity/store/location;
3. clean product/customer/supplier identities;
4. dry-run catalog/prices;
5. choose cutover business date;
6. close/reconcile old system;
7. post controlled opening stock, AR, AP, cash/bank and GL balances;
8. validate trial balance and inventory valuation;
9. enroll devices/users;
10. execute controlled cutover and support window;
11. retain migration provenance and sign-off.

## 17. Program risks and mitigations

| Risk | Mitigation |
|---|---|
| Scope explosion | P0/P1/P2 gates and target segment |
| Incorrect accounting | Independent accountant review and golden postings |
| Offline complexity | Early spike and full vertical slice before feature breadth |
| Country hard-coding | Second pack architecture test and pack contracts |
| Cloudflare runtime mismatch | Mandatory performance/compatibility spikes and fallback ADR |
| Payment/fiscal dependency | Provider abstraction, sandbox, recovery and manual reconciliation |
| Poor tenant isolation | RLS, scoped repositories and attack tests |
| Reporting inconsistency | Metric catalog and drill-through provenance |
| Open-source license contamination | Provenance/CI/legal workflow |
| Weak onboarding | Repeatable imports and reconciled opening entries |
| Solo-team bottleneck | Explicit ownership, review and staged commercial scope |

## 18. Decision checkpoints

Revalidate after:

- architecture spikes;
- first end-to-end purchase receipt;
- first end-to-end checkout;
- first 24-hour offline test;
- first period close;
- first country legal/accounting review;
- pilot reconciliation;
- first large-tenant performance test.

At each checkpoint, update ADRs, scope and risk register using measured evidence.
