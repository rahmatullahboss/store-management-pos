import type { AdminRouteDescriptor } from "../../app-shell/routes.js";

export const STOREFRONT_ADMIN_ROUTES: readonly AdminRouteDescriptor[] =
  Object.freeze([
    Object.freeze({
      id: "storefront.operations",
      path: "/storefront",
      navigationLabel: "Storefront",
      permission: "storefront.storefront.read",
      module: "storefront",
      order: 740,
      exact: true,
    }),
  ]);
