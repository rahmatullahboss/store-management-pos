# Feature Catalogue and Release Classification

## Priority notation

- **P0:** required for the first sellable production release.
- **P1:** required for a competitive growth release.
- **P2:** enterprise, advanced or vertical expansion.
- **Pack:** country-, provider- or industry-specific extension.

## 1. Platform, tenant and organization

| Feature | Priority | Notes |
|---|---:|---|
| Tenant provisioning | P0 | Automated SaaS tenant creation and lifecycle |
| Legal entity | P0 | Base currency, tax registration, fiscal settings |
| Store and warehouse | P0 | Separate sales and stock locations |
| Bin/location hierarchy | P1 | Zone, aisle, rack, shelf, bin |
| Register/till enrollment | P0 | Device-bound POS identity |
| Business-day calendar | P0 | Store timezone and day-close boundary |
| Document number sequences | P0 | Fiscal-year and store/legal-entity scoping |
| Departments/cost centers | P1 | Accounting and management dimensions |
| Multi-company consolidation | P2 | Elimination and consolidated statements |
| Franchise/group hierarchy | P2 | Group visibility with tenant-level controls |
| Data-region placement | P1 | Region selected at provisioning |
| Plan and entitlement engine | P0 | Feature gates and usage limits |

## 2. Identity, roles and approvals

| Feature | Priority | Notes |
|---|---:|---|
| User invitations | P0 | Tenant-scoped membership |
| MFA | P0 | Required for privileged roles |
| RBAC | P0 | Module/action permissions |
| Location scope | P0 | Store/warehouse restrictions |
| Approval policies | P0 | Discounts, refunds, voids, cash movement |
| Device enrollment | P0 | Register token and revocation |
| Login/session audit | P0 | Security event trail |
| Support impersonation | P1 | Explicit approval and audit |
| OIDC/SAML SSO | P2 | Enterprise plan |
| SCIM provisioning | P2 | Enterprise plan |
| Segregation-of-duties rules | P2 | Prevent conflicting finance roles |

## 3. Product information management

| Feature | Priority | Notes |
|---|---:|---|
| Products and variants | P0 | Shared catalog identity |
| Categories, brands and tags | P0 | Hierarchical categories |
| Multiple barcodes | P0 | GTIN and internal codes |
| Barcode label printing | P0 | Template and printer support |
| Units of measure | P0 | Buy/sell/stock conversions |
| Weighted barcode parsing | P1 | Grocery/localized patterns |
| Product bundles/kits | P1 | Fixed and dynamic bundles |
| Serial and batch policy | P1 | Item-level tracking policy |
| Expiry/shelf-life policy | P1 | FEFO support later |
| Localized name/description | P1 | Language variants |
| Product media in R2 | P0 | Images and documents |
| Supplier item references | P0 | Supplier SKU and cost |
| Customs/HS codes | P1 | International trade |
| Product custom fields | P1 | Governed schema extensions |
| Catalog import/export | P0 | Dry run and validation |

## 4. Pricing, tax and promotion

| Feature | Priority | Notes |
|---|---:|---|
| Base price per currency | P0 | Exact monetary storage |
| Location/channel price lists | P0 | POS, wholesale, ecommerce |
| Customer-group pricing | P1 | B2B/loyalty pricing |
| Quantity breaks | P1 | Tier pricing |
| Scheduled price change | P1 | Effective dates |
| Inclusive/exclusive taxes | P0 | Country pack configuration |
| Multiple/compound taxes | P1 | Jurisdiction-specific |
| Manual line/order discount | P0 | Reason and permission |
| Coupon/promotion engine | P1 | Rule evaluation and allocation |
| Buy-X-get-Y | P1 | Deterministic allocation |
| Mix-and-match | P2 | Advanced retail promotion |
| Margin/minimum price guard | P1 | Approval below threshold |
| Price rounding rules | Pack | Cash and fiscal rounding |
| Customer-specific contracts | P2 | Wholesale pricing |

## 5. Inventory and warehouse

| Feature | Priority | Notes |
|---|---:|---|
| Immutable stock ledger | P0 | Source of truth for quantity |
| Current stock balance projection | P0 | Rebuildable materialized balance |
| On-hand/available/reserved | P0 | Separate stock semantics |
| Receiving | P0 | Partial receipt and discrepancy |
| Transfer order | P0 | Dispatch, in-transit, receive |
| Stock adjustment | P0 | Reason and approval |
| Full physical count | P0 | Freeze/snapshot policy |
| Cycle counting | P1 | ABC scheduling |
| Blind count/recount | P1 | Fraud reduction |
| Batch/lot tracking | P1 | Traceability and recalls |
| Serial tracking | P1 | Warranty and uniqueness |
| Expiry and FEFO | P1 | Perishable inventory |
| Damaged/quarantine stock | P1 | Non-saleable disposition |
| Negative-stock policy | P0 | Block, warn or allow by policy |
| Reorder point/min-max | P1 | Purchase proposals |
| Safety stock and lead time | P1 | Planning inputs |
| Bin putaway and picking | P1 | Warehouse execution |
| Wave picking | P2 | High-volume fulfillment |
| Landed cost | P1 | Freight/duty allocation |
| FIFO costing | P0 | Cost layers |
| Weighted-average costing | P1 | Tenant policy |
| Specific identification | P2 | High-value serialized goods |
| Stock aging/dead stock | P1 | Reporting projection |

