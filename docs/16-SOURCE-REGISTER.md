# Research Source Register

**Research snapshot:** 2026-07-27

This register records primary sources used for the planning baseline. Product features, service limits, regulations and licenses can change. Recheck current official sources before implementation, procurement, compliance claims or direct code reuse.

## 1. Market products

### Shopify POS

- POS features and unified commerce: https://www.shopify.com/pos/features
- POS overview: https://www.shopify.com/pos

Used for research on unified online/offline catalog, customer, inventory, order and fulfillment workflows.

### Square for Retail

- Retail capabilities: https://squareup.com/us/en/retail/capabilities

Used for research on practical POS, offline payments, inventory counts, purchase orders, receiving, refunds and hardware integration.

### Lightspeed Retail

- Retail POS features: https://www.lightspeedhq.com/pos/retail/features/

Used for research on multi-location retail, inventory, purchasing, pricing, customer accounts, quotes and analytics.

### Oracle NetSuite

- NetSuite Point of Sale documentation: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/preface_4631540035.html
- Inventory management: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2285050.html
- Inventory transactions/workflows: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2251098.html

Used for enterprise accounting, order, purchasing, inventory planning/valuation and location/subsidiary concepts.

### Odoo

- Point of Sale features: https://www.odoo.com/app/point-of-sale-features
- Community source repository: https://github.com/odoo/odoo

Used for modular-suite, POS, product, pricing, unit, inventory and localization patterns.

### Zoho Inventory

- Inventory features: https://www.zoho.com/us/inventory/features/

Used for warehouse, serial/batch, purchasing, order fulfillment, automation and reporting research.

## 2. Cloudflare architecture

### Workers

- Platform limits: https://developers.cloudflare.com/workers/platform/limits/
- Workers documentation: https://developers.cloudflare.com/workers/

Review runtime CPU, memory, subrequest, size and networking limits again during architecture spikes.

### D1

- Platform limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 documentation: https://developers.cloudflare.com/d1/

Used to assess per-database size, account/database limits, Time Travel and suitability for bounded auxiliary workloads.

### Hyperdrive

- Get started: https://developers.cloudflare.com/hyperdrive/get-started/
- Connection pooling: https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/
- PostgreSQL example: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/

Used as an optional benchmark/fallback for PostgreSQL connectivity, global pooling and query-cache architecture. It is not a baseline dependency after the Neon direct-driver decision.

### Neon Serverless PostgreSQL

- Serverless driver: https://neon.com/docs/serverless/serverless-driver
- Driver repository: https://github.com/neondatabase/serverless
- Cloudflare integration: https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/
- Cloudflare database connection comparison: https://developers.cloudflare.com/workers/databases/connecting-to-databases/
- Neon branching workflow: https://neon.com/docs/get-started-with-neon/workflow-primer
- Hyperdrive comparison for Neon: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/neon/

Used for the canonical PostgreSQL provider, direct HTTP/WebSocket Workers access and isolated database branches for module agents, pull requests and test runs. HTTP and request-scoped WebSocket transaction modes must be benchmarked separately.

### Durable Objects

- Overview: https://developers.cloudflare.com/durable-objects/
- SQLite storage API: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Platform limits: https://developers.cloudflare.com/durable-objects/platform/limits/

Used for serialized coordinator and realtime/offline-sync architecture, not as evidence that Durable Objects should replace the canonical relational database.

### Queues

- Delivery guarantees: https://developers.cloudflare.com/queues/reference/delivery-guarantees/
- Queues documentation: https://developers.cloudflare.com/queues/

Used for at-least-once delivery, retry, deduplication and dead-letter planning.

### Workflows

- Workflows documentation: https://developers.cloudflare.com/workflows/

Used for durable long-running import, fiscal, reconciliation and lifecycle orchestration.

### R2

- Consistency: https://developers.cloudflare.com/r2/reference/consistency/
- How R2 works: https://developers.cloudflare.com/r2/how-r2-works/

Used for object/media/document consistency and caching/immutability design.

### Workers for Platforms / SaaS

- Workers for Platforms: https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/
- SaaS/multi-tenant guidance: https://developers.cloudflare.com/reference-architecture/use-cases/saas/

Used to distinguish normal multi-tenant SaaS from future customer-supplied code execution.

## 3. Open-source projects and licenses

### ERPNext

- Repository: https://github.com/frappe/erpnext
- License file: review the exact pinned repository tag/commit before use.

