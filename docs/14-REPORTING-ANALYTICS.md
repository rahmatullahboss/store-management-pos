# Reporting and Analytics Architecture

## 1. Reporting principles

Every dashboard number must answer:

- what is the exact metric definition;
- which business date/timezone and currency were used;
- what filters and dimensions apply;
- when the data was refreshed;
- which documents and ledger entries produced the result;
- whether the number is operational, accounting or forecast data.

Do not place unexplained totals on dashboards. Metrics must drill through to source documents and authoritative ledgers.

## 2. Reporting layers

### Layer A — Transactional drill-through

PostgreSQL source documents and ledgers provide:

- sale/invoice/return detail;
- stock movement and cost layers;
- payment/cash events;
- journal entries;
- purchase/receipt documents;
- approvals and audit evidence.

This layer favors correctness and traceability, not broad analytical scans.

### Layer B — Operational projections

Near-real-time projections support daily work:

- sales by store/register/hour/product;
- stock balances and low-stock alerts;
- open orders/purchases;
- cash/tender and settlement state;
- reconciliation exceptions;
- current AR/AP aging;
- provider/fiscal processing state.

Projections are updated through transactional writes where necessary or outbox/queue consumers. They are rebuildable and carry an “as of” timestamp/cursor.

### Layer C — Analytics warehouse

Use later for:

- long-range trends and cohorts;
- high-cardinality/custom BI;
- demand forecasting;
- customer segmentation;
- multi-year store/product analysis;
- enterprise data sharing.

Warehouse exports are governed, incremental and reconciled to ledger/control totals.

## 3. Metric catalog

Each metric has:

```text
metric_id
name and description
business owner
formula and inclusion/exclusion rules
time grain and business-date rule
currency conversion rule
dimensions
source tables/events
freshness target
version/effective date
known limitations
reconciliation control
```

Changing a formula creates a new version. Historical reports record the metric version used.

## 4. Sales waterfall

Recommended standard definitions:

```text
Gross merchandise sales
- item/order discounts allocated to lines
= discounted merchandise sales
+ service/shipping/fees included by definition
- sales returns/credit adjustments
= net sales before tax
+ tax collected
+ cash rounding/other explicit adjustments
= customer-facing transaction total
```

Do not mix tax-inclusive customer receipts with net revenue silently. Reports must label whether tax and returns are included.

Key metrics:

- gross sales;
- discounts;
- returns;
- net sales;
- tax collected;
- units sold/returned;
- average transaction value;
- items per transaction;
- transaction count;
- gross profit and gross margin;
- sales per labor hour only after reliable labor integration;
- conversion rate only when traffic data exists.

## 5. Margin and COGS

Gross profit:

```text
net sales excluding tax - cost of goods sold
```

COGS must come from inventory costing entries, not current product cost. Reports disclose:

- costing method;
- provisional/unvalued entries;
- landed-cost/revaluation impact;
- return-cost method;
- currency conversion;
- negative-stock exceptions.

Margin drill-through links sale line to cost-layer consumption and journal entries.

## 6. Inventory metrics

- on hand;
- sellable on hand;
- reserved/committed;
- available to promise;
- in transit;
- damaged/quarantine;
- inventory valuation;
- stock movement by type;
- shrinkage/count variance;
- stock turn;
- days of inventory;
- aging and dead stock;
- stockout rate;
- fill rate;
- reorder recommendation;
- batch/expiry exposure.

Every quantity specifies unit, location, status and “as of” time. Availability is policy-defined and may differ by channel.

## 7. Procurement metrics

- purchase amount and received value;
- open/overdue purchase orders;
- supplier fill rate;
- lead-time actual vs expected;
- purchase price variance;
- receipt discrepancy;
- supplier return/defect rate;
- three-way match exceptions;
- payable and upcoming cash requirement;
- landed-cost composition.

## 8. Cash, tender and payment metrics

- expected vs counted cash;
- shift variance;
- paid-in/out and safe drops;
- tender mix;
- payment authorization/capture failure;
- refunds by tender/reason;
- unsettled amount;
- settlement gross, fees and net;
- chargebacks/disputes;
- deposit-to-bank status;
- reconciliation exceptions.

A card sale is not automatically a bank receipt. Separate authorization, capture, settlement and bank reconciliation.

## 9. Accounting reports

P0 reports:

- chart of accounts;
- journal and general ledger;
- trial balance;
- profit and loss;
- balance sheet;
- AR/AP aging;
- customer/supplier statements;
- tax summary/detail;
- cash/bank ledger and reconciliation;
- inventory valuation and COGS reconciliation.

P1/P2:

- cash flow;
- budget vs actual;
- multi-currency revaluation;
- consolidation/intercompany;
- statutory country reports;
- audit workpapers.

Financial statements read posted journals and mapping versions, not operational estimates.

## 10. Dashboard design by role

### Owner/MD

Show:

- net sales and gross margin trend;
- cash/bank/settlement position;
- top/bottom stores/categories/products;
- stock value, stockout, dead stock and shrinkage;
- receivable/payable exposure;
- unresolved high-risk exceptions;
- comparison to prior equivalent period/target.

