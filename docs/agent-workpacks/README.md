# Module Agent Workpacks

## Operating rule

Each document in this directory is one indivisible, large implementation assignment for one agent. The owning agent completes the entire workpack, including its applicable database/backend/client/UI/tests/observability/documentation scope. Do not spawn separate agents for the internal checklist.

A client-only workpack such as MOB-01 does not invent a PostgreSQL business schema merely to match server-module structure. It owns the full native client, local data/sync, platform targets and contract integration while canonical domain data remains with the existing server modules.

## Execution order

1. `FOUNDATION-PLATFORM.md` is completed first by one exclusive foundation agent.
2. After the Foundation Gate, MOD-A through MOD-G may be developed concurrently according to dependency gates.
3. MOB-01 may develop its documentation, Flutter foundation and reviewed-contract workflows in parallel after MOD-D integration.
4. The program integrator merges workpacks one at a time in the order defined in `../17-PARALLEL-AGENT-EXECUTION.md` and `program-board.yaml`.
5. MOB-01 final integration follows MOD-G by default because governed reporting/OpenAPI/entitlement contracts are dependency-gated.

## Workpack index

- [Foundation Platform](FOUNDATION-PLATFORM.md)
- [MOD-A Catalog, Pricing and Tax](MOD-A-CATALOG-PRICING-TAX.md)
- [MOD-B Inventory and Procurement](MOD-B-INVENTORY-PROCUREMENT.md)
- [MOD-C Customer, Sales and Fulfillment](MOD-C-CUSTOMER-SALES-FULFILLMENT.md)
- [MOD-D POS, Cash, Offline and Hardware](MOD-D-POS-CASH-OFFLINE.md)
- [MOD-E Payments, Accounting and Banking](MOD-E-PAYMENTS-ACCOUNTING-BANKING.md)
- [MOD-F Localization, Country Packs and Compliance](MOD-F-LOCALIZATION-COMPLIANCE.md)
- [MOD-G Reporting, Integrations and SaaS Administration](MOD-G-REPORTING-INTEGRATIONS-SAAS.md)
- [MOB-01 Store Companion Mobile](MOB-01-STORE-COMPANION.md)
- [Module Agent Activation Policy](MODULE-AGENT-ACTIVATION-POLICY.md)
- [Program Board](program-board.yaml)

## Universal agent instructions

Every workpack agent must:

- read the full planning corpus and its workpack before changing code;
- work only in its assigned worktree, Git branch and required Neon branch;
- preserve existing dirty work and never discard another agent's changes;
- own the complete workpack rather than delegating internal tasks;
- obey owned-path and PostgreSQL-schema boundaries;
- use shared contracts without editing them directly;
- raise a contract-change request for any shared-contract deficiency;
- implement production-quality business rules, migrations, API and UI where owned;
- for clients, keep canonical business rules/authorization on the server and implement durable local/recovery behaviour only as documented;
- use exact Money/Quantity types, tenant scope, business dates and idempotency;
- emit/consume stable events through approved outbox/inbox/contracts;
- implement authorization, approval, audit and failure recovery;
- add workpack-level metrics, logs and runbooks;
- record every copied/adapted open-source file and dependency in the reuse register;
- create coherent checkpoint commits and a final handoff report;
- stop only at a clean workpack checkpoint or completed handoff;
- use the vendored Impeccable skill for every substantial UI surface and satisfy `docs/18-IMPECCABLE-DESIGN-WORKFLOW.md`;
- include design context, detector, accessibility, responsive and visual-review evidence in UI-bearing handoffs;
- never claim local worktree, device, Flutter, CI, Neon or deployment evidence that was not actually executed.

## Universal prohibitions

- no separate sub-agent per endpoint, table, screen, platform target or test;
- no cross-module direct database writes;
- no edits to another workpack's owned paths;
- no shared mutable development database;
- no production credentials or personal data in agent/preview branches;
- no unapproved breaking contract change;
- no GPL/AGPL/custom-license code copied into the proprietary core;
- no completion claim without applicable migrations/client local migrations, UI, tests, observability and documentation;
- no UI completion claim without the Impeccable UI completion gate;
- no mobile direct Neon access or second authoritative Firebase/Firestore/Supabase business store;
- no native POS/cash/hardware scope inside MOB-01.

## Required final handoff

Each agent creates:

```text
docs/agent-handoffs/<workpack-id>-handoff.md
```

The handoff contains:

- branch, worktree and required Neon branch;
- commit list/checkpoints;
- owned paths changed;
- server/local migrations and schema versions where applicable;
- APIs/events/contracts added or consumed;
- tests and commands run;
- performance/security/design evidence;
- contract change requests;
- open-source provenance entries;
- known limitations;
- exact integration and verification steps;
- explicit confirmation of no unauthorised production mutation/deployment.
