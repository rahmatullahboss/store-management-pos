import assert from "node:assert/strict";
import test from "node:test";

import {
  STAGING_ADMIN_ROUTE_PERMISSIONS,
  isAuthorizedStagingAdminPath,
  requiredPermissionForStagingAdminPath,
} from "../../build/apps/api/src/staging-admin-route-authorization.js";

test("staging Admin authorization registry covers 24 unique permission routes", () => {
  assert.equal(STAGING_ADMIN_ROUTE_PERMISSIONS.length, 24);
  assert.equal(new Set(STAGING_ADMIN_ROUTE_PERMISSIONS.map((item) => item.pattern)).size, 24);
});

test("dynamic product route and trailing slashes resolve the expected permission", () => {
  assert.equal(requiredPermissionForStagingAdminPath("/catalog/products/018f-role-e2e"), "catalog.product.read");
  assert.equal(requiredPermissionForStagingAdminPath("/finance/accounting/"), "accounting.read");
});

test("direct Admin route authorization allows matching permission and denies missing permission", () => {
  assert.equal(isAuthorizedStagingAdminPath("/inventory", ["inventory.stock.read"]), true);
  assert.equal(isAuthorizedStagingAdminPath("/inventory", ["catalog.product.read"]), false);
  assert.equal(isAuthorizedStagingAdminPath("/", []), true);
  assert.equal(isAuthorizedStagingAdminPath("/not-a-route", []), false);
});
