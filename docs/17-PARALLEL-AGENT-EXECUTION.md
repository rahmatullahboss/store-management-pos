# Parallel Module-Agent Execution Plan

## 1. Purpose

This plan allows multiple coding agents to build the platform in parallel without turning every small task into a separate agent assignment.

The unit of delegation is a **large bounded module workpack**. One agent owns the complete module workpack from database design through API, UI, tests, documentation and integration evidence. The workpack may contain many internal tasks, but the owning agent must complete all of them itself.

## 2. Non-negotiable delegation rule

- Do not create one agent per endpoint, table, screen, migration or test.
- Do not divide a module's database, backend and frontend among separate agents.
- Do not let several agents edit the same module concurrently.
- One workpack has one owner from branch creation until integration handoff.
- An agent may use an internal checklist, but may not delegate its checklist items to other agents.
- New agents are added only for a new large bounded module, not because a module has become difficult.

## 3. Program structure

```text
Stage F0: Foundation agent — exclusive, completed first

After Foundation Gate:
  Module Agent A — Catalog, Pricing and Tax
  Module Agent B — Inventory and Procurement
  Module Agent C — Customer, Sales and Fulfillment
  Module Agent D — POS, Cash, Offline and Hardware
  Module Agent E — Payments, Accounting and Banking
  Module Agent F — Localization, Country Packs and Compliance
  Module Agent G — Reporting, Integrations and SaaS Administration

Program Integrator — controls contract changes, merge order and cross-module verification
```

The seven module agents may develop concurrently after the foundation branch and contract pack are frozen. Their pull requests are integrated in a controlled order rather than merged simultaneously.

## 4. Stage F0 — Foundation agent

### Branches

```text
Git:  program/foundation-v1
Neon: dev/foundation-v1
```

### Foundation mission

Deliver the complete shared platform on which every module agent can work without changing shared infrastructure.

### Foundation ownership

- monorepo and package layout;
- Cloudflare Workers application shell;
- admin/POS web application shells;
- direct Neon serverless-driver adapter;
- HTTP and WebSocket transaction helpers;
- migration runner and module migration registry;
- PostgreSQL schema ownership conventions;
- tenant, legal entity, store, warehouse and register primitives;
- identity, membership, RBAC, approval and audit baseline;
- exact Money, Quantity, Currency, Locale, Timezone and BusinessDate types;
- UUID, idempotency, optimistic concurrency and error contracts;
- transactional outbox/inbox and domain-event envelope;
- R2 file abstraction, Queue and Workflow adapters;
- API conventions, authentication middleware and request context;
- module contract packages and event schemas;
- shared UI design system, navigation, permissions and localization shell;
- observability, structured logging and test harness;
- CI/CD, preview deployment and Neon branch automation;
- architecture boundary tests and license/SBOM pipeline.

### Foundation must not implement

The foundation agent must not fully implement catalog, stock, purchasing, sales, POS, payment, accounting, reporting or country-pack business functionality. It may create thin contract fixtures and one disposable reference vertical slice solely to prove infrastructure.

### Foundation Gate

No module agent starts until all conditions pass:

1. Repository layout and module ownership map are committed.
2. Direct Neon connectivity works in HTTP and request-scoped WebSocket modes.
3. Tenant/RLS context is proven by integration tests.
4. Module migrations can run independently and deterministically.
5. A Neon database branch can be created automatically for a Git branch/PR.
6. Shared Money, Quantity, BusinessDate and idempotency contracts are frozen as `v1`.
7. Event/outbox/inbox contracts are frozen as `v1`.
8. Authentication, permission, approval and audit primitives are usable.
9. Module boundary tests prevent cross-module persistence imports.
10. CI runs unit, database, architecture, security and license checks.
11. Each workpack has owned paths, schemas, APIs and events.
12. Foundation branch has no unresolved placeholder or undocumented breaking decision.

## 5. Module workpacks

