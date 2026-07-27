# MOD-C: Customer, Sales and Fulfillment

## Assignment

One agent owns customer management, sales documents, returns and fulfillment as one complete workpack. Do not split CRM, orders, invoices, returns or shipment workflows among separate agents.

```text
Git branch:   module/customer-sales-fulfillment-v1
Worktree:     .worktrees/customer-sales-fulfillment
Neon branch:  dev/module-customer-sales-fulfillment
Base:         program/foundation-v1
```

## Mission

Deliver the authoritative customer and order lifecycle shared by back-office sales, POS, ecommerce connectors and fulfillment operations.

## Owned paths and schemas

```text
modules/customer/**
modules/sales/**
modules/fulfillment/**
database/modules/customer/**
database/modules/sales/**
database/modules/fulfillment/**
apps/admin-web/src/modules/customer/**
apps/admin-web/src/modules/sales/**
apps/admin-web/src/modules/fulfillment/**
docs/modules/customer-sales-fulfillment/**
PostgreSQL schemas: customer, sales, fulfillment
```

## Complete scope

- customer person/company profiles, contacts, addresses and tax identity references;
- customer groups, tags, communication preferences and consent history;
- duplicate detection and audit-preserving merge;
- customer credit profile, terms and credit-limit checks;
- quote, sales order, invoice/receipt reference and credit-note business documents;
- independent order, payment, fulfillment, invoice and return statuses;
- partial payment and partial fulfillment representation;
- deposits, layaway, preorder and backorder states;
- immutable price/tax snapshot consumption from MOD-A contract;
- stock reservation/issue/return contract consumption from MOD-B;
- customer credit/on-account sale request to MOD-E;
- return authorization, condition, restock/disposition, exchange and refund request;
- pickup, local delivery, ship-from-store and split fulfillment;
- pick, pack, ship, tracking and proof of pickup/delivery;
- salesperson and commission-basis metadata without payroll;
- order notes, attachments and customer communication records;
- customer and order import/export;
- admin UI, APIs, events, permissions, approvals, audit and observability.

## Contract responsibilities

Produce:

- customer reference and credit-check request;
- sales quote/order/invoice/return references;
- checkout-ready order request for POS;
- fulfillment request/status contract;
- sale completed/returned and fulfillment changed events;
- refund request referencing original payment allocation.

Consume:

- product/price/tax snapshot contracts;
- stock availability/reservation/posting contracts;
- payment/refund status contracts;
- accounting posting instruction contract;
- receipt/fiscal document contract.

## Required invariants

- no single overloaded status represents payment, fulfillment and invoicing;
- posted invoice/credit/return documents are immutable;
- returns preserve original line, tax and discount allocation;
- returned quantity/value cannot exceed policy without explicit approval;
- fulfillment cannot consume more than confirmed/allocated quantity;
- customer merge preserves every historical reference and audit identity;
- credit sale cannot exceed approved limit without authorization;
- idempotent retries cannot duplicate order, invoice, stock or refund requests;
- tenant, legal entity, store and business-date scope is explicit.

## Required tests

- quote-to-order conversion and version conflicts;
- partial fulfillment/payment and backorder;
- return, exchange and partial refund allocation;
- pickup and ship-from-store state transitions;
- final reservation/stock conflict fixture;
- customer credit limit and approval;
- duplicate customer merge;
- cancellation after payment/fulfillment edge cases;
- sales document numbering concurrency fixture;
- tenant/location permissions;
- duplicate command/event replay;
- large order/customer query performance;
- accounting/payment/inventory consumer contract fixtures.

## Open-source reuse guidance

Medusa MIT code or patterns may be considered for isolated headless commerce components after file-level review and provenance. ERPNext/Odoo sales code remains reference-only for the proprietary core unless separately approved.

## Completion gate

- quote-to-order-to-fulfillment and return/exchange vertical slices pass;
- immutable sales/return documents preserve complete calculation snapshots;
- inventory, payment and accounting contract fixtures reconcile;
- customer credit and duplicate-merge workflows are complete;
- admin UI covers sales, customers, returns and fulfillment tasks;
- migrations run from a fresh foundation Neon branch;
- idempotency, concurrency, tenant isolation and audit tests pass;
- events, performance evidence, runbook and documentation are complete;
- handoff path: `docs/agent-handoffs/MOD-C-handoff.md`.
