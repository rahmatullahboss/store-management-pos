import { renderAppShell } from "../../../../packages/ui/src/app-shell.js";
import { directionSupportStyles } from "../../../../packages/ui/src/direction-support.js";
import { renderAdminFoundationReference, type FoundationReferenceOptions } from "../../../../packages/ui/src/foundation-reference.js";
import { CATALOG_ADMIN_ROUTES } from "../modules/catalog/routes.js";
import { renderCustomerWorkspace, type CustomerWorkspaceInput } from "../modules/customer/surface.js";
import { renderFulfillmentWorkspace, type FulfillmentWorkspaceInput } from "../modules/fulfillment/surface.js";
import { renderInventoryOperationsPage, type InventoryDashboardFixture } from "../modules/inventory/index.js";
import { PRICING_TAX_ADMIN_ROUTES } from "../modules/pricing/routes.js";
import { renderProcurementOperationsPage, type ProcurementDashboardFixture } from "../modules/procurement/index.js";
import { renderSalesWorkspace, type SalesWorkspaceInput } from "../modules/sales/surface.js";
import { composeAdminRoutes, type AdminRouteDescriptor } from "./routes.js";

const MOD_B_ADMIN_ROUTES: readonly AdminRouteDescriptor[] = Object.freeze([
  Object.freeze({ id: "inventory.operations", path: "/inventory", navigationLabel: "Inventory", permission: "inventory.stock.read", module: "inventory", order: 210, exact: true }),
  Object.freeze({ id: "procurement.operations", path: "/procurement", navigationLabel: "Procurement", permission: "procurement.purchase_order.read", module: "procurement", order: 220, exact: true }),
]);

const MOD_C_ADMIN_ROUTES: readonly AdminRouteDescriptor[] = Object.freeze([
  Object.freeze({ id: "customer.directory", path: "/customers", navigationLabel: "Customers", permission: "customer.profile.read", module: "customer", order: 310, exact: true }),
  Object.freeze({ id: "sales.control", path: "/sales", navigationLabel: "Sales", permission: "sales.order.read", module: "sales", order: 320, exact: true }),
  Object.freeze({ id: "fulfillment.floor", path: "/fulfillment", navigationLabel: "Fulfillment", permission: "fulfillment.plan.read", module: "fulfillment", order: 330, exact: true }),
]);

const integratedAdminRoutes = composeAdminRoutes([CATALOG_ADMIN_ROUTES, PRICING_TAX_ADMIN_ROUTES, MOD_B_ADMIN_ROUTES, MOD_C_ADMIN_ROUTES]);

export interface AdminShellInput {
  readonly displayName: string;
  readonly tenantName: string;
  readonly permissions: ReadonlySet<string>;
  readonly currentPath: string;
  readonly content: string;
  readonly direction?: "ltr" | "rtl";
  readonly location?: string;
  readonly businessDate?: string;
  readonly locale?: string;
  readonly offline?: boolean;
}

export function renderAdminShell(input: AdminShellInput): string {
  return renderAppShell({
    title: "Store Management Admin",
    identity: { displayName: input.displayName, tenantName: input.tenantName, permissions: input.permissions },
    routes: integratedAdminRoutes,
    currentPath: input.currentPath,
    content: `${directionSupportStyles}${input.content}`,
    variant: "admin",
    context: {
      workspace: "Operations admin",
      location: input.location ?? "All locations",
      businessDate: input.businessDate ?? "Business date · 28 Jul 2026",
      locale: input.locale ?? "en",
    },
    offline: input.offline ?? false,
    ...(input.direction ? { direction: input.direction } : {}),
  });
}

export function renderAdminFoundationPreview(input: Omit<AdminShellInput, "content" | "currentPath">, reference: FoundationReferenceOptions = {}): string {
  return renderAdminShell({ ...input, currentPath: "/", content: renderAdminFoundationReference(reference), offline: reference.state === "offline" || input.offline === true });
}

export function renderInventoryAdminPage(input: Omit<AdminShellInput, "content" | "currentPath">, fixture?: InventoryDashboardFixture): string {
  return renderAdminShell({ ...input, currentPath: "/inventory", content: renderInventoryOperationsPage(fixture) });
}

export function renderProcurementAdminPage(input: Omit<AdminShellInput, "content" | "currentPath">, fixture?: ProcurementDashboardFixture): string {
  return renderAdminShell({ ...input, currentPath: "/procurement", content: renderProcurementOperationsPage(fixture) });
}

export function renderCustomerAdminPage(input: Omit<AdminShellInput, "content" | "currentPath">, workspace: CustomerWorkspaceInput): string {
  return renderAdminShell({ ...input, currentPath: "/customers", content: renderCustomerWorkspace(workspace) });
}

export function renderSalesAdminPage(input: Omit<AdminShellInput, "content" | "currentPath">, workspace: SalesWorkspaceInput): string {
  return renderAdminShell({ ...input, currentPath: "/sales", content: renderSalesWorkspace(workspace) });
}

export function renderFulfillmentAdminPage(input: Omit<AdminShellInput, "content" | "currentPath">, workspace: FulfillmentWorkspaceInput): string {
  return renderAdminShell({ ...input, currentPath: "/fulfillment", content: renderFulfillmentWorkspace(workspace) });
}