Observed repository license: GPL-3.0. Use primarily as a research reference unless the product adopts a compatible licensing strategy.

### Odoo Community

- Repository: https://github.com/odoo/odoo
- License details: inspect exact edition, directory and tag.

Observed Community repository licensing includes LGPL-3.0; individual files/add-ons and enterprise components may differ.

### Odoo Community Association POS modules

- Repository: https://github.com/OCA/pos

Many OCA modules use AGPL-3.0 or module-specific terms. Review each module independently.

### Apache OFBiz

- Repository: https://github.com/apache/ofbiz-framework
- Project site/documentation: https://ofbiz.apache.org/

Apache-2.0 is comparatively permissive; preserve notices and review third-party files.

### Open Source POS

- Repository: https://github.com/opensourcepos/opensourcepos

Repository terms describe modified MIT-style conditions including attribution/footer behavior. Obtain legal review before direct reuse.

### Medusa

- Repository: https://github.com/medusajs/medusa

Observed MIT licensing at research time; verify the exact release and package licenses.

### Dolibarr

- Repository: https://github.com/Dolibarr/dolibarr

Observed GPL-3.0 licensing; use as a research reference unless licensing strategy permits direct reuse.

### NexoPOS

- Repository: https://github.com/Blair2004/NexoPOS

Verify current repository and commercial/product terms before any use.

## 4. Internationalization standards

### Unicode CLDR

- CLDR documentation: https://cldr.unicode.org/
- Number/currency formatting specification: https://unicode.org/reports/tr35/tr35-numbers.html

Used for locale-sensitive number, currency, plural, date and display behavior.

### IANA Time Zone Database

- Time zone database: https://www.iana.org/time-zones
- Release data: https://data.iana.org/time-zones/releases/

Used for IANA timezone identifiers and timezone-rule change planning.

### BCP 47

- IETF BCP 47/RFC 5646 language tags: https://www.rfc-editor.org/rfc/rfc5646

Used for language/region/script locale identifiers.

### Currency codes

- ISO 4217 overview: https://www.iso.org/iso-4217-currency-codes.html

Use a maintained licensed/official data source in implementation and version historical precision/rounding metadata.

## 5. Security, payments and privacy

### PCI Security Standards Council

- PCI DSS document library: https://www.pcisecuritystandards.org/document_library/
- PCI DSS overview/resources: https://www.pcisecuritystandards.org/standards/pci-dss/
- Point-to-Point Encryption: https://www.pcisecuritystandards.org/standards/p2pe/

Used for payment-card scope minimization, tokenization/semi-integrated terminal planning and current PCI DSS verification. Consult a qualified professional for actual validation obligations.

### European data protection principles

- European Commission data-protection principles: https://commission.europa.eu/law/law-topic/data-protection/data-protection-eu_en
- GDPR legal text: https://eur-lex.europa.eu/eli/reg/2016/679/oj

Used as a reference for data minimization, purpose limitation, retention, security and accountability. Country privacy requirements must be reviewed separately.

### OWASP

- Application Security Verification Standard: https://owasp.org/www-project-application-security-verification-standard/
- API Security Top 10: https://owasp.org/www-project-api-security/

Recommended engineering control references; verify current versions during implementation.

## 6. Database and platform standards

### PostgreSQL

- Official documentation: https://www.postgresql.org/docs/

Use current documentation for exact numeric types, transactions, row-level security, partitioning, backup, replication and supported versions.

### OpenTelemetry

- Documentation/specifications: https://opentelemetry.io/docs/

Use for vendor-neutral trace/metric/log instrumentation where runtime-compatible.

## 7. Source quality policy

Preferred evidence order:

1. official product/service/regulator/standards documentation;
2. official repositories and license files at a pinned revision;
3. audited technical papers or provider architecture references;
4. reputable independent analysis for comparison only;
5. community discussion only for identifying issues to verify independently.

Marketing pages describe capabilities but may omit plan, country, hardware and version limitations. Confirm details in technical documentation and contracts before committing product parity.

## 8. Research maintenance

Before each major architecture/country release:

- recheck Cloudflare limits/pricing/region behavior;
- recheck database provider regions, backups and network support;
- recheck payment/fiscal APIs and certifications;
- recheck open-source licenses at pinned revisions;
- recheck tax, invoice, fiscal and privacy rules from official country sources;
- update market comparison for material product changes;
- record review date, reviewer and resulting ADR/country-pack version.

This source register supports planning and does not itself establish legal, tax, accounting or security compliance.
