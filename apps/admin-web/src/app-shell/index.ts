import { renderAppShell } from "../../../../packages/ui/src/app-shell.js";
import { directionSupportStyles } from "../../../../packages/ui/src/direction-support.js";
import { renderAdminFoundationReference, type FoundationReferenceOptions } from "../../../../packages/ui/src/foundation-reference.js";
import { renderAccountingControlPage, type AccountingControlPage } from "../modules/accounting/page.js";
import { renderBankReconciliationPage, type BankReconciliationPage } from "../modules/banking/page.js";
import { CATALOG_ADMIN_ROUTES } from "../modules/catalog/routes.js";
import { renderCustomerWorkspace, type CustomerWorkspaceInput } from "../modules/customer/surface.js";
import { renderFulfillmentWorkspace, type FulfillmentWorkspaceInput } from "../modules/fulfillment/surface.js";
import { renderInventoryOperationsPage, type InventoryDashboardFixture } from "../modules/inventory/index.js";
import { renderPaymentOperationsPage, type PaymentOperationsPage } from "../modules/payments/page.js";
import { PRICING_TAX_ADMIN_ROUTES } from "../modules/pricing/routes.js";
import { renderProcurementOperationsPage, type ProcurementDashboardFixture } from "../modules/procurement/index.js";
import { renderFinanceReadinessPage, type FinanceReadinessPage } from "../modules/reporting/finance-readiness-page.js";
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

const MOD_E_ADMIN_ROUTES: readonly AdminRouteDescriptor[] = Object.freeze([
  Object.freeze({ id: "finance.payments", path: "/finance/payments", navigationLabel: "Payments", permission: "payment.read", module: "payments", order: 410, exact: true }),
  Object.freeze({ id: "finance.accounting", path: "/finance/accounting", navigationLabel: "Accounting", permission: "accounting.read", module: "accounting", order: 420, exact: true }),
  Object.freeze({ id: "finance.banking", path: "/finance/banking", navigationLabel: "Banking", permission: "banking.read", module: "banking", order: 430, exact: true }),
  Object.freeze({ id: "finance.readiness", path: "/finance/readiness", navigationLabel: "Finance readiness", permission: "platform.audit.read", module: "finance", order: 440, exact: true }),
]);

const integratedAdminRoutes = composeAdminRoutes([CATALOG_ADMIN_ROUTES, PRICING_TAX_ADMIN_ROUTES, MOD_B_ADMIN_ROUTES, MOD_C_ADMIN_ROUTES, MOD_E_ADMIN_ROUTES]);

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

export function renderPaymentsAdminPage(input: Omit<AdminShellInput, "content" | "currentPath">, page: PaymentOperationsPage): string {
  return renderAdminShell({ ...input, currentPath: "/finance/payments", content: renderPaymentOperationsPage(page, input.locale ?? "en-US") });
}

export function renderAccountingAdminPage(input: Omit<AdminShellInput, "content" | "currentPath">, page: AccountingControlPage): string {
  return renderAdminShell({ ...input, currentPath: "/finance/accounting", content: renderAccountingControlPage(page, input.locale ?? "en-US") });
}

export function renderBankingAdminPage(input: Omit<AdminShellInput, "content" | "currentPath">, page: BankReconciliationPage): string {
  return renderAdminShell({ ...input, currentPath: "/finance/banking", content: renderBankReconciliationPage(page, input.locale ?? "en-US") });
}

export function renderFinanceReadinessAdminPage(input: Omit<AdminShellInput, "content" | "currentPath">, page: FinanceReadinessPage): string {
  return renderAdminShell({ ...input, currentPath: "/finance/readiness", content: renderFinanceReadinessPage(page) });
}
