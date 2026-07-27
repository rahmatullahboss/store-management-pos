# Market Research

## Research method

This review compares representative international products across POS, retail operations, inventory, purchasing, accounting, ecommerce, reporting, extensibility and localization. It is based primarily on official product pages, documentation and public repositories reviewed on 2026-07-27.

The goal is not to rank vendors by popularity. The goal is to identify durable product patterns, gaps and implementation lessons for a new international platform.

## Competitor landscape

### Shopify POS

**Market position:** commerce-first platform connecting ecommerce and physical retail.

**Observed strengths**

- Unified product, customer, order and inventory data across online and physical channels.
- Multi-location inventory, transfers, purchase orders, receiving and adjustments.
- Buy online/pick up in store, buy in store/ship to customer, ship from store, local delivery and cross-channel returns.
- Customer profiles, full order history, marketing opt-ins and loyalty ecosystem.
- Staff permissions and manager approvals.
- Strong payment, hardware, app and ecommerce ecosystem.
- Increasing use of AI for forecasting and inventory rebalancing.

**Lessons**

- Omnichannel must be designed around one order and inventory model, not separate POS and ecommerce databases.
- Store fulfillment is an order-routing problem, not merely a POS feature.
- A single back office is a strong product promise.

**Gaps/opportunities for our product**

- Deeper built-in accounting, procurement and country-specific ERP workflows can differentiate.
- Open integration and self-service localization can appeal to markets with limited native payment support.
- Transparent audit trails and explainable inventory valuation can exceed commerce-only systems.

Official reference: https://www.shopify.com/pos/features

### Square for Retail

**Market position:** payments-led retail platform optimized for ease of adoption.

**Observed strengths**

- Fast item creation, barcode support and practical inventory counting.
- Low-stock alerts, purchase orders, vendor receiving and multi-location inventory sync.
- Offline payment capture and deferred upload.
- Refunds, exchanges and integrated hardware.
- App marketplace and connections to accounting/shipping tools.

**Lessons**

- POS speed and operational simplicity are competitive advantages.
- Offline behavior must be visible and understandable to cashiers.
- Retail workflows should be possible with minimal configuration for small stores.

**Gaps/opportunities**

- International payment availability and country coverage vary.
- A provider-neutral payment abstraction can reach markets where Square is unavailable.
- More advanced accounting, inventory costing and wholesale workflows can be native differentiators.

Official reference: https://squareup.com/us/en/retail/capabilities

### Lightspeed Retail

**Market position:** retail-specialist platform for growing and multi-location businesses.

**Observed strengths**

- Unlimited or broad outlet/register support depending on plan and region.
- Real-time cross-location inventory, transfers and location-comparison reporting.
- Multi-location pricing and shared customer data.
- Supplier, purchasing, inventory intelligence and vertical retail workflows.
- Quotes, customer accounts, deposits/layaways and flexible payment operations.
- Ecommerce and omnichannel integration.

**Lessons**

- Retail needs location-specific price, assortment, tax, stock and permission policies.
- Quotes, deposits, layaway and customer credit are core in many markets, not optional edge cases.
- Multi-store reporting needs drill-down and comparable metric definitions.

**Gaps/opportunities**

- A simpler edition for emerging-market SMBs can reduce onboarding cost.
- A more open localization and accounting architecture can cover underserved countries.

Official reference: https://www.lightspeedhq.com/pos/retail/features/

### Oracle NetSuite and NetSuite POS

**Market position:** enterprise ERP/commerce system with integrated financials.

**Observed strengths**

- POS sales, refunds, returns, customer information and hardware integration.
- Tight integration with general ledger and enterprise accounting.
- Purchasing, receiving, item records, bin management and replenishment.
- Reorder points, safety stock, lead time and demand-based inventory planning.
- Sales orders, fulfillment, committed stock, backorders and store pickup.
- Complex enterprise dimensions such as subsidiaries, locations and currencies.

**Lessons**

- Inventory operations and accounting effects should share controlled posting rules.
- Enterprise retail needs a distinction among on-hand, available, committed, in-transit and backordered quantities.
- Planning requires demand history, lead times, safety stock and supplier constraints.

**Gaps/opportunities**

- Enterprise products can be expensive and complex for SMBs.
- A modern UX with simpler implementation and transparent APIs can compete below the enterprise tier.

Official references:

- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/preface_4631540035.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2285050.html
- https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2251098.html

### Odoo

**Market position:** modular integrated business suite with open-source community roots.

**Observed strengths**

- POS, inventory, accounting, CRM, ecommerce, purchase, manufacturing and HR in one module ecosystem.
- Product variants, units, multiple barcodes, categories, gift cards, pricelists and loyalty.
- Strong demonstration of modular business applications sharing common master data.
- Large community and extension ecosystem.

**Lessons**

- A shared domain platform can support many modules without independent silos.
- Product configuration must support variants, units, weighted items and multiple barcode schemes.
- Extension points are essential for country and industry modules.

**Gaps/opportunities**

- Configuration depth can make onboarding complex.
- A more opinionated cloud-native UX and safer extension model can be easier to operate.
- License boundaries must be respected when using Community/OCA code.

Official references:

- https://www.odoo.com/app/point-of-sale-features
- https://github.com/odoo/odoo

### Zoho Inventory

**Market position:** focused SMB inventory and order-management platform.

**Observed strengths**

- Multi-warehouse operations and transfers.
- Purchase orders, receives and vendor workflows.
- Serial/batch tracking, expiry and traceability.
- Sales orders, invoicing, returns, backorders and dropshipment.
- Picklists, bin locations, packaging, shipping and tracking.
- Webhooks, automation and analytics integration.

