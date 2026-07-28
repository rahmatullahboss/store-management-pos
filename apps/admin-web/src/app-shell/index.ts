import { renderAppShell } from "../../../../packages/ui/src/app-shell.js";
import { directionSupportStyles } from "../../../../packages/ui/src/direction-support.js";
import { renderAdminFoundationReference, type FoundationReferenceOptions } from "../../../../packages/ui/src/foundation-reference.js";
import { adminRoutes } from "./routes.js";
import { renderInventoryOperationsPage, type InventoryDashboardFixture } from "../modules/inventory/index.js";
import { renderProcurementOperationsPage, type ProcurementDashboardFixture } from "../modules/procurement/index.js";

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
    routes: adminRoutes,
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
