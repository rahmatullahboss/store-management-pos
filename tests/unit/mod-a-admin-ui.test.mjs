import test from "node:test";
import assert from "node:assert/strict";
import { renderCatalogAdmin } from "../../build/apps/admin-web/src/modules/catalog/workspace.js";
import { CATALOG_ADMIN_ROUTES } from "../../build/apps/admin-web/src/modules/catalog/routes.js";
import { renderPricingTaxAdmin } from "../../build/apps/admin-web/src/modules/pricing/workspace.js";
import { PRICING_TAX_ADMIN_ROUTES } from "../../build/apps/admin-web/src/modules/pricing/routes.js";

const locales = ["en", "bn", "ar", "ja"];
const states = ["ready", "loading", "empty", "error", "denied", "conflict", "offline"];

test("MOD-A catalog admin renders task hierarchy, provenance and controlled actions", () => {
  const html = renderCatalogAdmin();
  assert.match(html, /THESIS: Catalog operations/);
  assert.match(html, /Synthetic interface fixture/);
  assert.match(html, /Catalog operations/);
  assert.match(html, /Product ledger/);
  assert.match(html, /SHIRT-BLUE-M/);
  assert.match(html, /Version trail/);
  assert.match(html, /Dry-run validation/);
  assert.match(html, /Append-only effective versions/);
  assert.doesNotMatch(html, /font-family:Inter/);
  assert.match(html, /var\(--rail,#14251e\)/);
});

test("MOD-A pricing and tax admin explains precedence, snapshots and approvals", () => {
  const html = renderPricingTaxAdmin();
  assert.match(html, /THESIS: Pricing and tax operations/);
  assert.match(html, /Pricing and tax control/);
  assert.match(html, /Precedence: customer group/);
  assert.match(html, /Promotion simulator/);
  assert.match(html, /Manual discount control/);
  assert.match(html, /Tax calculation snapshot/);
  assert.match(html, /Net \+ tax equals gross exactly/);
  assert.match(html, /Approve with audit/);
  assert.match(html, /£96\.00/);
});

test("MOD-A admin surfaces externalise primary copy and preserve Arabic RTL", () => {
  for (const locale of locales) {
    const catalog = renderCatalogAdmin({ locale });
    const pricing = renderPricingTaxAdmin({ locale });
    assert.match(catalog, new RegExp(`lang="${locale}"`));
    assert.match(pricing, new RegExp(`lang="${locale}"`));
    assert.match(catalog, new RegExp(`dir="${locale === "ar" ? "rtl" : "ltr"}"`));
    assert.match(pricing, new RegExp(`dir="${locale === "ar" ? "rtl" : "ltr"}"`));
  }
  assert.match(renderCatalogAdmin({ locale: "bn" }), /ক্যাটালগ অপারেশন/);
  assert.match(renderPricingTaxAdmin({ locale: "ar" }), /التحكم في التسعير والضريبة/);
  assert.match(renderCatalogAdmin({ locale: "ja" }), /カタログ運用/);
});

test("MOD-A admin surfaces expose resilient loading, empty, error, denied, conflict and offline states", () => {
  for (const state of states) {
    const catalog = renderCatalogAdmin({ state });
    const pricing = renderPricingTaxAdmin({ state });
    assert.match(catalog, new RegExp(`data-state="${state}"`));
    assert.match(pricing, new RegExp(`data-state="${state}"`));
    if (state === "ready") {
      assert.doesNotMatch(catalog, /class="moda-state/);
      assert.doesNotMatch(pricing, /class="moda-state/);
    } else {
      assert.match(catalog, new RegExp(`moda-state--${state}`));
      assert.match(pricing, new RegExp(`moda-state--${state}`));
    }
  }
  assert.match(renderCatalogAdmin({ state: "loading" }), /aria-busy="true"/);
  assert.match(renderPricingTaxAdmin({ state: "conflict" }), /role="alert"/);
  assert.equal((renderCatalogAdmin({ state: "empty" }).match(/<tbody><\/tbody>/g) ?? []).length, 1);
});

test("MOD-A route descriptors remain module-owned and permission-scoped", () => {
  const allRoutes = [...CATALOG_ADMIN_ROUTES, ...PRICING_TAX_ADMIN_ROUTES];
  assert.equal(allRoutes.length, 9);
  assert.equal(new Set(allRoutes.map((route) => route.id)).size, allRoutes.length);
  assert.equal(new Set(allRoutes.map((route) => route.path)).size, allRoutes.length);
  assert.ok(allRoutes.every((route) => route.permission.includes(".")));
  assert.ok(allRoutes.every((route) => route.order >= 110 && route.order <= 131));
  assert.deepEqual(CATALOG_ADMIN_ROUTES.map((route) => route.module), ["catalog", "catalog", "catalog", "catalog"]);
  assert.deepEqual(PRICING_TAX_ADMIN_ROUTES.map((route) => route.module), ["pricing", "pricing", "pricing", "tax", "tax"]);
});
