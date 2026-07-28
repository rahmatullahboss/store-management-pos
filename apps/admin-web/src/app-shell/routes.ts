import type { AppRoute } from "../../../../packages/ui/src/app-shell.js";
export const adminRoutes: readonly AppRoute[] = [
  { path: "/", label: "Overview" },
  { path: "/platform/reference", label: "Foundation reference", permission: "platform.reference.read" },
  { path: "/audit", label: "Audit history", permission: "platform.audit.read" },
  { path: "/access", label: "Access control", permission: "platform.access.manage" },
];
