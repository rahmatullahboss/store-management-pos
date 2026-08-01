import assert from "node:assert/strict";
import test from "node:test";
import { addMainWebProbeCoverage } from "../../tooling/scripts/staging-main-web-probe-patch.mjs";

const source = `const probes = [];
  probes.push(await probe(baseUrl, "/admin/procurement", "Procurement", 200, authenticated));
  probes.push(await probe(baseUrl, "/pos", "Persistent staging · synthetic POS", 200, authenticated));`;

test("main-web staging probe transform covers connected routes with authorization-aware status", () => {
  const patched = addMainWebProbeCoverage(source);
  for (const marker of [
    "/admin/catalog/products/synthetic-product",
    "/admin/pricing/promotions",
    "/admin/fulfillment",
    "/admin/finance/payments",
    "/admin/finance/readiness",
    "/admin/pos/reconciliation",
    "/admin/localization",
    "/admin/reporting",
    "/admin/integrations",
    "/admin/platform/saas",
  ]) {
    assert.match(patched, new RegExp(marker.replaceAll("/", "\\/"), "u"), marker);
  }
  assert.match(patched, /"\/admin\/catalog\/products\/synthetic-product", "Catalog operations", 200/u);
  assert.match(patched, /"\/admin\/pricing", "Pricing and tax control", 200/u);
  assert.match(patched, /"\/admin\/tax", "Tax", 200/u);
  assert.match(patched, /"\/admin\/catalog\/imports", "", 403/u);
  assert.match(patched, /"\/admin\/pricing\/promotions", "", 403/u);
  assert.match(patched, /"\/admin\/finance\/payments", "", 403/u);
  assert.match(patched, /"\/admin\/platform\/saas", "", 403/u);
  assert.match(patched, /"\/admin\/not-a-real-route", "Page not found", 404/u);
  assert.equal(addMainWebProbeCoverage(patched), patched);
});

test("main-web staging probe transform fails when the deployment contract drifts", () => {
  assert.throws(
    () => addMainWebProbeCoverage("const probes = [];"),
    /probe anchor was not found/u,
  );
});
