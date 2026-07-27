# Product Requirements Document

## 1. Product vision

Create a globally deployable Store Operating System that gives a business one reliable source of truth for products, stock, purchasing, sales, POS, cash, customers, accounting and reporting across every store, warehouse and channel.

The product must be easy enough for a first-time small retailer but structurally sound enough for multi-branch and multi-legal-entity businesses.

## 2. Target customers

### Primary launch segment

- General retail SMBs.
- Grocery and convenience stores without complex regulated workflows.
- Fashion, electronics, home goods, cosmetics and specialty retail.
- Wholesalers/distributors with counter sales and basic credit.
- Businesses operating one to twenty stores and warehouses.

### Secondary segment

- Larger chains requiring advanced approvals, integrations and reporting.
- Franchises needing tenant/group-level visibility.
- Ecommerce merchants adding physical stores.
- Emerging-market businesses underserved by global payment/POS vendors.

### Deferred verticals

Restaurant, pharmacy, fuel, hospitality, manufacturing and service repair require dedicated extension packs and should not control the initial core model.

## 3. Personas

| Persona | Primary goals |
|---|---|
| Business owner | Profitability, cash, tax, stock and branch visibility |
| Managing director/CFO | Financial control, consolidation, audit and close |
| Store manager | Staff, shifts, stock, returns, discounts and daily close |
| Cashier | Fast, reliable and simple checkout, including offline operation |
| Inventory manager | Accurate stock, transfers, counts, receiving and replenishment |
| Purchaser | Supplier terms, purchase orders, lead times and cost control |
| Accountant | Journals, receivables, payables, tax, reconciliation and reports |
| Sales representative | Quotes, customer credit, orders and collections |
| Warehouse operator | Receive, put away, pick, pack, transfer and ship |
| Platform administrator | Tenants, plans, security, operations and support |
| Integration developer | Stable APIs, webhooks, sandboxes and observability |

## 4. Product principles

1. Correctness before convenience for posted financial and stock operations.
2. Fast default workflows with optional advanced controls.
3. Offline is a defined operating mode, not an error state.
4. Every important number has drill-through provenance.
5. Country and vertical behavior is configured through versioned packs.
6. Integrations use contracts, idempotency and replayable events.
7. Tenant boundaries are enforced in code, database policies and tests.
8. Posted history is corrected by reversal, not silent mutation.
9. The core remains provider-neutral for payment, tax, shipping and messaging.
10. Operational complexity must scale gradually with customer maturity.

## 5. Functional scope

### 5.1 Tenant and organization

- SaaS tenant signup, invitation and plan assignment.
- One tenant may contain one or more groups and legal entities.
- Legal entities contain tax registrations, fiscal settings, base currency and chart of accounts.
- Stores, warehouses, bins, registers and ecommerce channels.
- Store calendars, business-day boundaries and timezone configuration.
- Number sequences scoped by legal entity, store, document type and fiscal year.
- Brands, departments, cost centers and reporting dimensions.

### 5.2 Identity and access

- Email/password, magic link and optional social login.
- MFA and recovery codes.
- Enterprise SSO/OIDC/SAML and later SCIM.
- Role-based access control with scoped permissions.
- Attribute/policy rules for store, warehouse, legal entity and amount thresholds.
- Manager approval for voids, refunds, high discounts, cash movements and period override.
- Device/register enrollment and revocation.
- Session, login and privilege-change audit trail.

### 5.3 Catalog

- Products, variants, option sets and bundles/kits.
- Physical, service, digital, gift card and non-stock item types.
- Categories, brands, tags, collections and custom fields.
- Multiple barcodes per variant; GTIN/EAN/UPC/internal/weighted barcode patterns.
- Units of measure and conversions for buy/sell/stock units.
- Dimensions, weight, origin, customs codes and hazardous flags.
- Images, documents and localized content.
- Serial, batch/lot, expiry and warranty policies.
- Supplier item codes and preferred suppliers.
- Lifecycle state: draft, active, discontinued, archived.

### 5.4 Pricing and promotions

- Base prices by currency and sales channel.
- Price lists by customer group, location, quantity and date.
- Tax-inclusive and tax-exclusive prices.
- Scheduled prices and markdowns.
- Discounts by item, order, category, bundle, customer or coupon.
- Buy-X-get-Y, mix-and-match, tiered and threshold promotions.
- Stackability, exclusivity and promotion priority.
- Manual discount reason and approval controls.
- Cost, margin and minimum-price protection.
- Promotion allocation to line items for accounting and returns.

### 5.5 Inventory

- On-hand, available, committed, reserved, in-transit, damaged and quarantine states.
- Immutable stock ledger.
- Warehouse/location/bin stock balances derived from ledger postings.
- Purchase receiving, sales issue, return receipt, transfer, adjustment and count postings.
- Serial/batch/expiry traceability.
- Negative-stock policy by tenant/location/item.
- Stock reservations with expiry and release.
- Cycle counts and full physical counts.
- Blind counts, recounts, approvals and variance posting.
- Transfer orders with dispatch, in-transit and receipt states.
- Reorder point, safety stock, min/max and supplier lead time.
- FIFO, weighted average and optional specific identification; LIFO only where a country pack explicitly allows it.
- Landed cost allocation.
- Inventory aging, dead stock and shrinkage reporting.

