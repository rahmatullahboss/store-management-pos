# Domain and Data Model

## 1. Data-model goals

The data model must support:

- strict tenant isolation;
- multiple legal entities, stores, warehouses and registers;
- immutable stock, financial and payment history;
- international currencies, taxes, timezones and numbering;
- online and offline commands with idempotent replay;
- operational reads without weakening transactional correctness;
- long-term partitioning, archiving and auditability;
- future module extraction without shared-table chaos.

PostgreSQL is the canonical system of record. Every authoritative transactional table includes an immutable primary key, tenant scope, creation metadata and versioning/concurrency fields where applicable.

## 2. Identifier strategy

Use time-sortable, globally unique identifiers such as UUIDv7 for domain records.

Rules:

- Internal primary key: `uuid`/UUIDv7.
- Human/legal number: separate field generated from a scoped number sequence.
- External provider ID: separate namespaced mapping table.
- Offline operation ID: generated on the POS device and retained permanently.
- Never expose sequential database IDs as security boundaries.

Representative columns:

```sql
id uuid primary key,
tenant_id uuid not null,
created_at timestamptz not null,
created_by uuid null,
updated_at timestamptz not null,
version bigint not null default 1
```

## 3. Tenancy model

### Recommended launch model

Use a shared application and shared PostgreSQL clusters with tenant-scoped rows, supported by:

- mandatory `tenant_id` on tenant-owned tables;
- composite unique constraints beginning with `tenant_id`;
- PostgreSQL Row Level Security where operationally practical;
- application tenant context set per transaction;
- repository/query helpers that require tenant scope;
- isolation tests that intentionally attempt cross-tenant access;
- encryption keys and object-storage prefixes scoped by tenant/region.

### Regional placement

A global control plane stores only tenant routing and minimal subscription metadata. Each tenant is assigned to a regional data plane containing its canonical records. Cross-region analytical consolidation uses approved exported projections, not live cross-region transactional joins.

### Enterprise isolation options

Later plans may support:

- dedicated schema;
- dedicated database;
- dedicated regional cluster;
- customer-managed encryption key;
- dedicated Cloudflare account/zone only when contractually required.

The domain model must remain consistent across isolation tiers.

## 4. Organizational hierarchy

```text
Tenant
 └── Business Group (optional)
      └── Legal Entity
           ├── Tax Registration(s)
           ├── Fiscal Periods
           ├── Chart of Accounts
           ├── Stores
           │    └── Registers / Tills
           └── Warehouses
                └── Zones / Bins
```

Core tables:

- `tenants`
- `tenant_settings`
- `business_groups`
- `legal_entities`
- `legal_entity_registrations`
- `stores`
- `warehouses`
- `warehouse_bins`
- `registers`
- `business_calendars`
- `document_sequence_definitions`
- `document_sequence_allocations`
- `reporting_dimensions`
- `cost_centers`

A store may reference one default warehouse but must not be assumed to equal a warehouse. Some retailers sell from a store while stock is fulfilled from another facility.

## 5. Identity and authorization model

Core tables:

- `users`
- `tenant_memberships`
- `roles`
- `permissions`
- `role_permissions`
- `membership_roles`
- `access_scopes`
- `approval_policies`
- `approval_requests`
- `approval_actions`
- `devices`
- `register_device_bindings`
- `security_events`

Authorization decision dimensions:

- tenant;
- legal entity;
- store;
- warehouse;
- module/action;
- document state;
- monetary threshold;
- ownership/creator;
- time and device posture.

The authorization model should expose one policy-evaluation service. Domain modules must not implement ad hoc role-name checks.

## 6. Catalog model

```text
Product
 ├── Product Variant
 │    ├── Barcode(s)
 │    ├── Price(s)
 │    ├── Supplier Item(s)
 │    └── Inventory Policy
 ├── Product Option(s)
 ├── Category/Brand/Tag links
 ├── Media
 └── Localized Content
```

Core tables:

- `products`
- `product_variants`
- `product_options`
- `product_option_values`
- `variant_option_values`
- `categories`
- `product_categories`
- `brands`
- `tags`
- `product_tags`
- `barcodes`
- `units_of_measure`
- `unit_conversions`
- `product_media`
- `product_localizations`
- `product_custom_field_definitions`
- `product_custom_field_values`
- `supplier_items`
- `bundles`
- `bundle_components`

