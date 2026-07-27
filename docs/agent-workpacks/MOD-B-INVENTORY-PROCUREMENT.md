# MOD-B: Inventory and Procurement

## Assignment

One agent owns the complete inventory and procurement workpack. Stock ledger, costing, warehouse operations, suppliers and purchasing remain together because purchase receiving is a primary source of inventory and valuation.

```text
Git branch:   module/inventory-procurement-v1
Worktree:     .worktrees/inventory-procurement
Neon branch:  dev/module-inventory-procurement
Base:         program/foundation-v1
```

## Mission

Deliver an immutable, explainable inventory system and complete purchase-to-stock workflow that other modules can consume only through stable contracts.

## Owned paths and schemas

```text
modules/inventory/**
modules/procurement/**
database/modules/inventory/**
database/modules/procurement/**
apps/admin-web/src/modules/inventory/**
apps/admin-web/src/modules/procurement/**
docs/modules/inventory-procurement/**
PostgreSQL schemas: inventory, procurement
```

## Complete scope

- warehouses, zones, bins and stock statuses;
- immutable stock ledger and rebuildable balance projection;
- on-hand, sellable, available, reserved, committed and in-transit semantics;
- stock reservations, expiry, consumption and release;
- opening stock through controlled ledger posting;
- adjustments, reasons, approvals and reversals;
- transfer order, dispatch, in-transit and receipt;
- physical count, blind count, recount and variance posting;
- batch, serial, expiry, damaged and quarantine handling;
- FIFO costing, weighted-average option and specific-identification contract;
- cost layers, consumption links, landed cost and revaluation;
- negative-stock policy and concurrent final-unit handling;
- reorder point, safety stock, min/max and supplier lead time;
- supplier master, terms, contacts and supplier item mapping;
- purchase requisition/RFQ baseline where P0/P1 scope requires;
- purchase order, approval, amendment and cancellation;
- partial receiving, discrepancy, quality/quarantine and backorder;
- supplier return, supplier bill reference and three-way-match result;
- replenishment proposals and supplier performance projections;
- stock/procurement APIs, UI, events, reports, audit and runbooks.

## Contract responsibilities

Produce:

- stock availability query;
- reservation create/consume/release interface;
- stock posting instruction/result;
- cost/COGS result contract;
- goods receipt and transfer events;
- inventory balance and movement projections.

Consume:

- catalog variant/unit/supplier-item contracts;
- Money, Quantity, BusinessDate and approval contracts;
- accounting posting instruction contract without writing accounting tables;
- sales/fulfillment references through fixtures during parallel development.

## Required invariants

- stock balance equals stock-ledger sum by all dimensions;
- every quantity/value change has a source document and posting group;
- posted stock entries are immutable and reversed by new entries;
- serialized item ownership is unique;
- transfer dispatch and receipt are distinct two-sided movements;
- reservation cannot be consumed twice;
- FIFO consumes the oldest eligible layer;
- current product cost never rewrites historical COGS;
- purchase order alone does not increase stock;
- tenant/location permissions and business dates are enforced.

## Required tests

- ledger/projection rebuild and reconciliation;
- concurrent final-unit sale/reservation;
- FIFO and weighted-average golden scenarios;
- transfer dispatch/in-transit/partial receipt;
- count snapshot, recount and variance approval;
- serial/batch/expiry uniqueness and traceability;
- negative-stock policy modes;
- purchase partial receipt, over/under tolerance and supplier return;
- landed-cost allocation and revaluation;
- duplicate posting/idempotency;
- large ledger/index/partition performance;
- tenant isolation and cross-location permissions;
- accounting consumer contract fixtures.

## Open-source reuse guidance

ERPNext and OFBiz may be studied for stock and purchase flows. ERPNext code remains reference-only. Apache-licensed OFBiz algorithms or fixtures may be adapted only with a file-level provenance record and Apache notice preservation.

## Completion gate

- all stock quantities and values rebuild from immutable ledgers;
- purchase-to-stock golden flow passes with partial receipt and return;
- stock reservation and final-unit concurrency tests pass;
- physical count and transfer workflows are complete in admin UI;
- accounting posting fixtures reconcile inventory and COGS expectations;
- migrations run independently on a fresh module Neon branch;
- performance, tenant isolation, audit and idempotency tests pass;
- runbook includes projection mismatch and stuck transfer recovery;
- handoff path: `docs/agent-handoffs/MOD-B-handoff.md`.
