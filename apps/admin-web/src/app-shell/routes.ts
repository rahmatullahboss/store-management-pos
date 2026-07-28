import type { AppRoute } from "../../../../packages/ui/src/app-shell.js";

export const adminRoutes: readonly AppRoute[] = [
  { path: "/", label: "Overview", icon: "O" },
  { path: "/platform/reference", label: "Foundation reference", icon: "F", permission: "platform.reference.read" },
  { path: "/audit", label: "Audit history", icon: "A", permission: "platform.audit.read" },
  { path: "/access", label: "Access control", icon: "P", permission: "platform.access.manage" },
];
