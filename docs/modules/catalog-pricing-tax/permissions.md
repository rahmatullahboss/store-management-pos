# MOD-A Permission Matrix

Permissions are tenant-scoped and are enforced in the TypeScript repository/API boundary before a database function is invoked. PostgreSQL RLS and function privileges remain the second enforcement layer.

## Catalog

| Permission | Capability | Risk |
|---|---|---|
| `catalog.product.read` | Read/search products and variants | Standard |
| `catalog.product.write` | Create or edit product drafts and lifecycle data | Sensitive |
| `catalog.product.publish` | Activate or archive controlled product versions | Privileged |
| `catalog.unit.manage` | Manage units and effective conversion versions | Privileged |
| `catalog.import.execute` | Review and execute a validated catalog import | Sensitive |
| `catalog.export.read` | Export catalog projections | Standard |
| `catalog.feed.read` | Read bounded POS full/incremental feeds | Standard |

## Pricing and promotions

| Permission | Capability | Risk |
|---|---|---|
| `pricing.price.read` | Resolve/read prices and snapshots | Standard |
| `pricing.price.manage` | Create price-list roots, versions and rules | Sensitive |
| `pricing.price.publish` | Publish effective price-list versions | Privileged |
| `pricing.promotion.manage` | Manage and publish promotions/coupons | Sensitive |
| `pricing.discount.apply` | Apply a discount within policy | Sensitive |
| `pricing.discount.approve` | Approve controlled discount exceptions | Privileged |
| `pricing.price_tax.calculate` | Persist a combined price-tax snapshot | Standard |

Persisting a combined snapshot also requires `tax.calculation.read`; this prevents pricing access alone from exposing or recording tax calculations.

## Tax

| Permission | Capability | Risk |
|---|---|---|
| `tax.calculation.read` | Calculate tax and read immutable snapshots | Standard |
| `tax.configuration.manage` | Create/edit jurisdiction and tax drafts | Sensitive |
| `tax.configuration.publish` | Publish effective code/rate versions | Privileged |
| `tax.exemption.manage` | Manage certificates and exemption lifecycle | Privileged |

## Separation of duties

Recommended production roles:

- Catalog operator: catalog read/write/import review; no publishing.
- Catalog approver: catalog publish and unit/barcode controls.
- Pricing analyst: price read/manage and promotion manage; no publish.
- Pricing approver: price publish and discount approve.
- Tax analyst: calculation read/configuration manage.
- Tax approver: configuration publish and exemption manage.
- POS/offline consumer: catalog feed read, price read, tax calculation read and combined calculation only.

A person may hold more than one role only through an explicit tenant policy. Approval events retain the actor and reason regardless of role composition.