## 6. Procurement and supplier management

| Feature | Priority | Notes |
|---|---:|---|
| Suppliers and terms | P0 | Contacts, tax IDs, currency |
| Purchase requisition | P1 | Internal request and approval |
| Request for quotation | P1 | Supplier comparison |
| Purchase order | P0 | Partial and amended orders |
| Goods receipt | P0 | Stock posting source |
| Supplier return | P1 | Return and debit note |
| Supplier bill | P0 | AP posting |
| Three-way match | P1 | PO, receipt, bill |
| Approval workflow | P0 | Amount/department/location |
| Replenishment proposal | P1 | Rules and demand |
| Dropship purchase | P2 | Customer-order linkage |
| Supplier performance | P1 | Lead time, fill rate, defects |
| Purchase landed costs | P1 | Allocation to cost layers |
| Supplier portal | P2 | PO acknowledgement and ASN |

## 7. Sales and order management

| Feature | Priority | Notes |
|---|---:|---|
| Quote | P0 | Convert to order/sale |
| Sales order | P0 | Allocation and fulfillment |
| Invoice/receipt | P0 | Legal document adapter |
| Credit note | P0 | Reversal/adjustment document |
| Partial fulfillment | P1 | Split quantities |
| Backorder | P1 | Deferred fulfillment |
| Preorder | P1 | Future stock |
| Deposit/layaway | P1 | Liability and allocation |
| Customer credit sale | P1 | Credit limit and AR |
| Return authorization | P1 | Approval and item condition |
| Exchange | P0 | Return plus replacement sale |
| Store pickup | P1 | Reservation and handover |
| Ship from store | P1 | Store fulfillment |
| Split fulfillment | P2 | Multiple locations/packages |
| Salesperson commission basis | P1 | Configurable, not direct payroll |
| Order import/channel connector | P1 | Ecommerce/marketplace |

## 8. POS and cash operations

| Feature | Priority | Notes |
|---|---:|---|
| Touch/barcode checkout | P0 | Keyboard and touchscreen optimized |
| Local product/price index | P0 | Offline and fast search |
| Customer lookup/create | P0 | Minimal quick-create workflow |
| Split tender | P0 | Multiple payment methods |
| Cash tender/change | P0 | Currency rounding rules |
| Card terminal adapter | P0 | Provider-specific integration |
| Gift card/store credit | P1 | Liability ledger |
| Suspend/resume cart | P0 | Local and online recovery |
| Return/refund/exchange | P0 | Receipt lookup and policy |
| Manager override | P0 | PIN/device approval |
| Receipt print/email/SMS | P0 | Country templates |
| Shift opening float | P0 | Cash session start |
| Paid-in/paid-out | P0 | Reason and approval |
| Cash drop | P1 | Safe management |
| Blind cash close | P0 | Expected value hidden by policy |
| Cash variance | P0 | Explanation and approval |
| Offline operation log | P0 | Idempotent sync protocol |
| Offline card payment | Pack | Only provider/device-supported |
| Customer display | P1 | Browser/native adapter |
| Scale integration | P1 | Hardware bridge |
| Self-checkout | P2 | Specialized risk controls |
| Mobile POS | P1 | PWA/native shell |

## 9. Payment, settlement and banking

| Feature | Priority | Notes |
|---|---:|---|
| Provider-neutral payment intent | P0 | State machine |
| Authorization/capture/void | P0 | Capability-dependent |
| Refund | P0 | Full and partial |
| Webhook verification | P0 | Signature and replay protection |
| Idempotency keys | P0 | Requests and callbacks |
| Tokenized stored method | P1 | Provider vault only |
| Settlement import | P1 | Provider reports/API |
| Fee accounting | P1 | Gross-to-net reconciliation |
| Chargeback/dispute | P2 | Case workflow |
| Bank accounts | P0 | Ledger and reconciliation |
| Bank statement import | P1 | OFX/CSV/provider APIs |
| Auto reconciliation | P1 | Rule-based matching |
| Cash deposit tracking | P1 | Shift-to-bank chain |
| Multi-provider routing | P2 | Region/store rules |

## 10. Customers, loyalty and credit

| Feature | Priority | Notes |
|---|---:|---|
| Customer profiles | P0 | Person/company |
| Address/contact/tax ID | P0 | Multiple records |
| Unified order history | P0 | POS and online |
| Customer groups | P0 | Pricing/tax/loyalty |
| Loyalty points | P1 | Earn/redeem/expire ledger |
| Loyalty tiers | P1 | Benefits and qualification |
| Gift cards | P1 | Issue/redeem/expire |
| Store credit | P1 | Return and goodwill liability |
| Credit limit/terms | P1 | AR controls |
| Customer statement | P1 | Open invoices/payments |
| Consent/preferences | P0 | Marketing and privacy |
| Data export/anonymization | P1 | Legal workflow |
| Duplicate merge | P1 | Audit-preserving merge |
| Segmentation | P2 | Analytics-based |