Important rules:

- SKU uniqueness is tenant-configurable but should normally be unique per tenant.
- Barcode uniqueness is enforced within the barcode namespace and tenant.
- Unit conversions are exact rational/decimal values with an explicit rounding rule.
- Product deletion becomes archival after transactional use.
- A variant’s stock-tracking mode cannot be changed after stock history exists without a migration workflow.

## 7. Money and currency model

### Storage

Store money using one of these safe approaches:

1. integer minor units plus currency code; or
2. PostgreSQL `numeric(38, n)` plus currency code and currency metadata.

Recommended domain representation:

```text
Money {
  amount_minor: bigint
  currency: ISO-4217 code
  scale: smallint derived from versioned currency metadata
}
```

For currencies or assets with non-standard precision, use a versioned currency table and exact decimal storage. Never use IEEE binary floating point for prices, tax, cost or journal amounts.

Core tables:

- `currencies`
- `currency_precision_versions`
- `exchange_rates`
- `exchange_rate_sources`
- `rounding_policies`

Every financial document stores:

- transaction currency;
- legal-entity base currency;
- exchange rate and source;
- transaction amounts;
- base-currency amounts;
- rounding adjustment details.

Historical transactions must not change when currency metadata later changes.

## 8. Pricing and tax model

Core tables:

- `price_lists`
- `price_list_assignments`
- `prices`
- `promotion_definitions`
- `promotion_conditions`
- `promotion_rewards`
- `promotion_redemptions`
- `tax_codes`
- `tax_rates`
- `tax_jurisdictions`
- `tax_registrations`
- `tax_rule_sets`
- `tax_rule_versions`
- `tax_exemptions`

Pricing inputs include:

- product/variant;
- unit;
- quantity;
- store/channel;
- customer/group;
- date/business date;
- currency;
- tax registration/jurisdiction;
- active promotions.

Pricing output must be persisted as a calculation snapshot:

- original unit price;
- effective unit price;
- line discount allocations;
- order discount allocations;
- taxable base;
- tax components;
- rounding components;
- rule IDs and versions used.

This snapshot ensures future returns and audits can reproduce the original transaction even after rules change.

## 9. Inventory model

### 9.1 Stock ledger

`stock_ledger_entries` is append-only and authoritative.

Representative fields:

```text
id
operation_id
posting_group_id
tenant_id
legal_entity_id
variant_id
warehouse_id
bin_id nullable
stock_status
batch_id nullable
serial_id nullable
quantity_delta
base_uom_id
unit_cost
currency
value_delta
movement_type
source_document_type
source_document_id
source_document_line_id
business_date
posted_at
reversal_of_entry_id nullable
```

Movement types include:

- purchase receipt;
- sale issue;
- customer return;
- supplier return;
- transfer dispatch;
- transfer receipt;
- adjustment gain/loss;
- physical-count variance;
- assembly consume/produce;
- status change;
- opening balance;
- reversal.

### 9.2 Stock balance projection

`stock_balances` is a derived projection keyed by:

- tenant;
- variant;
- warehouse/bin;
- stock status;
- batch/serial where relevant.

It may be updated transactionally with the ledger for immediate reads, but it must be rebuildable from ledger entries. Reconciliation jobs compare projection and ledger sums.

### 9.3 Reservation model

Core tables:

- `stock_reservations`
- `stock_reservation_lines`
- `reservation_events`

Reservation states:

- pending;
- active;
- partially consumed;
- consumed;
- expired;
- released;
- cancelled.

Availability formula is policy-driven, for example:

```text
available = sellable_on_hand - active_reservations - safety_hold
```

Do not hard-code one formula for all industries.

### 9.4 Costing

Core tables:

- `inventory_cost_layers`
- `inventory_cost_consumptions`
- `landed_cost_documents`
- `landed_cost_allocations`

FIFO requires explicit receipt layers and consumption links. Weighted average requires effective-dated average updates. Posted costing effects are corrected through adjustment/revaluation entries, not by changing historical rows.

### 9.5 Batch and serial

Core tables:

- `inventory_batches`
- `inventory_serials`
- `serial_events`
- `batch_quality_events`

