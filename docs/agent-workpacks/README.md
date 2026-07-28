# Module Agent Workpacks

## Operating rule

Each document in this directory is one indivisible, large implementation assignment for one agent. The owning agent completes the entire module workpack, including database, backend, frontend, tests, observability and documentation. Do not spawn separate agents for the internal checklist.

## Execution order

1. `FOUNDATION-PLATFORM.md` is completed first by one exclusive foundation agent.
2. After the Foundation Gate, MOD-A through MOD-G may be developed concurrently from the same frozen foundation baseline.
3. The program integrator merges modules one at a time in the order defined in `../17-PARALLEL-AGENT-EXECUTION.md`.

## Workpack index

- [Foundation Platform](FOUNDATION-PLATFORM.md)
- [MOD-A Catalog, Pricing and Tax](MOD-A-CATALOG-PRICING-TAX.md)
- [MOD-B Inventory and Procurement](MOD-B-INVENTORY-PROCUREMENT.md)
- [MOD-C Customer, Sales and Fulfillment](MOD-C-CUSTOMER-SALES-FULFILLMENT.md)
- [MOD-D POS, Cash, Offline and Hardware](MOD-D-POS-CASH-OFFLINE.md)
- [MOD-E Payments, Accounting and Banking](MOD-E-PAYMENTS-ACCOUNTING-BANKING.md)
- [MOD-F Localization, Country Packs and Compliance](MOD-F-LOCALIZATION-COMPLIANCE.md)
- [MOD-G Reporting, Integrations and SaaS Administration](MOD-G-REPORTING-INTEGRATIONS-SAAS.md)
- [Program Board](program-board.yaml)

## Universal agent instructions

Every workpack agent must:

- read the full planning corpus and its workpack before changing code;
- work only in its assigned worktree, Git branch and Neon branch;
- preserve existing dirty work and never discard another agent's changes;
- own the complete workpack rather than delegating internal tasks;
- obey owned-path and PostgreSQL-schema boundaries;
- use shared contracts without editing them directly;
- raise a contract-change request for any shared-contract deficiency;
- implement production-quality business rules, migrations, API, UI and tests;
- use exact Money/Quantity types, tenant scope, business dates and idempotency;
- emit stable domain events through the transactional outbox;
- implement authorization, approval, audit and failure recovery;
- add module-level metrics, logs and runbooks;
- record every copied/adapted open-source file in the reuse register;
- create coherent checkpoint commits and a final handoff report;
- stop only at a clean module checkpoint or completed handoff;
- use the vendored Impeccable skill for every substantial UI surface and satisfy `docs/18-IMPECCABLE-DESIGN-WORKFLOW.md`;
- include design context, detector, accessibility, responsive and visual-review evidence in UI-bearing handoffs.

## Universal prohibitions

- no separate sub-agent per endpoint, table, screen or test;
- no cross-module direct database writes;
- no edits to another workpack's owned paths;
- no shared mutable development database;
- no production credentials or personal data in agent/preview branches;
- no unapproved breaking contract change;
- no GPL/AGPL/custom-license code copied into the proprietary core;
- no completion claim without migrations, UI, tests and documentation;
- no UI completion claim without the Impeccable UI completion gate.

## Required final handoff

Each agent creates:

```text
docs/agent-handoffs/<workpack-id>-handoff.md
```

The handoff contains:

- branch and Neon branch;
- commit list/checkpoints;
- owned paths changed;
- migrations and schema versions;
- APIs/events added;
- tests and commands run;
- performance/security evidence;
- contract change requests;
- open-source provenance entries;
- known limitations;
- exact integration and verification steps.
