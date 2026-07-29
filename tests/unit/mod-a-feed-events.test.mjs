import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalogFeedPage, decodeCatalogFeedCursor, encodeCatalogFeedCursor } from "../../build/modules/catalog/src/feed.js";
import { queryCatalogSnapshotFeed } from "../../build/modules/catalog/src/repository.js";
import { catalogProductChangedEvent } from "../../build/modules/catalog/src/events.js";
import { priceListPublishedEvent, promotionChangedEvent } from "../../build/modules/pricing/src/events.js";
import { taxConfigurationPublishedEvent } from "../../build/modules/tax/src/events.js";

const TENANT_ID = "018f0000-0000-7000-8000-000000000001";
const ACTOR_ID = "018f0000-0000-7000-8000-000000000101";
const IDS = [
  "018f7000-0000-7000-8000-000000000001",
  "018f7000-0000-7000-8000-000000000002",
  "018f7000-0000-7000-8000-000000000003",
];

function feedEntry(index, updatedAt) {
  return {
    productId: "018f7000-0000-7000-8000-000000000010",
    variantId: IDS[index],
    productCode: "PRODUCT-ONE",
    sku: `SKU-${index + 1}`,
    displayName: "Representative product",
    variantTitle: `Variant ${index + 1}`,
    status: index === 2 ? "inactive" : "active",
    unitCode: "EA",
    taxCode: "VAT-STANDARD",
    barcodes: [`BAR-${index + 1}`],
    version: BigInt(index + 1),
    updatedAt,
  };
}

function requestContext(permissions) {
  return {
    requestId: "request-feed-one",
    traceId: "trace-feed-one",
    tenantId: TENANT_ID,
    actorId: ACTOR_ID,
    locale: "en-GB",
    timeZone: "Europe/London",
    businessDate: "2026-07-28",
    region: "eu-west",
    permissions: new Set(permissions),
  };
}

test("catalog feed cursor is deterministic and carries inactive variants", () => {
  const entries = [
    feedEntry(2, "2026-07-28T10:01:00.000Z"),
    feedEntry(1, "2026-07-28T10:00:00.000Z"),
    feedEntry(0, "2026-07-28T10:00:00.000Z"),
  ];
  const first = buildCatalogFeedPage({ entries, snapshotAt: "2026-07-28T11:00:00.000Z", limit: 2 });
  assert.deepEqual(first.entries.map((entry) => entry.variantId), [IDS[0], IDS[1]]);
  assert.equal(first.hasMore, true);
  assert.deepEqual(decodeCatalogFeedCursor(first.nextCursor), { updatedAt: "2026-07-28T10:00:00.000Z", variantId: IDS[1] });
  const second = buildCatalogFeedPage({ entries, snapshotAt: first.snapshotAt, cursor: first.nextCursor, limit: 2 });
  assert.deepEqual(second.entries.map((entry) => [entry.variantId, entry.status]), [[IDS[2], "inactive"]]);
  assert.equal(second.hasMore, false);
  assert.equal(encodeCatalogFeedCursor(decodeCatalogFeedCursor(first.nextCursor)), first.nextCursor);
});

test("catalog snapshot repository requests a look-ahead row and enforces feed permission", async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [
        { product_id: "product-one", variant_id: IDS[0], product_code: "P1", sku: "SKU-1", display_name: "One", variant_title: "One", status: "active", unit_code: "EA", tax_code: null, barcodes: ["BAR-1"], version: "1", updated_at: "2026-07-28T10:00:00.000Z" },
        { product_id: "product-one", variant_id: IDS[1], product_code: "P1", sku: "SKU-2", display_name: "Two", variant_title: "Two", status: "inactive", unit_code: "EA", tax_code: "VAT", barcodes: ["BAR-2"], version: "2", updated_at: "2026-07-28T10:00:01.000Z" },
      ] };
    },
  };
  const page = await queryCatalogSnapshotFeed(client, requestContext(["catalog.feed.read"]), {
    locale: "en-GB",
    snapshotAt: "2026-07-28T11:00:00.000Z",
    limit: 1,
  });
  assert.equal(calls[0].values[4], 2);
  assert.equal(page.entries.length, 1);
  assert.equal(page.hasMore, true);
  await assert.rejects(() => queryCatalogSnapshotFeed(client, requestContext([]), {
    locale: "en-GB",
    snapshotAt: "2026-07-28T11:00:00.000Z",
  }), /Permission denied: catalog\.feed\.read/);
});

test("MOD-A change events use stable versioned envelopes", () => {
  const common = { eventId: IDS[0], tenantId: TENANT_ID, actorId: ACTOR_ID, correlationId: "correlation-one", businessDate: "2026-07-28" };
  const catalogEvent = catalogProductChangedEvent({ ...common, payload: { productId: IDS[1], version: "7", status: "active", changeKind: "updated", variantIds: [IDS[2]], updatedAt: "2026-07-28T10:00:00Z" } });
  assert.equal(catalogEvent.eventType, "catalog.product.changed.v1");
  assert.ok(Object.isFrozen(catalogEvent.payload.variantIds));
  const priceEvent = priceListPublishedEvent({ ...common, payload: { priceListId: IDS[1], version: "3", currency: "GBP", moneyScale: 2, effectiveFrom: "2026-08-01", scope: { channel: "pos" }, publishedAt: "2026-07-28T10:00:00Z" } });
  assert.equal(priceEvent.eventType, "pricing.price_list.published.v1");
  const promotionEvent = promotionChangedEvent({ ...common, payload: { promotionId: IDS[1], version: "4", status: "scheduled", effectiveFrom: "2026-08-01", publishedAt: "2026-07-28T10:00:00Z" } });
  assert.equal(promotionEvent.eventType, "pricing.promotion.changed.v1");
  const taxEvent = taxConfigurationPublishedEvent({ ...common, payload: { taxCodeId: IDS[1], taxCodeVersion: "2", jurisdictionId: IDS[2], rateVersions: [{ rateId: IDS[0], version: "5", rateBasisPoints: "2000", compound: false }], effectiveFrom: "2026-08-01", publishedAt: "2026-07-28T10:00:00Z" } });
  assert.equal(taxEvent.eventType, "tax.configuration.published.v1");
  assert.throws(() => catalogProductChangedEvent({ ...common, payload: { productId: IDS[1], version: "0", status: "active", changeKind: "updated", variantIds: [], updatedAt: "2026-07-28" } }), /version is invalid/);
});
