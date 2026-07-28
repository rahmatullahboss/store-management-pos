import { renderAppShell } from "../../../../packages/ui/src/app-shell.js";
import { adminRoutes } from "./routes.js";
export function renderAdminShell(input: { displayName: string; tenantName: string; permissions: ReadonlySet<string>; currentPath: string; content: string; direction?: "ltr" | "rtl" }): string {
  return renderAppShell({ title: "Store Management Admin", identity: { displayName: input.displayName, tenantName: input.tenantName, permissions: input.permissions }, routes: adminRoutes, currentPath: input.currentPath, content: input.content, ...(input.direction ? { direction: input.direction } : {}) });
}
