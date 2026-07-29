import type { AdminRouteDescriptor } from "../../app-shell/routes.js";

export const LOCALIZATION_COMPLIANCE_ADMIN_ROUTES: readonly AdminRouteDescriptor[] = Object.freeze([
  Object.freeze({
    id: "localization.country-packs",
    path: "/localization",
    navigationLabel: "Country packs",
    permission: "localization.pack.read",
    module: "localization",
    order: 610,
    exact: true,
  }),
  Object.freeze({
    id: "localization.compliance",
    path: "/compliance",
    navigationLabel: "Compliance",
    permission: "localization.document.read",
    module: "localization",
    order: 620,
    exact: true,
  }),
]);
