import { renderAppShell } from "../../../../packages/ui/src/app-shell.js";
import { directionSupportStyles } from "../../../../packages/ui/src/direction-support.js";
import { renderPosFoundationReference, type FoundationReferenceOptions } from "../../../../packages/ui/src/foundation-reference.js";
import {
  renderPosDeviceWorkspace,
  renderPosRegisterWorkspace,
  renderPosSyncWorkspace,
  type PosDeviceWorkspace,
  type PosRegisterWorkspace,
  type PosSyncWorkspace,
} from "../operations-ledger.js";
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
    content: `${directionSupportStyles}${syncSummary}${input.content}`,
    variant: "pos",
    context: {
      workspace: "Register operations",
      location: input.location ?? "Dhaka Central",
      businessDate: input.businessDate ?? "Current business date",
      locale: input.locale ?? "en",
    },
    offline: !input.offlineState.online,
    ...(input.direction ? { direction: input.direction } : {}),
  });
}

export function renderPosFoundationPreview(input: Omit<PosShellInput, "content" | "currentPath">, reference: FoundationReferenceOptions = {}): string {
  const offlineState = reference.state === "offline" ? { ...input.offlineState, online: false, pendingOperations: Math.max(1, input.offlineState.pendingOperations) } : input.offlineState;
  return renderPosShell({ ...input, offlineState, currentPath: "/", content: renderPosFoundationReference(reference) });
}

export function renderPosRegisterPage(input: Omit<PosShellInput, "content" | "currentPath">, page: PosRegisterWorkspace): string {
  return renderPosShell({ ...input, currentPath: "/", content: renderPosRegisterWorkspace(page) });
}

export function renderPosSyncPage(input: Omit<PosShellInput, "content" | "currentPath">, page: PosSyncWorkspace): string {
  return renderPosShell({ ...input, currentPath: "/sync", content: renderPosSyncWorkspace(page) });
}

export function renderPosDevicePage(input: Omit<PosShellInput, "content" | "currentPath">, page: PosDeviceWorkspace): string {
  return renderPosShell({ ...input, currentPath: "/device", content: renderPosDeviceWorkspace(page) });
}