| ID | Workpack | Git branch | Neon branch | Owned document |
|---|---|---|---|---|
| MOD-A | Catalog, Pricing and Tax | `module/catalog-pricing-tax-v1` | `dev/module-catalog-pricing-tax` | `agent-workpacks/MOD-A-CATALOG-PRICING-TAX.md` |
| MOD-B | Inventory and Procurement | `module/inventory-procurement-v1` | `dev/module-inventory-procurement` | `agent-workpacks/MOD-B-INVENTORY-PROCUREMENT.md` |
| MOD-C | Customer, Sales and Fulfillment | `module/customer-sales-fulfillment-v1` | `dev/module-customer-sales-fulfillment` | `agent-workpacks/MOD-C-CUSTOMER-SALES-FULFILLMENT.md` |
| MOD-D | POS, Cash, Offline and Hardware | `module/pos-cash-offline-v1` | `dev/module-pos-cash-offline` | `agent-workpacks/MOD-D-POS-CASH-OFFLINE.md` |
| MOD-E | Payments, Accounting and Banking | `module/payments-accounting-banking-v1` | `dev/module-payments-accounting-banking` | `agent-workpacks/MOD-E-PAYMENTS-ACCOUNTING-BANKING.md` |
| MOD-F | Localization, Country Packs and Compliance | `module/localization-compliance-v1` | `dev/module-localization-compliance` | `agent-workpacks/MOD-F-LOCALIZATION-COMPLIANCE.md` |
| MOD-G | Reporting, Integrations and SaaS Administration | `module/reporting-integrations-saas-v1` | `dev/module-reporting-integrations` | `agent-workpacks/MOD-G-REPORTING-INTEGRATIONS-SAAS.md` |

## 6. Repository ownership model

Target structure:

```text
apps/
  api/
  admin-web/
  pos-web/
  worker-jobs/

packages/
  foundation/
  contracts/
  ui/
  testing/

modules/
  catalog/
  pricing/
  tax/
  inventory/
  procurement/
  customer/
  sales/
  fulfillment/
  pos/
  cash/
  offline/
  payments/
  accounting/
  banking/
  localization/
  compliance/
  reporting/
  integrations/
  saas-admin/

database/
  foundation/
  modules/<module>/migrations/

docs/
  contracts/
  adr/
  agent-workpacks/
```

Each workpack owns only its listed module directories, its migrations, tests and module documentation. Shared `foundation`, `contracts`, CI configuration and top-level application composition are controlled by the foundation/program integrator.

## 7. PostgreSQL ownership model

Use separate PostgreSQL schemas or equivalently enforceable namespaces for module-owned tables:

```text
platform
catalog
pricing
tax
inventory
procurement
customer
sales
fulfillment
pos
cash
payment
accounting
banking
localization
integration
reporting
```

Rules:

- Only the owning module writes its schema.
- Foreign keys across schemas require an approved contract and migration review.
- Prefer stable IDs and service/application interfaces over arbitrary cross-schema writes.
- Reporting reads through approved projections, views or exported events.
- A module agent may not add tables to another module's schema.
- Shared enum/type changes require a contract-change request.
- Each module has its own migration sequence, for example `INV-0001`, `INV-0002`.
- The global migration runner applies foundation first, then modules in the documented deterministic order.

## 8. Contract-first parallelism

Foundation publishes `v1` contracts before agents start:

- entity identifier types;
- tenant/location context;
- catalog item/variant reference;
- price/tax calculation request and snapshot;
- stock availability/reservation/posting interfaces;
- customer and sales document references;
- payment intent/status interfaces;
- accounting posting instruction/result;
- receipt/fiscal document contract;
- domain event envelope;
- error/idempotency/audit metadata.

Module agents build against these contracts even when another module is not yet merged. Contract fixtures and simulators stand in for the real provider module during development.

## 9. Contract-change protocol

An agent must not directly modify a shared contract to make its module easier.

Required process:

1. Create `docs/contracts/change-requests/CR-<number>-<title>.md`.
2. Explain the current contract, requested change, affected modules, migration and compatibility.
3. Provide a backward-compatible option where possible.
4. Program integrator approves, rejects or schedules the change.
5. Foundation/contracts change lands in the integration branch first.
6. A new contract version or additive field is published.
7. Affected agents rebase at a controlled checkpoint.

Emergency direct edits to shared contracts invalidate the module handoff.

## 10. Git and worktree strategy

For each workpack:

```text
base: program/foundation-v1
branch: module/<workpack>-v1
worktree: .worktrees/<workpack>
```

Rules:

- One agent, one Git branch, one worktree and one Neon branch.
- Agents do not work in the root checkout.
- Agents do not merge another module branch into their own.
- Agents may rebase/merge from the controlled integration branch only at declared checkpoints.
- Commit at coherent module milestones, not every tiny file edit.
- Do not squash away meaningful migration or architecture checkpoints before review.
- No force-push after integration review begins unless authorized.

## 11. Neon branch strategy

Neon branches isolate database changes for parallel agents.

Workflow:

1. Foundation creates the approved `dev/foundation-v1` branch.
2. Each module Neon branch is created from the same foundation snapshot.
3. The module agent applies only foundation and owned migrations.
4. Synthetic/golden fixtures are loaded.
5. PR CI creates a separate preview Neon branch from the integration baseline.
6. The PR's migrations and tests run in isolation.
7. Preview/test branches are deleted after completion.
8. Production migrations are applied only by the release workflow after merge approval.