### 5.6 Procurement

- Suppliers, contacts, addresses, tax IDs and payment terms.
- Requests for quotation and supplier quotations.
- Purchase requisitions and approval chains.
- Purchase orders, amendments and cancellations.
- Partial receiving, over/under receipt tolerance and backorders.
- Quality/quarantine decision.
- Supplier returns and debit notes.
- Supplier bills, three-way matching and payment status.
- Cost history and supplier performance.
- Automatic purchase proposals from replenishment rules.
- Dropship purchase linkage.

### 5.7 Sales and order management

- Quotations, sales orders, invoices and credit notes.
- POS and back-office assisted sales through one order domain.
- Draft, confirmed, allocated, fulfilled, invoiced, paid, cancelled and returned states.
- Partial fulfillment and partial payment.
- Deposits, layaway, preorder and backorder.
- Customer credit limits and on-account sales.
- Returns authorization, exchange and store-credit workflows.
- Delivery, pickup, ship-from-store and split fulfillment.
- Salesperson assignment and commission basis.
- Order notes, attachments and customer communication history.

### 5.8 POS

- Barcode-first product entry and configurable touch grid.
- Product/variant search, favorites and recent items.
- Customer selection or quick customer creation.
- Taxes, discounts, price override and manager approval.
- Multiple/split tenders.
- Cash, card, wallet, gift card, store credit, voucher, bank and custom tender types.
- Suspend/resume cart and retrieve cross-device where permitted.
- Quotations and sales orders from POS.
- Returns, exchanges, refunds and receipt lookup.
- Email, SMS, print and digital receipts.
- Offline sale queue with explicit risk and sync state.
- Shift open/close, opening float, paid-in/out, safe drop and cash count.
- Till assignment and shared/dedicated register modes.
- Hardware abstraction for scanners, printers, cash drawers, scales, customer displays and payment terminals.
- Configurable keyboard shortcuts and accessibility.

### 5.9 Payments and reconciliation

- Payment intent abstraction independent of provider.
- Authorization, capture, void, refund, failure, settlement and chargeback states.
- Tokenized customer payment methods where providers allow.
- Provider adapter SDK and webhook verification.
- Cash and non-cash tender ledgers.
- Settlement import and automatic matching.
- Bank account and statement reconciliation.
- Payment fees and net settlement accounting.
- Idempotency for every provider request and webhook.
- No storage of PAN, CVV or sensitive authentication data.

### 5.10 Customers, CRM and loyalty

- Customer/person/company profiles.
- Multiple addresses, contacts, tax IDs and communication preferences.
- Order, return, payment, loyalty and service history.
- Customer groups, segments and tags.
- Credit limits, payment terms and statements.
- Loyalty points, tiers, rewards and expiry.
- Gift cards, store credit and vouchers with liability accounting.
- Marketing consent and lawful-basis metadata.
- Duplicate detection and merge workflow.
- Customer data export/anonymization workflow subject to legal retention.

### 5.11 Accounting and tax

- Double-entry general ledger.
- Configurable chart of accounts by country pack.
- Journals, journal entries and journal lines.
- Accounts receivable and payable.
- Cash/bank accounts and reconciliation.
- Sales tax/VAT/GST rules with inclusive, exclusive, compound, exempt and reverse-charge support.
- Tax jurisdiction, registration and effective-date rules.
- Automatic accounting from sales, returns, purchases, stock and payments.
- Cost of goods sold and inventory valuation posting.
- Accrual and cash-basis reporting where permitted.
- Fiscal periods, close locks and controlled reopen.
- Trial balance, general ledger, balance sheet, profit and loss, cash flow and tax reports.
- Multi-currency documents, exchange rates and realized/unrealized gains/losses.
- Consolidation and intercompany deferred to a later enterprise phase.

### 5.12 Fulfillment and logistics

- Picklists, packing and shipment documents.
- Carrier, service level, tracking and label adapters.
- Click-and-collect and local delivery.
- Delivery zones and charges.
- Partial shipment and split location fulfillment.
- Failed delivery, return-to-sender and reshipment.
- Proof of pickup/delivery.

### 5.13 Reporting and analytics

- Daily sales, gross sales, net sales, returns, discounts and taxes.
- Tender, cash variance and settlement reports.
- Product, category, brand, employee, customer and store performance.
- Gross margin and cost-of-goods reporting.
- Stock valuation, movement, aging, availability and reorder.
- Purchase, supplier and receiving reports.
- Receivable, payable and accounting statements.
- Drill-through from KPI to document to ledger.
- Scheduled exports and role-scoped dashboards.
- Metric catalog with versioned definitions.

### 5.14 Integrations and automation

