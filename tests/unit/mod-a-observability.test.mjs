import test from "node:test";
import assert from "node:assert/strict";
import { CatalogApi } from "../../build/modules/catalog/src/api.js";
import { PricingPublishingApi } from "../../build/modules/pricing/src/publishing.js";
import { TaxPublishingApi } from "../../build/modules/tax/src/publishing.js";

function context(permissions) {
  return {
    requestId: "request-observe-one",
    traceId: "trace-observe-one",
    tenantId: "018f0000-0000-7000-8000-000000000001",
    actorId: "018f0000-0000-7000-8000-000000000101",
    locale: "en-GB",
    timeZone: "Europe/London",
    businessDate: "2026-07-28",
    region: "eu-west",
    permissions: new Set(permissions),
  };
}

function metricSink() {
  const increments = [];
  const observations = [];
  return {
    increments,
    observations,
    increment(name, value = 1, attributes = {}) { increments.push({ name, value, attributes }); },
    observe(name, value, attributes = {}) { observations.push({ name, value, attributes }); },
  };
}

function databaseWithRows(rows) {
  return {
    async withClientTransaction(_context, operation) {
      return await operation({ async query() { return { rows }; } });
    },
  };
}

test("catalog feed emits request, duration and page-size metrics", async () => {
  const metrics = metricSink();
  const api = new CatalogApi({
    database: databaseWithRows([{
      product_id: "product-one",
      variant_id: "018fc000-0000-7000-8000-000000000001",
      product_code: "PRODUCT-ONE",
      sku: "SKU-ONE",
      display_name: "Representative product",
      variant_title: "Default",
      status: "active",
      unit_code: "EA",
      tax_code: "VAT-STANDARD",
      barcodes: ["BAR-ONE"],
      version: "1",
      updated_at: "2026-07-28T10:00:00.000Z",
    }]),
    metrics,
  });
  const page = await api.snapshotFeed(context(["catalog.feed.read"]), { locale: "en-GB", snapshotAt: "2026-07-28T11:00:00.000Z" });
  assert.equal(page.entries.length, 1);
  assert.ok(metrics.increments.some((metric) => metric.name === "catalog.feed.request"));
  assert.ok(metrics.observations.some((metric) => metric.name === "catalog.feed.duration_ms" && metric.attributes.pageSize === "1"));
  assert.ok(metrics.observations.some((metric) => metric.name === "catalog.feed.page_size" && metric.value === 1));
});

test("pricing publishing APIs emit labelled success and duration metrics", async () => {
  const metrics = metricSink();
  const priceListId = "018fc000-0000-7000-8000-000000000010";
  const api = new PricingPublishingApi({
    database: databaseWithRows([{ price_list_id: priceListId, version: "1", status: "active", replayed: false, effective_from: "2026-08-01T00:00:00.000Z" }]),
    metrics,
  });
  const result = await api.publishPriceList(context(["pricing.price.manage", "pricing.price.publish"]), {
    idempotencyKey: "observe-price-one",
    requestHash: "a".repeat(64),
    priceList: { id: priceListId, code: "OBSERVE-GBP", name: "Observe GBP", currency: "GBP", scale: 2, expectedCurrentVersion: 0n },
    version: { id: "018fc000-0000-7000-8000-000000000011", status: "active", effectiveFrom: "2026-08-01T00:00:00Z", reason: "Approved observed publish" },
    rules: [{ id: "018fc000-0000-7000-8000-000000000012", variantId: "018fc000-0000-7000-8000-000000000013", unitCode: "EA", minimumQuantityMinor: 1n, quantityScale: 0, unitPriceMinor: 1_000n }],
  });
  assert.equal(result.aggregateId, priceListId);
  assert.ok(metrics.increments.some((metric) => metric.name === "pricing.price_list.publish.success" && metric.attributes.replayed === "false"));
  assert.ok(metrics.observations.some((metric) => metric.name === "pricing.price_list.publish.duration_ms" && metric.attributes.status === "active"));
});

test("tax publishing API emits success and duration metrics", async () => {
  const metrics = metricSink();
  const taxCodeId = "018fc000-0000-7000-8000-000000000020";
  const api = new TaxPublishingApi({
    database: databaseWithRows([{ tax_code_id: taxCodeId, version: "1", status: "active", replayed: false, effective_from: "2026-08-01T00:00:00.000Z" }]),
    metrics,
  });
  const result = await api.publish(context(["tax.configuration.manage", "tax.configuration.publish"]), {
    idempotencyKey: "observe-tax-one",
    requestHash: "b".repeat(64),
    jurisdiction: { id: "018fc000-0000-7000-8000-000000000021", code: "GB", name: "Great Britain", countryCode: "GB", expectedVersion: 0n },
    taxCode: { id: taxCodeId, code: "VAT20", name: "VAT", expectedCurrentVersion: 0n },
    codeVersion: { id: "018fc000-0000-7000-8000-000000000022", status: "active", defaultTreatment: "standard", priceMode: "exclusive", roundingMode: "half_up", effectiveFrom: "2026-08-01T00:00:00Z", reason: "Approved observed tax" },
    rates: [{ id: "018fc000-0000-7000-8000-000000000023", code: "VAT20", name: "VAT 20 percent", rateBasisPoints: 2_000n }],
  });
  assert.equal(result.taxCodeId, taxCodeId);
  assert.ok(metrics.increments.some((metric) => metric.name === "tax.configuration.publish.success"));
  assert.ok(metrics.observations.some((metric) => metric.name === "tax.configuration.publish.duration_ms" && metric.attributes.status === "active"));
});
