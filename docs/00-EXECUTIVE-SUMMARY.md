# Executive Summary

## Objective

Build an international, multi-tenant store-management and POS platform that can serve independent shops, multi-branch retailers, wholesalers, and selected verticals without rebuilding the financial and inventory foundation for every country or industry.

The platform must unify:

- in-store and assisted selling;
- product and pricing management;
- inventory and warehouse control;
- purchasing and supplier management;
- customer, loyalty and credit management;
- cash, payment and accounting operations;
- omnichannel order workflows;
- international taxation and localization;
- reporting, audit, integration and automation.

## Market conclusions

Large products converge on the same core capabilities but differentiate in emphasis:

- **Shopify POS** leads with unified online/offline commerce, centralized product/customer/order data, multi-location inventory and omnichannel fulfillment.
- **Square for Retail** emphasizes fast setup, integrated payments, practical retail workflows, offline payments, purchase orders and inventory counting.
- **Lightspeed Retail** emphasizes deeper retail inventory, multi-location operations, configurable pricing, supplier workflows and analytics.
- **NetSuite** combines POS and commerce with enterprise accounting, purchasing, planning, inventory valuation and cross-location control.
- **Odoo** demonstrates the value of a modular integrated suite covering POS, inventory, accounting, CRM, ecommerce and manufacturing.
- **Zoho Inventory** demonstrates focused order, warehouse, serial/batch, fulfillment and automation capabilities for SMBs.

The product should not attempt to win by reproducing every feature at launch. It should win through a reliable ledger foundation, international configuration, excellent POS usability, explainable reporting, lower operational complexity and extensibility.

## Architecture conclusion

### Recommended

**Cloudflare-first hybrid modular monolith**:

```text
POS PWA / Admin Web / Mobile
        |
Cloudflare CDN, WAF, Turnstile, Access
        |
Cloudflare Workers API + BFF
        |
Domain modules in one deployable application
        |
Neon serverless driver over HTTP/WebSockets
        |
Canonical Neon PostgreSQL

Supporting services:
- Durable Objects: register/store coordination and serialized counters
- Queues: asynchronous event delivery
- Workflows: durable multi-step business processes
- R2: files, media, documents, imports and exports
- KV/Cache: non-authoritative configuration and safe caches
- Analytics store: governed reporting projections
```

### Why not Cloudflare-only

D1 and SQLite-backed Durable Objects are valuable, but the canonical database must support a long-lived accounting ledger, inventory valuation, rich relational constraints, complex reporting, migrations, ecosystem tooling and deployment portability. PostgreSQL is the safer default for that responsibility.

D1 remains useful for bounded per-tenant data, offline-support projections, integration state, prototypes and read-oriented workloads. Durable Objects remain useful when one logical coordinator must serialize operations. Neither should become the sole global source of truth merely to claim a fully native stack.

## Product architecture conclusion

Start with a **modular monolith**, not microservices:

- one repository and one main backend deployment;
- explicit module ownership and dependency rules;
- transactional consistency inside PostgreSQL;
- outbox events for asynchronous work and integrations;
- independent web/POS clients;
- extract services only after measured need.

Proposed bounded modules:

1. Identity and Access
2. Tenant and Organization
3. Catalog
4. Pricing and Promotions
5. Inventory
6. Procurement
7. Sales and Orders
8. POS and Cash Management
9. Payments
10. Customers and Loyalty
11. Accounting and Tax
12. Fulfillment and Logistics
13. Reporting and Analytics
14. Integrations and Automation
15. Localization and Compliance
16. Subscription and SaaS Billing

## Data design conclusion

The design must use three separate but connected ledgers:

1. **Stock ledger** — every quantity movement by item, location, batch/serial and cost layer.
2. **Financial ledger** — double-entry journals with balanced debits and credits.
3. **Payment/cash ledger** — tender, settlement, refund, cash drawer and reconciliation events.

Sales documents are business documents; they are not themselves the source of inventory or accounting balances. Posting a sale creates linked immutable ledger effects in one controlled transaction or a recoverable posting workflow.

## Internationalization conclusion

International support requires more than translation:

- BCP 47 locale identifiers;
- Unicode and RTL layouts;
- CLDR formatting for numbers, currencies, dates and plural rules;
- ISO currency codes and exact currency precision;
- IANA timezone identifiers and tenant/store business dates;
- configurable inclusive/exclusive/compound taxes;
- multiple legal entities and tax registrations;
- versioned country packs for invoice numbering, fiscal receipts, e-invoicing, chart of accounts and statutory reports;
- pluggable payment and tax providers by country;
- configurable data residency and retention policies.

A country is considered supported only after its localization pack passes legal, accounting and operational validation. The core platform may be globally deployable while specific fiscal capabilities remain certified country by country.

## Open-source conclusion

Open-source systems should reduce research and implementation effort, but code should not be copied casually.

Recommended use:

- ERPNext: study accounting, stock, procurement and ERP document flows; GPL-3.0 makes direct proprietary reuse risky.
- Odoo Community and OCA: study module boundaries, POS UX, pricing, units and business workflows; LGPL/AGPL boundaries require legal review.
- Apache OFBiz: strong reference for entity models and enterprise workflows under a permissive Apache license.
- Medusa: potential MIT-licensed source for headless commerce concepts and selected integration patterns; it does not replace POS/accounting.
- Open Source POS: useful feature and workflow reference, but its modified MIT terms require attribution/footer review.
- Dolibarr and NexoPOS: useful comparative references; copyleft or product-specific licenses make direct reuse less attractive.

Prefer copying ideas, tests, data models and workflow knowledge. Direct code import requires an SPDX inventory, legal approval, attribution and ongoing update ownership.

## Recommended delivery strategy

### Foundation release

- organization, store, warehouse, register and user setup;
- products, variants, barcodes, units, taxes and prices;
- purchasing, receiving, transfers, counts and adjustments;
- POS sales, returns, discounts, cash drawer and receipts;
- customers and basic loyalty;
- immutable stock/payment/accounting postings;
- essential reports, audit and exports;
- one initial country pack plus generic international mode.

### Growth release

- multi-entity consolidation;
- omnichannel orders, pickup and ship-from-store;
- serial/batch/expiry and warranty;
- supplier planning and replenishment;
- advanced promotions and loyalty;
- ecommerce connectors and public API;
- regional payment integrations;
- more country packs.

### Enterprise/vertical release

- warehouse wave/pick/pack/ship;
- advanced planning and demand forecasting;
- enterprise approval policies;
- data warehouse and custom BI;
- restaurant, pharmacy, grocery, fashion or wholesale extensions;
- SSO/SCIM, regional data planes and advanced compliance.

## Critical risks

- Treating accounting as a collection of editable totals rather than a ledger.
- Implementing offline POS after the online product is already designed.
- Hard-coding one country’s tax and invoice assumptions into core tables.
- Using microservices before transactional boundaries and team ownership are understood.
- Allowing direct inventory quantity edits without stock ledger entries.
- Storing payment card data instead of using provider tokens and certified terminals.
- Copying GPL/AGPL code into a closed-source SaaS without legal analysis.
- Building dashboards directly on transactional tables without stable metrics definitions.
- Selling “international” before country packs and payment/fiscal integrations are validated.

## Success definition

The platform is successful when every sale can be traced from receipt to payment, stock movement, cost of goods, tax and journal entry; stores can continue selling during temporary network failure; new countries can be added through controlled localization packs; and the operational system scales globally without sacrificing financial correctness.