No agent is permitted to use the production Neon branch as a development target.

## 12. Development concurrency versus merge order

All modules may be developed concurrently after the Foundation Gate, but integration follows this recommended order:

1. MOD-A Catalog, Pricing and Tax
2. MOD-B Inventory and Procurement
3. MOD-C Customer, Sales and Fulfillment
4. MOD-E Payments, Accounting and Banking
5. MOD-D POS, Cash, Offline and Hardware
6. MOD-F Localization, Country Packs and Compliance
7. MOD-G Reporting, Integrations and SaaS Administration

This order reflects runtime dependencies, not agent priority. Agents D, F and G may still work from contract fixtures while earlier modules are under development.

## 13. Required module-agent output

Every module agent delivers one complete workpack containing:

- module domain model and state machines;
- owned PostgreSQL schemas and migrations;
- repositories and application services;
- command/query APIs;
- domain events and outbox integration;
- authorization, approval and audit rules;
- module UI and required POS/admin flows;
- imports/exports where in scope;
- exact money, quantity, timezone and localization behavior;
- idempotency, concurrency and failure recovery;
- unit, property, database, contract and end-to-end tests;
- performance evidence;
- observability metrics and runbook;
- security/privacy review;
- module documentation and ADRs;
- integration simulator/fixtures for dependencies;
- final handoff report listing commits, migrations, known limitations and exact integration steps.

A backend-only or CRUD-only module is incomplete.

## 14. Workpack completion gate

A module PR is eligible for integration only when:

1. Every acceptance criterion in its workpack passes.
2. No owned checklist item remains deferred without approved scope change.
3. No other module's owned path or schema was changed.
4. Shared contract changes were approved and landed separately.
5. Module migrations run from a fresh foundation Neon branch.
6. Upgrade and rollback/forward-fix behavior is tested.
7. Tenant isolation, idempotency and audit tests pass.
8. Module events pass schema and consumer-fixture tests.
9. Required UI workflows are usable and accessible.
10. Performance and failure tests meet budgets.
11. Source provenance and license checks pass.
12. Documentation and handoff report are complete.

## 15. Program integrator responsibilities

The integrator is not another feature agent. It owns:

- foundation and shared-contract changes;
- module ownership enforcement;
- integration branch and merge order;
- migration compatibility and schema diff review;
- cross-module event/API contract tests;
- end-to-end purchase-to-stock and sale-to-cash scenarios;
- conflict resolution with the module owner;
- release gates, changelog and final architecture verification.

The integrator must not silently rewrite a module after handoff. Material fixes return to the module owner branch or are recorded as an explicit integration patch.

## 16. Cross-module integration scenarios

The integration branch must prove:

- catalog item -> purchase order -> goods receipt -> stock ledger -> AP journal;
- catalog price/tax -> sales order -> payment -> stock issue -> COGS and revenue journal;
- return -> refund -> restock/disposition -> credit journal;
- transfer dispatch -> in transit -> receipt;
- POS online and offline checkout -> sync -> identical authoritative effects;
- cash shift -> tender totals -> settlement/bank reconciliation;
- country pack -> tax/fiscal document -> accounting/reporting;
- dashboard KPI -> source document -> payment/stock/journal drill-through.

## 17. Status tracking

The machine-readable board is `docs/agent-workpacks/program-board.yaml`.

Allowed status values:

```text
blocked
ready
active
handoff_ready
integration_review
integrated
rework
complete
```

Status is changed only when evidence links are present. Percentage estimates are optional and never replace acceptance gates.

## 18. Prohibited patterns

- one agent per small TODO;
- several agents editing one module;
- shared mutable development database;
- direct root-workspace edits by module agents;
- changing shared contracts without CR approval;
- cross-module direct table writes;
- module PR containing unrelated refactors;
- declaring completion with missing UI/tests/migrations;
- merging all module branches at once;
- using production data or credentials in agent branches;
- copying open-source code without provenance/license approval.

## 19. Starting sequence

1. Approve these planning documents.
2. Initialize Git repository and protected branches.
3. Execute the Foundation workpack with one agent.
4. Pass the Foundation Gate.
5. Create seven Git worktrees and Neon branches from the frozen foundation baseline.
6. Start the seven module agents with their entire workpack documents.
7. Run controlled checkpoints without splitting their internal work.
8. Integrate one module at a time using the defined order and cross-module scenarios.
9. Harden the combined product before adding new vertical modules.