Enforce unique active serial ownership and maintain full movement history.

## 10. Procurement model

Core documents and tables:

- `suppliers`
- `supplier_contacts`
- `purchase_requisitions`
- `purchase_requisition_lines`
- `requests_for_quotation`
- `supplier_quotations`
- `purchase_orders`
- `purchase_order_lines`
- `goods_receipts`
- `goods_receipt_lines`
- `supplier_returns`
- `supplier_bills`
- `supplier_bill_lines`
- `three_way_match_results`

Documents use explicit state machines. A goods receipt, not merely a purchase order, posts stock. A supplier bill posts payable/accounting effects according to the configured accrual policy.

## 11. Sales and order model

Recommended separation:

- `sales_quotes`
- `sales_orders`
- `sales_order_lines`
- `fulfillment_orders`
- `fulfillment_lines`
- `shipments`
- `invoices`
- `invoice_lines`
- `credit_notes`
- `returns`
- `return_lines`
- `exchanges`

For small POS cash sales, the API may present one atomic checkout command, but internally it should create the correct order/invoice/payment/stock artifacts in a posting group.

Core states should be explicit and monotonic where possible. Avoid a single overloaded `status` that attempts to represent payment, fulfillment, invoicing and return state simultaneously.

Suggested dimensions:

```text
order_status
payment_status
fulfillment_status
invoice_status
return_status
```

## 12. POS and cash-session model

Core tables:

- `pos_sessions`
- `pos_shifts`
- `cash_drawers`
- `cash_drawer_events`
- `cash_counts`
- `pos_carts`
- `pos_operations`
- `offline_sync_batches`
- `offline_sync_results`
- `receipt_snapshots`

`cash_drawer_events` is append-only and contains:

- opening float;
- cash sale;
- cash refund;
- paid in;
- paid out;
- safe drop;
- transfer;
- closing count;
- variance adjustment.

Expected cash is derived from events. The closing count is an observed amount. Variance is the difference, preserved with explanation and approval.

## 13. Payment model

Core tables:

- `payment_intents`
- `payment_attempts`
- `payment_transactions`
- `payment_allocations`
- `payment_provider_accounts`
- `payment_provider_mappings`
- `refunds`
- `settlements`
- `settlement_lines`
- `chargebacks`
- `bank_accounts`
- `bank_statement_lines`
- `reconciliation_matches`

Provider states are mapped into a stable internal state machine. Raw provider payloads may be encrypted and retained according to policy, but sensitive card data must not be stored.

Every provider request and webhook includes a stable idempotency or deduplication key. Duplicate callbacks must be safe.

## 14. Accounting model

### 14.1 Core entities

- `accounts`
- `account_hierarchies`
- `journals`
- `journal_entries`
- `journal_lines`
- `fiscal_periods`
- `posting_rules`
- `posting_rule_versions`
- `accounting_dimensions`
- `dimension_values`
- `journal_line_dimensions`

### 14.2 Journal invariants

- Entry is either draft or posted.
- Posted entries are immutable.
- Sum of debits equals sum of credits per currency context.
- Every line has one account and legal entity.
- Source document and posting-rule version are retained.
- Reversal creates a new entry referencing the original.
- Closed periods reject new postings except authorized reopen/adjustment periods.

### 14.3 Posting groups

A business event such as checkout creates a `posting_group` linking:

- source sales document;
- stock ledger entries;
- payment transactions;
- journal entries;
- outbox events.

The posting group enables traceability and recovery without pretending all external effects occur in one database transaction.

## 15. Customer and loyalty model

Core tables:

- `customers`
- `customer_contacts`
- `customer_addresses`
- `customer_tax_profiles`
- `customer_groups`
- `customer_group_memberships`
- `customer_consents`
- `customer_credit_profiles`
- `loyalty_accounts`
- `loyalty_ledger_entries`
- `gift_cards`
- `gift_card_ledger_entries`
- `store_credit_accounts`
- `store_credit_ledger_entries`

Points, gift-card value and store credit use append-only liability ledgers. Current balances are projections.

## 16. Audit model

Core tables:

- `audit_events`
- `security_events`
- `data_access_events` for selected sensitive access;
- `entity_change_snapshots` where regulation/business need justifies;
- `approval_actions`.

