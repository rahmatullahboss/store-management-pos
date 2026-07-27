# MOD-E: Payments, Accounting and Banking

## Assignment

One agent owns payment state, double-entry accounting, receivables/payables and banking reconciliation as one complete financial workpack. Do not split payment integration, journal posting or banking among separate agents.

```text
Git branch:   module/payments-accounting-banking-v1
Worktree:     .worktrees/payments-accounting-banking
Neon branch:  dev/module-payments-accounting-banking
Base:         program/foundation-v1
```

## Mission

Deliver the canonical financial kernel so every commercial event is traceable from tender/provider state to balanced journals, subledgers, settlement and bank reconciliation.

## Owned paths and schemas

```text
modules/payments/**
modules/accounting/**
modules/banking/**
database/modules/payments/**
database/modules/accounting/**
database/modules/banking/**
apps/admin-web/src/modules/payments/**
apps/admin-web/src/modules/accounting/**
apps/admin-web/src/modules/banking/**
docs/modules/payments-accounting-banking/**
PostgreSQL schemas: payment, accounting, banking
```

## Complete scope

- provider-neutral payment intent, attempt, transaction and allocation state;
- authorization, capture, void, refund, failure, unknown, settlement and chargeback models;
- tokenized payment-method references without card data storage;
- provider capability interface, signed webhook normalization and idempotency;
- terminal/provider account mapping and payment recovery;
- cash/non-cash tender and settlement references consumed from POS;
- settlement import, fees, gross-to-net and provider reconciliation;
- bank accounts, statement import, matching and reconciliation;
- chart of accounts, journals, entries, lines and dimensions;
- immutable balanced double-entry posting and reversal;
- effective-dated posting rules and account mappings;
- sales, returns, tax, payment, COGS, inventory, purchase and AP posting interfaces;
- AR/AP subledgers, customer/supplier allocation, aging and statements;
- fiscal periods, close locks, controlled reopen and adjustment periods;
- multi-currency transaction/base amounts and realized/unrealized FX baseline;
- trial balance, general ledger, P&L, balance sheet and core reconciliation reports;
- stock-to-GL, AR/AP-to-control and payment-to-bank reconciliation;
- admin UI, APIs, events, approvals, audit, metrics and runbooks.

## Contract responsibilities

Produce:

- payment intent/status/refund/settlement contracts;
- accounting posting instruction/result;
- journal/posting group references;
- customer/supplier balance and allocation results;
- bank/settlement reconciliation status;
- financial control and exception events.

Consume:

- sales/invoice/return calculation snapshots;
- stock movement and costing results;
- purchase/receipt/supplier bill references;
- POS tender/cash shift events;
- country-pack chart, tax and statutory mappings.

## Required invariants

- posted journal debits equal credits in transaction/base contexts;
- posted journal/payment records are immutable;
- reversal creates new linked entries;
- duplicate provider callback or command cannot duplicate financial effects;
- unknown payment status blocks blind retry;
- AR/AP subledger totals reconcile to control accounts;
- inventory valuation/COGS reconcile to stock posting controls;
- closed periods reject ordinary posting;
- sensitive card data never enters database, logs or audit events;
- every posting retains source document, rule version and posting group.

## Required tests

- cash/card/split tender sales and returns;
- payment timeout, webhook recovery and duplicate callback;
- partial capture/refund and provider fee settlement;
- sales/tax/COGS and purchase/AP golden journals;
- period close, reversal and reopen controls;
- AR/AP allocation and aging;
- multi-currency and rounding differences;
- settlement-to-bank reconciliation;
- stock-to-GL and subledger-control reconciliation;
- journal balance property tests;
- provider contract simulator and sandbox tests;
- PCI-sensitive logging scans;
- concurrency, idempotency, tenant isolation and permissions.

## Open-source reuse guidance

ERPNext accounting code is GPL and remains reference-only. Apache OFBiz accounting concepts or Apache-licensed code may be adapted only with provenance and notice review. Payment SDKs are used through vendor-supported packages and certified flows.

## Completion gate

- accountant-approved sale, return, purchase and payment golden scenarios pass;
- payment timeout/replay cannot double-charge or double-post;
- posted journals are balanced, immutable and drillable;
- AR/AP, inventory and settlement controls reconcile;
- period close and controlled correction workflows are complete;
- admin finance/payment/banking UI is complete;
- migrations run on a fresh foundation Neon branch;
- security, idempotency, tenant isolation and performance tests pass;
- PCI data-flow, runbooks and handoff are complete;
- handoff path: `docs/agent-handoffs/MOD-E-handoff.md`.
