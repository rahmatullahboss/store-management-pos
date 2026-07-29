import type { AppRoute } from "../../../../packages/ui/src/app-shell.js";

export const adminRoutes: readonly AppRoute[] = [
  { path: "/", label: "Overview", icon: "O" },
  { path: "/platform/reference", label: "Foundation reference", icon: "F", permission: "platform.reference.read" },
  { path: "/finance/payments", label: "Payments", icon: "P", permission: "payment.read" },
  { path: "/finance/accounting", label: "Accounting", icon: "L", permission: "accounting.read" },
  { path: "/finance/banking", label: "Banking", icon: "B", permission: "banking.read" },
  { path: "/finance/readiness", label: "Finance readiness", icon: "R", permission: "platform.audit.read" },
  { path: "/audit", label: "Audit history", icon: "A", permission: "platform.audit.read" },
  { path: "/access", label: "Access control", icon: "P", permission: "platform.access.manage" },
];
