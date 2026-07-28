import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const migrationPath = "database/migrations/catalog/CAT-0002-search-performance.sql";

test("CAT-0002 keeps the public feed signature and stages exact identifiers before fallback search", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /CREATE OR REPLACE FUNCTION catalog\.search_variant_feed\(/);
  assert.match(sql, /FROM catalog\.variant_barcodes barcode/);
  assert.match(sql, /barcode\.normalized_value=v_query/);
  assert.match(sql, /d\.sku=v_query/);
  assert.match(sql, /d\.product_code=v_query/);
  assert.match(sql, /GET DIAGNOSTICS v_rows = ROW_COUNT/);
  assert.match(sql, /d\.search_vector @@ plainto_tsquery/);
  assert.match(sql, /v_query ~ '\^\[A-Z0-9\._\/-\]\+\$'/);
  assert.match(sql, /p_query OPERATOR\(public\.<%\) d\.searchable_text/);
  assert.doesNotMatch(sql, /d\.sku=upper\(btrim\(p_query\)\) OR d\.product_code/);
});

test("catalog migration manifest pins the CAT-0002 checksum", async () => {
  const [sql, manifestText] = await Promise.all([
    readFile(migrationPath),
    readFile("database/migrations/catalog/manifest.json", "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const entry = manifest.migrations.find((migration) => migration.id === "CAT-0002");
  assert.ok(entry);
  assert.equal(entry.file, "CAT-0002-search-performance.sql");
  assert.equal(entry.sha256, createHash("sha256").update(sql).digest("hex"));
});

test("MOD-A publishing and feed migrations pin checksums and fail closed on overlap", async () => {
  const migrations = [
    ["database/migrations/catalog/CAT-0003-pos-feed.sql", "database/migrations/catalog/manifest.json", "CAT-0003"],
    ["database/migrations/pricing/PRC-0002-price-tax-snapshot.sql", "database/migrations/pricing/manifest.json", "PRC-0002"],
    ["database/migrations/pricing/PRC-0003-publishing.sql", "database/migrations/pricing/manifest.json", "PRC-0003"],
    ["database/migrations/tax/TAX-0002-publishing.sql", "database/migrations/tax/manifest.json", "TAX-0002"],
  ];
  for (const [migrationPath, manifestPath, id] of migrations) {
    const [sql, manifestText] = await Promise.all([readFile(migrationPath), readFile(manifestPath, "utf8")]);
    const entry = JSON.parse(manifestText).migrations.find((migration) => migration.id === id);
    assert.ok(entry, `${id} manifest entry is missing`);
    assert.equal(entry.sha256, createHash("sha256").update(sql).digest("hex"));
  }
  const [pricePublish, taxPublish, feed, snapshot] = await Promise.all([
    readFile("database/migrations/pricing/PRC-0003-publishing.sql", "utf8"),
    readFile("database/migrations/tax/TAX-0002-publishing.sql", "utf8"),
    readFile("database/migrations/catalog/CAT-0003-pos-feed.sql", "utf8"),
    readFile("database/migrations/pricing/PRC-0002-price-tax-snapshot.sql", "utf8"),
  ]);
  assert.match(pricePublish, /tstzrange\(existing\.effective_from,existing\.effective_until/);
  assert.match(pricePublish, /price list version conflict/);
  assert.match(pricePublish, /promotion version conflict/);
  assert.match(taxPublish, /tax code effective range overlaps/);
  assert.match(taxPublish, /tax jurisdiction version conflict/);
  assert.match(feed, /ORDER BY d\.updated_at,d\.variant_id/);
  assert.match(feed, /p_after_updated_at IS NULL/);
  assert.match(snapshot, /CREATE TRIGGER append_only/);
  assert.match(snapshot, /subtotal_minor - discount_minor = promoted_amount_minor/);
  assert.match(snapshot, /net_minor \+ tax_minor = gross_minor/);
});

test("MOD-A records the shared route deficiency instead of editing the Foundation registry", async () => {
  const [request, sharedRoutes, catalogRoutes, pricingRoutes] = await Promise.all([
    readFile("docs/contracts/change-requests/CCR-0001-MOD-A-ADMIN-ROUTE-PROVIDERS.md", "utf8"),
    readFile("apps/admin-web/src/app-shell/routes.ts", "utf8"),
    readFile("apps/admin-web/src/modules/catalog/routes.ts", "utf8"),
    readFile("apps/admin-web/src/modules/pricing/routes.ts", "utf8"),
  ]);
  assert.match(request, /Status:\*\* Requested/);
  assert.match(request, /CATALOG_ADMIN_ROUTES/);
  assert.match(request, /PRICING_TAX_ADMIN_ROUTES/);
  assert.doesNotMatch(sharedRoutes, /\/catalog|\/pricing|\/tax/);
  assert.match(catalogRoutes, /\/catalog/);
  assert.match(pricingRoutes, /\/pricing/);
  assert.match(pricingRoutes, /\/tax/);
});