Audit records capture:

- actor and impersonator;
- tenant and scope;
- action;
- entity type and ID;
- before/after hashes or selected safe fields;
- reason;
- device, IP and user agent;
- request/trace ID;
- timestamp and business date where relevant.

Do not store secrets or full payment payloads in general audit logs.

## 17. Outbox and integration model

Use a transactional outbox:

- domain transaction writes authoritative records and `outbox_events` together;
- a publisher sends events to Cloudflare Queues;
- consumers use event IDs/idempotency keys;
- processing outcomes are recorded;
- poison messages move to a dead-letter queue;
- replay tools can republish selected events.

Core tables:

- `outbox_events`
- `inbox_events`
- `webhook_subscriptions`
- `webhook_deliveries`
- `integration_connections`
- `integration_mappings`
- `integration_sync_cursors`
- `import_jobs`
- `import_job_rows`
- `export_jobs`

Because Cloudflare Queues provides at-least-once delivery, all consumers must be idempotent.

## 18. Offline operation model

Each POS operation stores:

```text
device_id
register_id
local_operation_id
local_sequence
operation_type
payload_schema_version
payload
created_at_local
created_at_monotonic
last_known_server_cursor
signature/auth context
sync_status
server_result_id
```

The server keeps an inbox keyed by `(tenant_id, device_id, local_operation_id)`. Replays return the original result. Operations with invalid prerequisites enter a conflict/review state rather than disappearing.

Legal invoice/receipt numbering is handled through one of:

- preallocated signed number ranges;
- fiscal device/provider authority;
- provisional offline receipt followed by legal document issuance after sync, only where allowed;
- online-only fiscal completion for jurisdictions that require it.

The country pack decides the permitted strategy.

## 19. Temporal and business-date model

Every event stores UTC `timestamptz`. Business documents additionally store:

- IANA timezone ID used;
- local business date;
- local timestamp/offset snapshot where necessary;
- fiscal period ID;
- store day-close boundary version.

Never derive historical business dates from the tenant’s current timezone setting.

## 20. Soft delete, archival and retention

- Master data may use `archived_at`/status.
- Financial, stock, payment and audit entries are not soft-deleted in normal operations.
- Privacy deletion uses anonymization/pseudonymization while preserving legally required business records.
- Large ledgers are partitioned by regional cluster, tenant hash/legal entity and time as testing demonstrates.
- Old documents may move attachments to archival R2 classes while metadata remains queryable.
- Retention policy is effective-dated and country/contract aware.

## 21. Indexing strategy

Baseline indexes:

- every foreign key used in joins;
- `(tenant_id, id)` and tenant-leading business keys;
- document number by tenant/legal entity/type;
- ledger dimensions plus business date/posting time;
- barcode normalized value;
- SKU normalized value;
- open document states;
- provider external IDs;
- outbox unpublished status/time;
- offline device operation key.

Avoid indexing every custom field. Use explicit promoted fields or a search projection.

## 22. Search model

Do not run fuzzy catalog/customer search directly against normalized transaction tables at scale.

Use a governed search projection containing safe searchable fields. Launch options:

- PostgreSQL full-text/trigram for initial scale;
- a dedicated search service later if scale/typo tolerance requires;
- local POS index in IndexedDB/SQLite for offline search.

Search projections are rebuildable and never authoritative.

## 23. Data migrations and schema evolution

- Expand/contract migration pattern for zero-downtime changes.
- Backfills are resumable, observable and tenant-batched.
- Event and offline payloads are schema-versioned.
- Financial rule changes create new effective-dated versions.
- Country-pack migrations include validation and rollback/forward-fix plans.
- Never rewrite historical ledger meaning during a schema migration.

## 24. Required model validation tests

- Cross-tenant unique and access constraints.
- Balanced journals under all rounding/currency cases.
- Stock ledger/projection reconciliation.
- FIFO and weighted-average costing examples.
- Serial uniqueness and batch traceability.
- Return allocation of price, discount and tax.
- Duplicate payment webhook handling.
- Duplicate offline operation handling.
- Timezone/DST/business-day boundaries.
- Period close/reopen behavior.
- Number-sequence concurrency.
- Restore and projection rebuild from authoritative records.