Every card includes period, currency, freshness and drill-down.

### Store manager

Show:

- today’s sales/transactions/margin vs comparison;
- active shifts/register health;
- cash variance and pending approvals;
- low/negative stock and transfers;
- returns/discount/void exceptions;
- offline/sync/hardware issues;
- open pickup/fulfillment tasks.

Prioritize actions, not only totals.

### Finance/accounting

Show:

- unposted/failed posting exceptions;
- bank/settlement reconciliation;
- AR/AP aging;
- tax/fiscal status;
- period close checklist;
- stock-to-GL reconciliation;
- cash variance and manual journals;
- exchange-rate/revaluation status.

### Inventory/purchasing

Show:

- low/over stock;
- incoming/in-transit;
- count/reconciliation tasks;
- supplier delays/fill rate;
- purchase price changes;
- expiring/slow/dead stock;
- reorder proposals.

### Cashier

Only operational information needed for the shift:

- current shift/register;
- connection/sync status;
- pending carts/operations;
- allowed approvals/action prompts;
- no broad business-sensitive analytics by default.

## 11. Drill-through chain

Example sales KPI:

```text
Dashboard net sales
 -> store/day/product aggregate
 -> sales documents
 -> invoice/credit lines and pricing snapshot
 -> tax/discount allocation
 -> payment transactions
 -> stock/cost entries
 -> journal posting group
```

The UI preserves filters and explains differences such as returns posted in another period or settlement delays.

## 12. Dimensional model

Common dimensions:

- tenant/business group/legal entity;
- store/warehouse/register;
- business date/time/hour;
- product/variant/category/brand;
- customer/group/channel;
- salesperson/cashier;
- supplier;
- currency;
- tax jurisdiction/code;
- tender/provider;
- promotion/discount reason;
- source channel/order type;
- accounting dimensions/cost center.

Use surrogate warehouse dimension keys with slowly changing dimension strategy where historical attributes matter. Transactional IDs remain available for drill-through.

## 13. Currency reporting

Reports expose:

- transaction currency amount;
- legal-entity base currency;
- optional presentation currency;
- exchange-rate type/source/date;
- realized/unrealized FX where relevant.

Do not add amounts across currencies without an explicit conversion method. Consolidated reports state conversion basis and rounding differences.

## 14. Time and comparison periods

All operational reports use store/legal-entity business dates. Comparison options include:

- previous day/week/period;
- same weekday/week in prior period;
- prior year equivalent;
- target/budget;
- custom matched date range.

Clarify partial-current-period comparison. A live day at noon should not be compared blindly to a full prior day without labeling.

## 15. Data freshness

Every report response includes:

- generated/read timestamp;
- projection high-water cursor;
- latest included business event time;
- freshness status;
- known pending reconciliation/valuation state.

Critical operational cards target near-real-time freshness. Heavy analytical reports may be delayed and scheduled.

## 16. Reconciliation controls

Automated controls:

- sales totals to invoice/credit documents;
- tender totals to payment/cash ledgers;
- settlement to provider/bank;
- stock balances to stock ledger;
- inventory valuation to GL;
- AR/AP subledgers to control accounts;
- tax reports to tax journal/document components;
- analytics projection totals to transactional controls.

Differences create exceptions with amount, dimensions, suspected cause and repair workflow. Reports must not hide unreconciled data.

## 17. Custom reporting

Do not initially expose raw SQL. Later options:

- saved filters and columns;
- pivot/grouping over governed semantic metrics;
- scheduled exports;
- approved report templates;
- analytics warehouse connection for enterprise;
- row/column security and query cost limits.

Custom definitions have owners, permissions, versioning and data-freshness labels.

## 18. Exports and scheduled delivery

- CSV/XLSX for data; PDF for fixed statements/documents.
- Snapshot filters, metric version, timezone and currency.
- Formula-injection protection.
- Asynchronous generation through Workflows/R2.
- Short-lived signed links and audit.
- Recipient/role authorization checked at generation and delivery.
- Retention policy and automatic cleanup.

## 19. Forecasting and AI

Defer advanced AI until:

- historical data is clean and reconciled;
- stockouts/promotions/returns are represented;
- demand and availability definitions are stable;
- sufficient history exists;
- predictions have confidence/inputs and human override.

Early deterministic replenishment using reorder point, lead time, safety stock and recent demand is more valuable than opaque forecasting.

## 20. Acceptance criteria

- Metric catalog exists for every dashboard KPI.
- Gross/net/tax/returns definitions are consistent across screens and exports.
- Margin uses actual costing entries.
- Every headline KPI drills to source records.
- Data freshness and currency/timezone are visible.
- Stock, payment, subledger and analytics reconciliation jobs run and surface differences.
- Role dashboards prioritize relevant actions and permissions.
- Large reports do not overload transactional checkout workloads.
- Historical reports preserve metric/rule versions.
- Custom reporting cannot bypass tenant/data permissions.
