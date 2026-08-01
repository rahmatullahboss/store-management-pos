import assert from "node:assert/strict";
import test from "node:test";

import { renderAdminShell } from "../../build/apps/admin-web/src/app-shell/index.js";
import { renderPosShell } from "../../build/apps/pos-web/src/app-shell/index.js";
import { directionSupportStyles } from "../../build/packages/ui/src/direction-support.js";
import { guidedWalkthroughMarkup } from "../../build/packages/ui/src/guided-walkthrough.js";

test("guided walkthrough mounts an accessible, restartable first-use guide", () => {
  assert.match(guidedWalkthroughMarkup, /data-guide-launcher/u);
  assert.match(guidedWalkthroughMarkup, /role="dialog" aria-modal="true"/u);
  assert.match(guidedWalkthroughMarkup, /Quick tour/u);
  assert.match(guidedWalkthroughMarkup, /Full walkthrough/u);
  assert.match(guidedWalkthroughMarkup, /data-guide-back/u);
  assert.match(guidedWalkthroughMarkup, /data-guide-next/u);
  assert.match(guidedWalkthroughMarkup, /event\.key==="Escape"/u);
  assert.match(guidedWalkthroughMarkup, /event\.key!=="Tab"/u);
  assert.match(guidedWalkthroughMarkup, /prefers-reduced-motion/u);
  assert.match(directionSupportStyles, /data-store-walkthrough/u);
});

test("full walkthrough derives its pages from permission-filtered navigation", () => {
  assert.match(guidedWalkthroughMarkup, /querySelectorAll\("\.primary-nav a\[href\]"\)/u);
  assert.match(guidedWalkthroughMarkup, /routeLinks\(\)\.forEach/u);
  assert.match(guidedWalkthroughMarkup, /signature:\s*signature\(\)/u);
  assert.match(guidedWalkthroughMarkup, /window\.sessionStorage/u);
  assert.match(guidedWalkthroughMarkup, /window\.localStorage/u);
  assert.match(guidedWalkthroughMarkup, /window\.location\.assign\(step\.href\)/u);
  assert.doesNotMatch(guidedWalkthroughMarkup, /<script[^>]+src=/u);
});

test("walkthrough documents the committed Admin and POS operating areas", () => {
  for (const path of [
    "/catalog",
    "/pricing",
    "/tax",
    "/inventory",
    "/procurement",
    "/customers",
    "/sales",
    "/fulfillment",
    "/finance/payments",
    "/finance/accounting",
    "/finance/banking",
    "/finance/readiness",
    "/pos/reconciliation",
    "/localization",
    "/compliance",
    "/reporting",
    "/integrations",
    "/platform/saas",
    "/sync",
    "/device",
  ]) {
    assert.match(guidedWalkthroughMarkup, new RegExp(`"${path.replaceAll("/", "\\/")}"`, "u"));
  }
});

test("Admin and POS shells both receive the same role-aware guide surface", () => {
  const admin = renderAdminShell({
    displayName: "Guide Admin",
    tenantName: "Synthetic Retail",
    permissions: new Set(["inventory.stock.read"]),
    currentPath: "/inventory",
    content: "<h1>Inventory</h1>",
  });
  const pos = renderPosShell({
    displayName: "Guide Cashier",
    tenantName: "Synthetic Retail",
    permissions: new Set(["platform.register.use"]),
    currentPath: "/",
    content: "<h1>Register</h1>",
    offlineState: { online: true, pendingOperations: 0 },
  });

  assert.match(admin, /data-shell="admin"/u);
  assert.match(admin, /data-store-walkthrough/u);
  assert.match(admin, /Inventory/u);
  assert.doesNotMatch(admin, /<span>Procurement<\/span>/u);
  assert.match(pos, /data-shell="pos"/u);
  assert.match(pos, /data-store-walkthrough/u);
  assert.match(pos, /<span>Register<\/span>/u);
  assert.doesNotMatch(pos, /<span>Sync status<\/span>/u);
});