- Public REST API; selected GraphQL/read APIs only if justified.
- Signed outbound webhooks with retry and replay.
- Ecommerce, marketplace, payment, tax, fiscalization, shipping, accounting, messaging and identity adapters.
- CSV/XLSX imports with dry-run, validation and reversible batch tracking.
- Export jobs to CSV/XLSX/PDF/JSON.
- Event subscriptions and workflow automation.
- API keys, OAuth clients, scopes, quotas and audit.
- Sandbox/test tenants for partners.

### 5.15 SaaS administration

- Plans, entitlements, usage meters and billing.
- Tenant lifecycle, suspension and deletion controls.
- Feature flags and staged rollout.
- Support impersonation with approval, reason and full audit.
- Global status/incident handling.
- Regional tenant placement and data-residency policy.
- Backup, restore and tenant export tooling.

## 6. Non-functional requirements

### Performance

- POS product search p95 under 150 ms from local index.
- Online add-to-cart/price calculation p95 under 300 ms excluding external payment calls.
- POS interaction remains usable during network loss.
- Standard API read p95 under 400 ms globally under normal load.
- Standard API write p95 under 700 ms excluding durable external workflows.
- Dashboard landing view under two seconds with cached projections.

### Availability and durability

- Core online API target: 99.95% monthly availability after GA.
- POS degraded/offline selling for at least one business day, subject to configured risk policy.
- No acknowledged posted transaction may be lost.
- Point-in-time recovery and tested backup restore.
- RPO and RTO defined by plan/region; target enterprise RPO <= 5 minutes and RTO <= 60 minutes after maturity.

### Scale baseline

Architecture should support, without redesign:

- 100,000 tenants;
- 1,000 active stores for a large tenant;
- 10,000 registers for a large tenant;
- millions of catalog variants across the platform;
- high seasonal bursts;
- append-only ledgers growing to billions of entries through partitioning and archival.

These are design envelopes, not launch capacity promises.

### Security

- Strong tenant isolation.
- Encryption in transit and at rest.
- MFA, least privilege and secrets rotation.
- Signed builds, dependency scanning and SBOM.
- Audit records for privileged and financial actions.
- Provider-tokenized card processing.
- Rate limiting, bot protection and abuse controls.

### Accessibility

- Target WCAG 2.2 AA for back office and core POS workflows.
- Keyboard-first POS navigation.
- Screen-reader labels, visible focus and sufficient contrast.
- RTL support and responsive layouts.

### Maintainability

- Explicit module APIs and forbidden cross-module database access.
- Automated schema migrations and rollback/forward-fix playbooks.
- Contract tests for all integrations.
- Feature flags and backward-compatible API versioning.
- Architecture decision records for material changes.

## 7. Core invariants

1. Journal entry debits equal credits in transaction currency and base currency according to rounding policy.
2. Posted journal lines cannot be edited or deleted.
3. Stock balance equals the sum of stock ledger entries for the same dimensions.
4. A serialized item cannot have the same active serial number in two locations.
5. A payment/refund cannot exceed authorized business rules without approval.
6. A return references the original sale when available and preserves tax/discount allocation.
7. Every externally retried command is idempotent.
8. Tenant-scoped rows cannot be read or written outside tenant context.
9. Number sequences never produce duplicate legal document numbers within their scope.
10. Business dates use the store/legal-entity timezone and configured day boundary, not server UTC date.
11. Monetary totals are reproducible from immutable line, tax, discount and rounding components.
12. Deleting a user never destroys audit authorship; users are deactivated/pseudonymized as permitted.

## 8. Launch acceptance criteria

A launch candidate is not acceptable until:

- a sale can be completed online and offline;
- the same sale produces traceable stock, payment, tax and accounting effects;
- returns and refunds reverse or adjust those effects correctly;
- cash shifts reconcile and show variance;
- purchase receipt updates stock and accounting correctly;
- transfers preserve dispatch/in-transit/receipt states;
- physical counts create approved variance entries;
- multi-currency and timezone boundary tests pass;
- tenant isolation tests pass;
- backup restore and disaster recovery rehearsal pass;
- payment provider webhooks are idempotent and replayable;
- all headline dashboard metrics drill through to source records;
- the first country pack has accounting/tax review and documented limitations.

## 9. Explicit non-goals for MVP

- Full payroll and HR management.
- Manufacturing/MRP.
- General-purpose website builder.
- Marketplace seller payouts.
- Native card acquiring in every country.
- Automated legal compliance for every country at launch.
- AI forecasting before clean historical data and metric governance exist.
- Customer-written code execution through Workers for Platforms.
- Microservice decomposition.

## 10. Product metrics

### Adoption

- Time from signup to first completed sale.
- Percentage of tenants completing catalog import and first stock receipt.
- Weekly active stores and registers.

### Reliability

- Failed checkout rate.
- Offline sync success and conflict rate.
- Posting/reconciliation exceptions per 10,000 transactions.
- Payment webhook duplicate/error rate.

### Business value

- Inventory variance reduction.
- Stockout and overstock trends.
- Close time and unresolved cash variance.
- Gross margin visibility coverage.

### Product quality

- Support tickets per active store.
- POS task completion time.
- Report-to-source drill-through success.
- Country-pack defect rate.
