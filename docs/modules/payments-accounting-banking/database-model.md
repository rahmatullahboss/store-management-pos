# MOD-E Canonical Database Model

## Deployment identity

- Git branch: `module/payments-accounting-banking-v1`
- Neon branch: `dev/module-payments-accounting-banking` (`br-rapid-fog-ax8tutgm`)
- Base: Foundation `57f21e8c14e27ce3ad96a862cf6de82c2c6cd27c`
- Migrations: `PAY-0001`, `ACC-0001`, `BNK-0001`

## Payment schema

Nine tenant-scoped tables cover provider accounts, terminal mappings, payment intents, provider attempts, immutable state events, immutable allocations, refunds, settlements and immutable settlement lines.

Database guards enforce:

- original intent identity, source and amount are immutable;
- captured cannot exceed intended and refunded cannot exceed captured;
- settlement net equals gross less fees and adjustments;
- state events, attempts, allocations and settlement lines are append-only;
- all tables have forced RLS;
- runtime receives SELECT only and no direct module DML.

## Accounting schema

Ten tenant-scoped tables cover charts, accounts, non-overlapping fiscal periods, versioned posting rules, posting groups, journal headers and lines, receivable/payable open items, immutable allocations and period-close runs.

Database guards enforce:

- journal lines are one-sided in transaction and base currency;
- a deferred constraint trigger requires at least two lines and exact transaction/base balance at commit;
- header control totals must equal line totals;
- posted journal headers and lines are immutable;
- posting-rule versions, open items and allocations are append-only;
- fiscal periods for one legal entity cannot overlap;
- all tables have forced RLS and runtime has no direct DML.

Drill-through views:

- `accounting.general_ledger_v`
- `accounting.trial_balance_v`
- `accounting.open_item_balances_v`

## Banking schema

Seven tenant-scoped tables cover bank accounts, statement imports, immutable statement content, versioned reconciliation rules, append-only reconciliation/reversal records, exceptions and reconciliation-run evidence.

Database guards enforce:

- duplicate files, line fingerprints and provider external IDs are rejected;
- imported statement identity and monetary content cannot be changed;
- reconciliation and rule records use append-only correction chains;
- run difference always equals statement total less matched total;
- all tables have forced RLS and runtime has no direct DML.

Drill-through views:

- `banking.unreconciled_statement_lines_v`
- `banking.settlement_bank_reconciliation_v`

## Verified evidence

Fresh local PostgreSQL rebuild:

- FND-0001 through FND-0005 plus PAY-0001, ACC-0001 and BNK-0001 applied with `ON_ERROR_STOP`;
- payment 9 tables / 9 forced-RLS tables;
- accounting 10 tables / 10 forced-RLS tables;
- banking 7 tables / 7 forced-RLS tables.

Isolated Neon branch:

- all three module markers recorded with expected manifest markers;
- 26 module tables and 26 forced-RLS tables;
- 15 non-internal business triggers;
- 5 finance/reconciliation views;
- 25 module permissions;
- zero direct runtime INSERT/UPDATE/DELETE grants.

`npm run test:database:mod-e` executes a rollback-only database drill proving settlement arithmetic, immutable money/journals/statements, deferred balance rejection, tenant isolation and runtime DML denial.
