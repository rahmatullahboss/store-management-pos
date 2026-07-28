# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are retail and wholesale operators working across one to twenty stores or warehouses:

- cashiers who need fast, reliable, keyboard- and barcode-first checkout, including controlled offline operation;
- store managers responsible for shifts, stock, returns, discounts, approvals and daily close;
- inventory and warehouse teams receiving, counting, transferring, picking and shipping goods;
- purchasers managing suppliers, purchase orders, lead times and cost control;
- accountants, CFOs and owners who need traceable financial, tax, cash, stock and branch reporting;
- sales representatives managing quotes, customer credit, orders and collections;
- platform administrators and integration developers operating tenants, plans, APIs, webhooks and support workflows.

## Product Purpose

Build an international, multi-tenant Store Operating System and POS platform that gives a business one reliable source of truth for products, pricing, stock, procurement, sales, checkout, cash, payments, customers, accounting, fulfilment and reporting across stores, warehouses and channels.

Success means that every sale can be traced from receipt to payment, stock movement, cost of goods, tax and journal entry; stores can keep operating through temporary network failure; and new countries can be added through controlled localisation packs without redesigning the core platform.

## Positioning

The platform differentiates through a ledger-correct operational core, explicit offline POS behaviour, explainable drill-through reporting, country-pack extensibility and gradually revealed complexity. It is intended to be simple enough for a first-time small retailer while preserving the controls required by multi-branch and multi-legal-entity businesses.

## Operating Context

The product is used in fast, interruption-heavy retail environments as well as finance and warehouse back offices. Typical work includes scanning barcodes, searching variants, handling customers and tenders, receiving goods, counting stock, approving exceptions, reconciling shifts and settlements, closing periods and drilling from dashboard numbers to source documents and immutable ledger effects.

Primary surfaces are:

- POS web/PWA for cashier and counter-sale workflows;
- admin web for store, inventory, procurement, sales, finance, reporting, integrations and SaaS administration;
- role-specific dashboards and operational queues;
- responsive and internationalised experiences supporting Latin, Bengali, Arabic/RTL and CJK content;
- printable and digital receipts, invoices, reports and exports.

## Capabilities and Constraints

- Cloudflare Workers and direct Neon Serverless PostgreSQL are the baseline architecture.
- PostgreSQL is the canonical source of truth; D1, KV, Durable Objects and client storage are bounded auxiliary systems.
- The application is a modular monolith with explicit module ownership and contract boundaries.
- Stock, financial and cash/payment balances are derived from immutable ledgers.
- Posted records are corrected through reversal or adjustment, never silent mutation.
- Offline POS is a defined operating mode using a durable local operation log and idempotent synchronisation.
- Money and quantities use exact representations; binary floating point is prohibited for financial values.
- Country-specific tax, legal-document, numbering, accounting and fiscal behaviour is delivered through versioned country packs.
- Tenant, legal entity, store, warehouse, register, timezone and business date are first-class dimensions.
- The system must support keyboard-driven operation, responsive layouts, RTL and accessibility.
- The initial core targets general retail, grocery/convenience without complex regulated workflows, fashion, electronics, home goods, cosmetics, specialty retail and basic wholesale/distribution.
- Restaurant, pharmacy, fuel, hospitality, manufacturing and service-repair behaviour is deferred to extension packs.

## Brand Commitments

The working product identity is “International Store Management & POS Platform”. Ozzyl IT Services is the product owner. No final public product name, logo, colour palette, type system or marketing visual identity has been approved yet.

The product voice must be precise, operational and trustworthy. It must not use invented customers, performance claims, prices, certifications or compliance claims.

## Evidence on Hand

Authoritative product, architecture and programme documentation exists under `docs/`, including product requirements, market research, domain/data architecture, POS/offline behaviour, internationalisation, security, reporting, implementation workpacks and agent ownership.

No production UI implementation, approved visual identity, real customer screenshots, testimonials, case studies or final marketing assets exist yet. Future design work must not fabricate them.

## Product Principles

1. Correctness and traceability before cosmetic convenience for posted financial and stock operations.
2. Fast default workflows with advanced controls revealed only when the user or risk level requires them.
3. Offline is an intentional operating state with visible risk, queue and synchronisation status.
4. Every important number must expose provenance and drill-through to the source document and ledger effects.
5. International, accessible and role-aware behaviour is designed into the foundation rather than appended later.

## Accessibility & Inclusion

All operational surfaces must support keyboard use, visible focus, screen-reader semantics, appropriate contrast, scalable text, reduced motion, responsive layouts and clear error recovery. POS interactions must work on low-end devices and under time pressure. Representative testing must include Bengali/English, Arabic RTL, CJK and mixed-script content, long labels, large values and localisation-driven layout expansion.
