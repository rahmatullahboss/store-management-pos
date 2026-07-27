# MOD-A: Catalog, Pricing and Tax

## Assignment

One agent owns this entire workpack. It must complete catalog, pricing and the global tax-calculation foundation together. Do not split products, pricing, promotions or tax among separate agents.

```text
Git branch:   module/catalog-pricing-tax-v1
Worktree:     .worktrees/catalog-pricing-tax
Neon branch:  dev/module-catalog-pricing-tax
Base:         program/foundation-v1
```

## Mission

Deliver one authoritative product and calculation domain used consistently by admin, POS, sales, purchasing, inventory and integrations.

## Owned paths and schemas

```text
modules/catalog/**
modules/pricing/**
modules/tax/**
database/modules/catalog/**
database/modules/pricing/**
database/modules/tax/**
apps/admin-web/src/modules/catalog/**
apps/admin-web/src/modules/pricing/**
docs/modules/catalog-pricing-tax/**
PostgreSQL schemas: catalog, pricing, tax
```

## Complete scope

- products, variants, options, categories, brands, tags and lifecycle;
- multiple barcodes, SKU rules and barcode normalization;
- units of measure and exact conversion rules;
- product media/localized content references;
- supplier item references and purchase/sell/stock units;
- bundles/kits definition without manufacturing execution;
- serial, batch and expiry policy metadata;
- product search projection and POS catalog feed;
- catalog import dry run, execution, error report and export;
- currencies, precision and rounding metadata consumed from foundation;
- price lists by currency, location, channel, customer group, quantity and date;
- tax-inclusive and tax-exclusive prices;
- scheduled prices and margin/minimum-price controls;
- manual discount rules and approval integration;
- promotion rules, coupons, thresholds, buy-X-get-Y and deterministic allocation;
- stackability, priority, limits and redemption records;
- global tax code, jurisdiction, rate and effective-version model;
- inclusive, exclusive, multiple, compound, exempt, zero-rated and reverse-charge calculation primitives;
- immutable calculation snapshot preserving prices, discounts, tax components, rules and rounding;
- return/refund allocation from original calculation snapshots;
- admin UI for all owned workflows;
- module APIs, events, permissions, audit and observability.

## Contract responsibilities

Produce:

- catalog item/variant/barcode/unit reference implementation;
- `CalculatePriceAndTax` command/query;
- immutable `PriceTaxSnapshot`;
- product/price/tax change events;
- catalog snapshot/incremental cursor for POS and connectors.

Consume:

- tenant/legal entity/store/customer context;
- Money, Quantity, BusinessDate, locale and approval contracts;
- country-pack tax configuration adapter contract.

## Required invariants

- no binary floating point for price, tax, discount or conversion;
- used products/variants are archived, not deleted;
- barcode uniqueness follows tenant and namespace rules;
- unit conversion is exact and versioned;
- calculation components always sum to persisted document totals;
- return allocation never invents a different original price/tax basis;
- historical snapshots remain reproducible after rule changes;
- every externally retried command is idempotent;
- all rows and search projections are tenant isolated.

## Required tests

- variant/barcode/unit uniqueness and conversion properties;
- inclusive/exclusive/compound tax golden cases;
- discounts/promotions allocation and stacking;
- currency/cash rounding edge cases;
- scheduled/effective-date boundaries and timezone behavior;
- stale price snapshot and optimistic concurrency;
- large catalog import and search performance;
- POS catalog snapshot and incremental rebuild;
- tenant isolation and permission/approval matrix;
- return reproduction from historical snapshot;
- duplicate event/command handling.

## Open-source reuse guidance

Permissive libraries may be used for barcode, decimal, validation and search helpers after provenance review. ERPNext, Odoo and OCA code are reference-only for this workpack unless a separate approved reuse record explicitly permits a file.

## Completion gate

- owned migrations run on a fresh foundation Neon branch;
- 250,000 representative variants import and search within approved budgets;
- POS/catalog consumers pass contract fixtures;
- exact price/tax snapshot is used by admin and test checkout fixture;
- all calculation golden/property tests pass;
- permission, audit, idempotency and tenant-isolation tests pass;
- events and migration compatibility pass integration review;
- module UI is complete and accessible;
- runbook, performance report and handoff are complete;
- handoff path: `docs/agent-handoffs/MOD-A-handoff.md`.
