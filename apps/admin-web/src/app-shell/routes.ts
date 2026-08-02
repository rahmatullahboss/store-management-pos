import type { AppRoute } from "../../../../packages/ui/src/app-shell.js";

export interface AdminRouteDescriptor {
  readonly id: string;
  readonly path: string;
  readonly navigationLabel: string;
  readonly permission: string;
  readonly module: string;
  readonly order: number;
  readonly exact?: boolean;
  readonly icon?: string;
}

const STITCH_ROUTE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  "/": "Dashboard",
  "/catalog": "Catalog",
  "/catalog/products/:productId": "Product Record",
  "/catalog/imports": "Catalog Imports",
  "/pricing": "Pricing / Price Lists",
  "/pricing/promotions": "Promotions / Coupons",
  "/pricing/discount-approvals": "Discount Approvals",
  "/tax": "Tax Configuration",
  "/tax/exemptions": "Tax Exemptions",
  "/inventory": "Inventory",
  "/procurement": "Procurement & Receiving",
  "/customers": "Customers",
  "/sales": "Sales Orders & Returns",
  "/fulfillment": "Fulfillment",
  "/finance/payments": "Payments & Settlements",
  "/finance/accounting": "Accounting Ledger",
  "/finance/banking": "Banking & Reconciliation",
  "/finance/readiness": "Financial Readiness & Close",
  "/pos/reconciliation": "POS Reconciliation",
  "/localization": "Localization & Country Packs",
  "/compliance": "Compliance & Evidence",
  "/reporting": "Reporting & Exports",
  "/integrations": "Integrations & API",
  "/platform/saas": "SaaS Platform Operations",
});

export const adminRoutes: readonly AppRoute[] = Object.freeze([
  { path: "/", label: STITCH_ROUTE_LABELS["/"] ?? "Dashboard", icon: "O" },
  { path: "/platform/reference", label: "Foundation reference", icon: "F", permission: "platform.reference.read" },
  { path: "/audit", label: "Audit history", icon: "A", permission: "platform.audit.read" },
  { path: "/access", label: "Access control", icon: "P", permission: "platform.access.manage" },
]);

function moduleIcon(moduleId: string): string {
  return moduleId.trim().slice(0, 1).toUpperCase() || "M";
}

function navigationLabel(path: string, fallback: string): string {
  return STITCH_ROUTE_LABELS[path] ?? fallback;
}

export function composeAdminRoutes(providers: readonly (readonly AdminRouteDescriptor[])[] = []): readonly AppRoute[] {
  if (providers.length === 0) {
    return adminRoutes;
  }

  const descriptors = providers.flat();
  const ids = new Set<string>();
  const paths = new Set(adminRoutes.map((route) => route.path));

  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(`Duplicate admin route id: ${descriptor.id}`);
    }
    if (paths.has(descriptor.path)) {
      throw new Error(`Duplicate admin route path: ${descriptor.path}`);
    }
    ids.add(descriptor.id);
    paths.add(descriptor.path);
  }

  const moduleRoutes = [...descriptors]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .filter((descriptor) => !descriptor.path.includes(":"))
    .map<AppRoute>((descriptor) => ({
      path: descriptor.path,
      label: navigationLabel(descriptor.path, descriptor.navigationLabel),
      permission: descriptor.permission,
      icon: descriptor.icon ?? moduleIcon(descriptor.module),
    }));

  return Object.freeze([...adminRoutes, ...moduleRoutes]);
}
