import type { ModAAdminRoute } from "../catalog/routes.js";

export const PRICING_TAX_ADMIN_ROUTES: readonly ModAAdminRoute[] = Object.freeze([
  Object.freeze({ id: "pricing.lists", path: "/pricing", navigationLabel: "Pricing", permission: "pricing.price.read", module: "pricing", order: 120, exact: true }),
  Object.freeze({ id: "pricing.promotions", path: "/pricing/promotions", navigationLabel: "Promotions", permission: "pricing.promotion.manage", module: "pricing", order: 121, exact: true }),
  Object.freeze({ id: "pricing.approvals", path: "/pricing/discount-approvals", navigationLabel: "Discount approvals", permission: "pricing.discount.approve", module: "pricing", order: 122, exact: true }),
  Object.freeze({ id: "tax.configuration", path: "/tax", navigationLabel: "Tax", permission: "tax.calculation.read", module: "tax", order: 130, exact: true }),
  Object.freeze({ id: "tax.exemptions", path: "/tax/exemptions", navigationLabel: "Tax exemptions", permission: "tax.exemption.manage", module: "tax", order: 131, exact: true }),
]);
