import type { AdminRouteDescriptor } from "../../app-shell/routes.js";

export const MOD_G_ADMIN_ROUTES: readonly AdminRouteDescriptor[] = Object.freeze([
  Object.freeze({
    id: "reporting.operations",
    path: "/reporting",
    navigationLabel: "Reporting",
    permission: "reporting.metric.read",
    module: "reporting",
    order: 710,
    exact: true,
  }),
  Object.freeze({
    id: "integration.operations",
    path: "/integrations",
    navigationLabel: "Integrations",
    permission: "integration.connector.read",
    module: "integration",
    order: 720,
    exact: true,
  }),
  Object.freeze({
    id: "saas.operations",
    path: "/platform/saas",
    navigationLabel: "SaaS administration",
    permission: "saas.subscription.read",
    module: "saas-admin",
    order: 730,
    exact: true,
  }),
]);