## 11. Accounting and finance

| Feature | Priority | Notes |
|---|---:|---|
| Chart of accounts | P0 | Country-pack template |
| Double-entry journal | P0 | Immutable posted entries |
| Automatic sales posting | P0 | Revenue, tax, tender/AR |
| Inventory/COGS posting | P0 | Cost layer consumption |
| Purchase/AP posting | P0 | Inventory/expense and payable |
| Payment posting | P0 | Clearing/cash/bank |
| Returns/refunds posting | P0 | Controlled reversals |
| Fiscal periods and locks | P0 | Close controls |
| Manual journals | P1 | Approval and attachments |
| Receivables/payables aging | P0 | Customer/supplier balances |
| Trial balance | P0 | Drill-through |
| P&L and balance sheet | P0 | Country mapping |
| Cash flow statement | P1 | Direct/indirect pack |
| Multi-currency | P1 | Transaction and base currency |
| FX revaluation | P2 | Period-end workflow |
| Budgeting | P2 | Management finance |
| Fixed assets | P2 | Separate module |
| Consolidation/intercompany | P2 | Enterprise |
| Statutory tax reports | Pack | Country-specific |
| E-invoice/fiscal reporting | Pack | Certified provider/adapters |

## 12. Reporting and analytics

| Feature | Priority | Notes |
|---|---:|---|
| Owner dashboard | P0 | Sales, margin, cash, stock alerts |
| Store manager dashboard | P0 | Today/shift/stock/actions |
| Finance dashboard | P1 | AR/AP/tax/close/reconciliation |
| Daily sales report | P0 | Gross-to-net waterfall |
| Tender/cash report | P0 | Shift and settlement |
| Product/category report | P0 | Units, revenue, margin |
| Inventory movement/valuation | P0 | Ledger drill-through |
| Purchase/supplier report | P1 | Cost and performance |
| Customer report | P1 | Frequency, value, credit |
| Saved filters/views | P1 | Role-scoped |
| Scheduled report delivery | P1 | Email/object storage |
| Custom report builder | P2 | Governed semantic layer |
| Cohort/forecasting | P2 | Analytics warehouse |
| Metric catalog | P0 | Definition, owner, version |

## 13. Internationalization and country packs

| Feature | Priority | Notes |
|---|---:|---|
| Unicode and BCP 47 locale | P0 | Language/region/script |
| CLDR formatting | P0 | Number, currency, dates, plural |
| IANA timezone | P0 | Store and user zones |
| RTL layout | P1 | Arabic/Hebrew support |
| Multiple currencies | P1 | Pricing and accounting |
| Country tax rules | Pack | Effective-dated configuration |
| Fiscal receipt adapter | Pack | Device/cloud provider |
| E-invoice adapter | Pack | Country schema and signing |
| Country chart of accounts | Pack | Template and mappings |
| Legal document templates | Pack | Invoice/credit/receipt |
| Cash rounding | Pack | Currency/country rules |
| Data-retention rules | Pack | Legal policy configuration |
| Data residency | P1 | Regional deployment policy |

## 14. Integrations and extension platform

| Feature | Priority | Notes |
|---|---:|---|
| Public REST API | P1 | Stable, versioned contracts |
| API keys and OAuth | P1 | Scopes and quotas |
| Signed webhooks | P1 | Replay and dead-letter tooling |
| Payment adapter SDK | P0 | Internal initially |
| Tax/fiscal adapter SDK | P1 | Country integrations |
| Shipping adapter SDK | P1 | Labels/tracking/rates |
| Ecommerce connectors | P1 | Shopify/WooCommerce/etc. |
| Accounting export connectors | P1 | External accountant workflows |
| Import mapping templates | P0 | Products/customers/opening stock |
| Workflow automation | P2 | Trigger-condition-action |
| App marketplace | P2 | Review and permission model |
| Customer code execution | P2 | Only with explicit platform need |

## 15. Vertical packs

| Pack | Earliest phase | Dependencies |
|---|---:|---|
| Grocery | P1 | Weighted items, expiry, scale, fast labels |
| Fashion | P1 | Variant matrix, season, transfer, omnichannel |
| Electronics | P1 | Serial, warranty, repair handoff |
| Wholesale | P1 | Credit, quotes, price lists, pack units |
| Restaurant | P2 | Tables, courses, KDS, recipe inventory |
| Pharmacy | P2 | Prescription/regulatory/cold chain |
| Service/repair | P2 | Work orders, parts, labor, warranty |
| Manufacturing | P2 | BOM, routing, production and planning |

## 16. Feature-flag policy

Every non-trivial P1/P2 feature must have:

- tenant entitlement;
- rollout percentage or allowlist;
- observable success/error metrics;
- safe default-off behavior;
- schema compatibility before activation;
- documented rollback/disable path.

Financial and ledger invariants must never be feature-flagged into inconsistent combinations.
