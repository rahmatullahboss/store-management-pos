import { renderAppShell } from "../../../../packages/ui/src/app-shell.js";
import { posRoutes } from "./routes.js";
export interface OfflineShellState { readonly online: boolean; readonly pendingOperations: number; readonly lastSyncAt?: string }
export function renderPosShell(input: { displayName: string; tenantName: string; permissions: ReadonlySet<string>; currentPath: string; content: string; offlineState: OfflineShellState; direction?: "ltr" | "rtl" }): string {
  const status = `<section aria-label="Sync status"><strong>${input.offlineState.online ? "Online" : "Offline"}</strong><span>Pending operations: ${input.offlineState.pendingOperations}</span></section>`;
  return renderAppShell({ title: "Store POS", identity: { displayName: input.displayName, tenantName: input.tenantName, permissions: input.permissions }, routes: posRoutes, currentPath: input.currentPath, content: `${status}${input.content}`, offline: !input.offlineState.online, ...(input.direction ? { direction: input.direction } : {}) });
}
