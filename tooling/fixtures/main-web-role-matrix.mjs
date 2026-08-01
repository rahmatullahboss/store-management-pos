const route = (id, pattern, permission, renderPath = pattern) => Object.freeze({ id, pattern, permission, renderPath });

export const ADMIN_ROLE_MATRIX_ROUTES = Object.freeze([
  route("catalog.products", "/catalog", "catalog.product.read"),
  route("catalog.product", "/catalog/products/:productId", "catalog.product.read", "/catalog/products/018f0000-0000-7000-8000-000000000101"),
  route("catalog.imports", "/catalog/imports", "catalog.import.execute"),
  route("catalog.units", "/catalog/units", "catalog.unit.manage"),
  route("pricing.lists", "/pricing", "pricing.price.read"),
  route("pricing.promotions", "/pricing/promotions", "pricing.promotion.manage"),
  route("pricing.approvals", "/pricing/discount-approvals", "pricing.discount.approve"),
  route("tax.configuration", "/tax", "tax.calculation.read"),
  route("tax.exemptions", "/tax/exemptions", "tax.exemption.manage"),
  route("inventory.operations", "/inventory", "inventory.stock.read"),
  route("procurement.operations", "/procurement", "procurement.purchase_order.read"),
  route("customer.directory", "/customers", "customer.profile.read"),
  route("sales.control", "/sales", "sales.order.read"),
  route("fulfillment.floor", "/fulfillment", "fulfillment.plan.read"),
  route("finance.payments", "/finance/payments", "payment.read"),
  route("finance.accounting", "/finance/accounting", "accounting.read"),
  route("finance.banking", "/finance/banking", "banking.read"),
  route("finance.readiness", "/finance/readiness", "platform.audit.read"),
  route("pos.reconciliation", "/pos/reconciliation", "pos.sync.read"),
  route("localization.country-packs", "/localization", "localization.pack.read"),
  route("localization.compliance", "/compliance", "localization.document.read"),
  route("reporting.operations", "/reporting", "reporting.metric.read"),
  route("integration.operations", "/integrations", "integration.connector.read"),
  route("saas.operations", "/platform/saas", "saas.subscription.read"),
]);

const persona = (id, displayName, permissions, primaryPath, primarySurface = "admin") => Object.freeze({
  id,
  displayName,
  permissions: Object.freeze([...new Set(permissions)]),
  primaryPath,
  primarySurface,
});

export const E2E_PERSONAS = Object.freeze([
  persona("business-owner", "Synthetic Business Owner", [
    "catalog.product.read", "pricing.price.read", "tax.calculation.read", "inventory.stock.read",
    "procurement.purchase_order.read", "customer.profile.read", "sales.order.read", "fulfillment.plan.read",
    "payment.read", "accounting.read", "banking.read", "platform.audit.read", "pos.sync.read",
    "localization.pack.read", "localization.document.read", "reporting.metric.read",
  ], "/reporting"),
  persona("managing-director-cfo", "Synthetic Managing Director / CFO", [
    "pricing.price.read", "pricing.discount.approve", "tax.calculation.read", "tax.exemption.manage",
    "payment.read", "accounting.read", "banking.read", "platform.audit.read",
    "localization.document.read", "reporting.metric.read",
  ], "/finance/readiness"),
  persona("store-manager", "Synthetic Store Manager", [
    "catalog.product.read", "pricing.price.read", "pricing.promotion.manage", "pricing.discount.approve",
    "tax.calculation.read", "inventory.stock.read", "customer.profile.read", "sales.order.read",
    "fulfillment.plan.read", "pos.sync.read", "reporting.metric.read", "pos.checkout.read",
  ], "/pos/reconciliation"),
  persona("cashier", "Synthetic Cashier", [
    "catalog.product.read", "pricing.price.read", "tax.calculation.read", "customer.profile.read",
    "sales.order.read", "pos.checkout.read", "pos.checkout.execute", "pos.checkout.offline",
  ], "/pos", "pos"),
  persona("inventory-manager", "Synthetic Inventory Manager", [
    "catalog.product.read", "catalog.unit.manage", "inventory.stock.read", "procurement.purchase_order.read",
    "fulfillment.plan.read", "pos.sync.read", "reporting.metric.read",
  ], "/inventory"),
  persona("purchaser", "Synthetic Purchaser", [
    "catalog.product.read", "pricing.price.read", "inventory.stock.read", "procurement.purchase_order.read",
    "reporting.metric.read",
  ], "/procurement"),
  persona("accountant", "Synthetic Accountant", [
    "pricing.price.read", "tax.calculation.read", "tax.exemption.manage", "payment.read", "accounting.read",
    "banking.read", "platform.audit.read", "localization.document.read", "reporting.metric.read",
  ], "/finance/accounting"),
  persona("sales-representative", "Synthetic Sales Representative", [
    "catalog.product.read", "pricing.price.read", "customer.profile.read", "sales.order.read",
    "fulfillment.plan.read", "payment.read", "reporting.metric.read",
  ], "/sales"),
  persona("warehouse-operator", "Synthetic Warehouse Operator", [
    "catalog.product.read", "inventory.stock.read", "procurement.purchase_order.read", "fulfillment.plan.read",
  ], "/fulfillment"),
  persona("platform-administrator", "Synthetic Platform Administrator", [
    ...ADMIN_ROLE_MATRIX_ROUTES.map((item) => item.permission),
    "platform.reference.read", "platform.access.manage", "pos.checkout.read",
  ], "/platform/saas"),
  persona("integration-developer", "Synthetic Integration Developer", [
    "integration.connector.read", "reporting.metric.read", "saas.subscription.read",
  ], "/integrations"),
]);

export const CROSS_ROLE_P0_JOURNEYS = Object.freeze([
  Object.freeze({ id: "purchase-to-receipt-to-accounting", personas: ["purchaser", "warehouse-operator", "accountant"] }),
  Object.freeze({ id: "quote-order-fulfillment-payment", personas: ["sales-representative", "warehouse-operator", "accountant"] }),
  Object.freeze({ id: "pos-sale-shift-reconciliation", personas: ["cashier", "store-manager", "accountant"] }),
  Object.freeze({ id: "return-receive-refund-accounting", personas: ["store-manager", "warehouse-operator", "accountant"] }),
  Object.freeze({ id: "physical-count-approval-adjustment", personas: ["inventory-manager", "store-manager"] }),
  Object.freeze({ id: "owner-reporting-drill-through", personas: ["business-owner", "managing-director-cfo"] }),
  Object.freeze({ id: "tenant-access-support-audit", personas: ["platform-administrator"] }),
  Object.freeze({ id: "partner-api-webhook-observability", personas: ["integration-developer", "platform-administrator"] }),
]);
