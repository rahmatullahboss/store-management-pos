export interface StagingAdminRoutePermission {
  readonly pattern: string;
  readonly permission: string;
}

export const STAGING_ADMIN_ROUTE_PERMISSIONS: readonly StagingAdminRoutePermission[] = Object.freeze([
  Object.freeze({ pattern: "/catalog", permission: "catalog.product.read" }),
  Object.freeze({ pattern: "/catalog/products/:productId", permission: "catalog.product.read" }),
  Object.freeze({ pattern: "/catalog/imports", permission: "catalog.import.execute" }),
  Object.freeze({ pattern: "/catalog/units", permission: "catalog.unit.manage" }),
  Object.freeze({ pattern: "/pricing", permission: "pricing.price.read" }),
  Object.freeze({ pattern: "/pricing/promotions", permission: "pricing.promotion.manage" }),
  Object.freeze({ pattern: "/pricing/discount-approvals", permission: "pricing.discount.approve" }),
  Object.freeze({ pattern: "/tax", permission: "tax.calculation.read" }),
  Object.freeze({ pattern: "/tax/exemptions", permission: "tax.exemption.manage" }),
  Object.freeze({ pattern: "/inventory", permission: "inventory.stock.read" }),
  Object.freeze({ pattern: "/procurement", permission: "procurement.purchase_order.read" }),
  Object.freeze({ pattern: "/customers", permission: "customer.profile.read" }),
  Object.freeze({ pattern: "/sales", permission: "sales.order.read" }),
  Object.freeze({ pattern: "/fulfillment", permission: "fulfillment.plan.read" }),
  Object.freeze({ pattern: "/finance/payments", permission: "payment.read" }),
  Object.freeze({ pattern: "/finance/accounting", permission: "accounting.read" }),
  Object.freeze({ pattern: "/finance/banking", permission: "banking.read" }),
  Object.freeze({ pattern: "/finance/readiness", permission: "platform.audit.read" }),
  Object.freeze({ pattern: "/pos/reconciliation", permission: "pos.sync.read" }),
  Object.freeze({ pattern: "/localization", permission: "localization.pack.read" }),
  Object.freeze({ pattern: "/compliance", permission: "localization.document.read" }),
  Object.freeze({ pattern: "/reporting", permission: "reporting.metric.read" }),
  Object.freeze({ pattern: "/integrations", permission: "integration.connector.read" }),
  Object.freeze({ pattern: "/platform/saas", permission: "saas.subscription.read" }),
]);

function normalizePath(pathname: string): string {
  if (!pathname.startsWith("/")) return `/${pathname}`;
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function matchesPattern(pattern: string, pathname: string): boolean {
  const patternParts = normalizePath(pattern).split("/").filter(Boolean);
  const pathnameParts = normalizePath(pathname).split("/").filter(Boolean);
  if (patternParts.length !== pathnameParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(":") || part === pathnameParts[index]);
}

export function requiredPermissionForStagingAdminPath(pathname: string): string | undefined {
  const normalized = normalizePath(pathname);
  return STAGING_ADMIN_ROUTE_PERMISSIONS.find((route) => matchesPattern(route.pattern, normalized))?.permission;
}

export function isAuthorizedStagingAdminPath(
  pathname: string,
  permissions: ReadonlySet<string> | readonly string[],
): boolean {
  const required = requiredPermissionForStagingAdminPath(pathname);
  if (!required) return normalizePath(pathname) === "/";
  const permissionSet = permissions instanceof Set ? permissions : new Set(permissions);
  return permissionSet.has(required);
}
