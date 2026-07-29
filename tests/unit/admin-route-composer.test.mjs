import test from "node:test";
import assert from "node:assert/strict";
import { renderAdminShell } from "../../build/apps/admin-web/src/app-shell/index.js";
import { adminRoutes, composeAdminRoutes } from "../../build/apps/admin-web/src/app-shell/routes.js";
import { CATALOG_ADMIN_ROUTES } from "../../build/apps/admin-web/src/modules/catalog/routes.js";
import { PRICING_TAX_ADMIN_ROUTES } from "../../build/apps/admin-web/src/modules/pricing/routes.js";

const route = (overrides = {}) => ({
  id: "catalog.products",
  path: "/catalog",
  navigationLabel: "Catalog",
  permission: "catalog.product.read",
  module: "catalog",
  order: 110,
  exact: true,
  ...overrides,
});

test("admin route composition preserves the Foundation route array when no providers are supplied", () => {
  assert.equal(composeAdminRoutes(), adminRoutes);
  assert.deepEqual(composeAdminRoutes(), [
    { path: "/", label: "Overview", icon: "O" },
    { path: "/platform/reference", label: "Foundation reference", icon: "F", permission: "platform.reference.read" },
    { path: "/audit", label: "Audit history", icon: "A", permission: "platform.audit.read" },
    { path: "/access", label: "Access control", icon: "P", permission: "platform.access.manage" },
  ]);
});

test("admin route composition sorts module providers deterministically", () => {
  const composed = composeAdminRoutes([
    [route({ id: "tax.configuration", path: "/tax", navigationLabel: "Tax", permission: "tax.calculation.read", module: "tax", order: 130 })],
    [route(), route({ id: "pricing.lists", path: "/pricing", navigationLabel: "Pricing", permission: "pricing.price.read", module: "pricing", order: 120 })],
  ]);

  assert.deepEqual(composed.slice(adminRoutes.length).map((item) => item.path), ["/catalog", "/pricing", "/tax"]);
  assert.deepEqual(composed.slice(adminRoutes.length).map((item) => item.icon), ["C", "P", "T"]);
});

test("admin route composition rejects duplicate provider ids and paths", () => {
  assert.throws(
    () => composeAdminRoutes([[route(), route({ path: "/catalog/alternate" })]]),
    /Duplicate admin route id: catalog\.products/,
  );
  assert.throws(
    () => composeAdminRoutes([[route(), route({ id: "catalog.alternate" })]]),
    /Duplicate admin route path: \/catalog/,
  );
  assert.throws(
    () => composeAdminRoutes([[route({ id: "catalog.root", path: "/" })]]),
    /Duplicate admin route path: \//,
  );
});

test("MOD-A contributes nine unique permission-scoped routes to the integrated admin shell", () => {
  const descriptors = [...CATALOG_ADMIN_ROUTES, ...PRICING_TAX_ADMIN_ROUTES];
  const composed = composeAdminRoutes([CATALOG_ADMIN_ROUTES, PRICING_TAX_ADMIN_ROUTES]);

  assert.equal(descriptors.length, 9);
  assert.equal(new Set(descriptors.map((item) => item.id)).size, 9);
  assert.equal(new Set(descriptors.map((item) => item.path)).size, 9);
  assert.deepEqual(composed.slice(adminRoutes.length).map((item) => item.path), descriptors.map((item) => item.path));

  const catalogOnly = renderAdminShell({
    displayName: "Catalog Operator",
    tenantName: "Alpha Retail",
    permissions: new Set(["catalog.product.read"]),
    currentPath: "/catalog",
    content: "<h1>Catalog</h1>",
  });

  assert.match(catalogOnly, />Catalog</);
  assert.match(catalogOnly, />Product workspace</);
  assert.doesNotMatch(catalogOnly, />Pricing</);
  assert.doesNotMatch(catalogOnly, />Tax</);
});
