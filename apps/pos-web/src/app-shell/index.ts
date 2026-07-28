import { renderAppShell } from "../../../../packages/ui/src/app-shell.js";
import { renderPosFoundationReference } from "../../../../packages/ui/src/foundation-reference.js";
import { posRoutes } from "./routes.js";

export interface OfflineShellState {
  readonly online: boolean;
  readonly pendingOperations: number;
  readonly lastSyncAt?: string;
}

export interface PosShellInput {
  readonly displayName: string;
  readonly tenantName: string;
  readonly permissions: ReadonlySet<string>;
  readonly currentPath: string;
  readonly content: string;
  readonly offlineState: OfflineShellState;
  readonly direction?: "ltr" | "rtl";
  readonly location?: string;
  readonly businessDate?: string;
  readonly locale?: string;
}

export function renderPosShell(input: PosShellInput): string {
  const syncSummary = input.offlineState.online
    ? `<span class="visually-hidden" role="status">Online. ${input.offlineState.pendingOperations} pending operations.</span>`
    : `<span class="visually-hidden" role="status">Offline. ${input.offlineState.pendingOperations} operations are queued for sync.</span>`;
  return renderAppShell({
    title: "Store POS",
    identity: { displayName: input.displayName, tenantName: input.tenantName, permissions: input.permissions },
    routes: posRoutes,
    currentPath: input.currentPath,
    content: `${syncSummary}${input.content}`,
    variant: "pos",
    context: {
      workspace: "Register 02",
      location: input.location ?? "Dhaka Central",
      businessDate: input.businessDate ?? "Business date · 28 Jul 2026",
      locale: input.locale ?? "en",
    },
    offline: !input.offlineState.online,
    ...(input.direction ? { direction: input.direction } : {}),
  });
}

export function renderPosFoundationPreview(input: Omit<PosShellInput, "content" | "currentPath">): string {
  return renderPosShell({ ...input, currentPath: "/", content: renderPosFoundationReference() });
}
