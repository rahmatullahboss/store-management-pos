export interface ModAAdminRoute {
  readonly id: string;
  readonly path: string;
  readonly navigationLabel: string;
  readonly permission: string;
  readonly module: "catalog" | "pricing" | "tax";
  readonly order: number;
  readonly exact?: boolean;
}

export const CATALOG_ADMIN_ROUTES: readonly ModAAdminRoute[] = Object.freeze([
  Object.freeze({ id: "catalog.products", path: "/catalog", navigationLabel: "Catalog", permission: "catalog.product.read", module: "catalog", order: 110, exact: true }),
  Object.freeze({ id: "catalog.product", path: "/catalog/products/:productId", navigationLabel: "Product workspace", permission: "catalog.product.read", module: "catalog", order: 111 }),
  Object.freeze({ id: "catalog.imports", path: "/catalog/imports", navigationLabel: "Catalog imports", permission: "catalog.import.execute", module: "catalog", order: 112, exact: true }),
  Object.freeze({ id: "catalog.units", path: "/catalog/units", navigationLabel: "Units and conversions", permission: "catalog.unit.manage", module: "catalog", order: 113, exact: true }),
]);