**Lessons**

- Serial/batch tracking should flow through receiving, transfers, sales, returns and warranty.
- Fulfillment requires separate pick, pack, ship and tracking states.
- Automation/webhooks are core for ecosystem adoption.

**Gaps/opportunities**

- Native POS and accounting can be more deeply integrated in our platform.
- International country packs can connect operational and statutory workflows.

Official reference: https://www.zoho.com/us/inventory/features/

## Open-source benchmark products

### ERPNext

- Broad ERP feature set covering accounting, order management, inventory, procurement, manufacturing and POS.
- Valuable for studying document posting, stock ledger, GL entries and business workflows.
- GPL-3.0 license means direct incorporation into a proprietary product may impose copyleft obligations; use primarily as a reference unless the product strategy accepts GPL.

Repository: https://github.com/frappe/erpnext

### Apache OFBiz

- Mature enterprise process framework with accounting, order, inventory, ecommerce, manufacturing and WebPOS capabilities.
- Apache licensing is comparatively permissive, but its Java architecture is not directly aligned with a Workers runtime.
- Best use: domain terminology, entity relationships, process modeling and selected algorithms/tests.

Repository: https://github.com/apache/ofbiz-framework

### Odoo Community and OCA POS

- Rich module design and POS/inventory patterns.
- Odoo Community uses LGPL-3.0; OCA modules commonly use AGPL-3.0 or module-specific licenses.
- Direct reuse requires file/module-level license review.

Repositories:

- https://github.com/odoo/odoo
- https://github.com/OCA/pos

### Open Source POS

- Practical POS feature reference including stock, taxes, register, quotations, expenses, cash-up, barcode, customers, suppliers, reports, gift cards and rewards.
- The repository describes modified MIT terms requiring a visible footer signature; do not assume standard MIT compatibility without legal review.

Repository: https://github.com/opensourcepos/opensourcepos

### Medusa

- MIT-licensed headless commerce platform with product, cart, customer, order, fulfillment and workflow primitives.
- Potentially useful for ecommerce/headless patterns and integration adapters.
- Does not provide the full accounting, offline POS and store-operations foundation required here.

Repository: https://github.com/medusajs/medusa

### Dolibarr and NexoPOS

- Useful comparative references for SMB ERP and Laravel/Vue POS patterns.
- Licensing and product-specific terms make them lower-priority direct reuse sources.

Repositories:

- https://github.com/Dolibarr/dolibarr
- https://github.com/Blair2004/NexoPOS

## Feature convergence across successful products

The following capabilities repeatedly appear across market leaders and should be treated as platform fundamentals:

| Capability | Why it matters |
|---|---|
| Unified catalog | One product/variant/barcode model across POS, inventory and ecommerce |
| Multi-location inventory | Accurate availability, transfer and fulfillment decisions |
| Fast POS checkout | Direct impact on customer queues and staff adoption |
| Returns/refunds/exchanges | Essential for operational and financial correctness |
| Purchasing and receiving | Stock cannot be managed only from sales deductions |
| Customer history | Service, loyalty, credit and personalization |
| Staff roles and approvals | Fraud control and operational delegation |
| Cash management | Opening float, paid-in/out, cash-up and variance |
| Reporting | Owners need actionable, explainable results |
| Offline/degraded operation | Stores must survive connectivity failures |
| Integrations | Payments, tax, shipping, ecommerce and accounting differ by country |
| Audit trail | Financial accountability and dispute resolution |
| Localization | Tax, currency, timezone, language and legal documents vary |

## Differentiation strategy

The recommended differentiators are:

1. **International-by-architecture:** country packs and provider adapters instead of one-country assumptions.
2. **Ledger correctness:** explainable stock, cash and accounting movements from launch.
3. **Offline-first POS:** local durable operations, deterministic sync and clear conflict rules.
4. **Cloudflare edge experience:** globally fast web/POS delivery with low infrastructure overhead.
5. **Open APIs:** webhooks, imports, exports and extension points available without enterprise-only gating.
6. **Operational explainability:** every dashboard number drills into source documents and ledger entries.
7. **Progressive complexity:** simple defaults for small stores and advanced controls for chains.
8. **Provider neutrality:** payments, tax, fiscalization, shipping and messaging are adapters.

## Scope exclusions for the general retail core

Do not mix these vertical-specific features into the initial core unless a paying launch customer requires them:

- restaurant kitchen display, table service and recipe depletion;
- pharmacy prescription, controlled-drug and insurer workflows;
- fuel pump and forecourt control;
- hotel room and folio management;
- repair/workshop job cards;
- manufacturing MRP and shop-floor control;
- marketplace seller settlement;
- payroll and full HR suite.

These should use extension modules after the core product, inventory, order, payment and ledger contracts are stable.

## Market-derived product rules

- One item may have many variants, barcodes, units, price lists and location policies.
- Inventory availability is not equal to on-hand quantity.
- A return is not a negative sale; it has authorization, condition, restocking and refund decisions.
- A discount must record rule, approver, reason and financial allocation.
- A payment is not complete until tender, authorization, capture, settlement and reconciliation states are represented where applicable.
- A POS shift is an auditable cash-control session.
- A multi-store transfer is two-sided: dispatch, in-transit and receipt.
- A report metric must be defined independently of screen layout.
- Offline transactions require unique operation IDs and deterministic replay.
- Country support is a certified capability matrix, not a language dropdown.
