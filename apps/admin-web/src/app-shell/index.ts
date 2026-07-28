import { renderAppShell } from "../../../../packages/ui/src/app-shell.js";
import { directionSupportStyles } from "../../../../packages/ui/src/direction-support.js";
import { renderAdminFoundationReference } from "../../../../packages/ui/src/foundation-reference.js";
import { adminRoutes } from "./routes.js";

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
    ...(input.direction ? { direction: input.direction } : {}),
  });
}

export function renderAdminFoundationPreview(input: Omit<AdminShellInput, "content" | "currentPath">): string {
  return renderAdminShell({ ...input, currentPath: "/", content: renderAdminFoundationReference() });
}
