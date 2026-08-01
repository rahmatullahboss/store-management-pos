import assert from "node:assert/strict";
import test from "node:test";

import { createStorefrontInventoryQuotePort } from "../../build/modules/storefront/src/inventory-quote-adapter.js";

const context = Object.freeze({
  tenantId: "tenant-1",
  storefrontId: "storefront-1",
  salesChannelId: "channel-1",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v3",
  publicationGeneration: "publication:12",
});
const principal = Object.freeze({
  requestContext: Object.freeze({
    requestId: "request-1",
    traceId: "trace-1",
    tenantId: context.tenantId,
    actorId: "buyer-1",
    legalEntityId: "entity-1",
    storeId: "store-1",
    locale: context.locale,
    timeZone: "Europe/London",
    businessDate: "2026-08-01",
    region: "GB",
    permissions: new Set(["sales.quote.create"]),
  }),
  customer: Object.freeze({ customerId: "customer-1" }),
});
const item = Object.freeze({
  itemId: "product-1",
  variantId: "variant-1",
});
const quantity = Object.freeze({ amount: "3", unit: "EA", scale: 0 });

function availability(warehouseId, amount, version, scale = 0) {
  return Object.freeze({
    variantId: item.variantId,
    warehouseId,
    onHand: Object.freeze({ amount, unit: "EA", scale }),
    reserved: Object.freeze({ amount: "0", unit: "EA", scale }),
    available: Object.freeze({ amount, unit: "EA", scale }),
    asOf: "2026-08-01T17:00:00.000Z",
    version,
  });
}

test("inventory quote adapter aggregates all sales-channel warehouses exactly and emits opaque evidence", async () => {
  const observed = [];
  const port = createStorefrontInventoryQuotePort({
    warehouses: {
      async resolve(input) {
        assert.deepEqual(input, {
          tenantId: context.tenantId,
          storefrontId: context.storefrontId,
          salesChannelId: context.salesChannelId,
          legalEntityId: "entity-1",
          storeId: "store-1",
        });
        return ["warehouse-b", "warehouse-a"];
      },
    },
    stock: {
      async availability(input) {
        observed.push(input.warehouseId);
        return input.warehouseId === "warehouse-a"
          ? availability("warehouse-a", "1", "17")
          : availability("warehouse-b", "2", "9");
      },
    },
  });

  const result = await port.resolve({ context, principal, item, quantity });

  assert.deepEqual(observed, ["warehouse-a", "warehouse-b"]);
  assert.equal(result.variantId, item.variantId);
  assert.equal(result.sufficient, true);
  assert.match(result.version, /^mw-[0-9a-f]{64}$/u);
});

test("inventory quote adapter marks aggregate shortage without guessing a warehouse", async () => {
  const port = createStorefrontInventoryQuotePort({
    warehouses: { async resolve() { return ["warehouse-a", "warehouse-b"]; } },
    stock: {
      async availability(input) {
        return availability(input.warehouseId, "1", `${input.warehouseId}:4`);
      },
    },
  });

  const result = await port.resolve({ context, principal, item, quantity });
  assert.equal(result.sufficient, false);
  assert.match(result.version, /^mw-[0-9a-f]{64}$/u);
});

test("inventory evidence token is deterministic across unordered warehouse scope", async () => {
  const makePort = (ids) => createStorefrontInventoryQuotePort({
    warehouses: { async resolve() { return ids; } },
    stock: {
      async availability(input) {
        return input.warehouseId === "warehouse-a"
          ? availability("warehouse-a", "1", "v-a")
          : availability("warehouse-b", "2", "v-b");
      },
    },
  });

  const first = await makePort(["warehouse-b", "warehouse-a"]).resolve({
    context,
    principal,
    item,
    quantity,
  });
  const second = await makePort(["warehouse-a", "warehouse-b"]).resolve({
    context,
    principal,
    item,
    quantity,
  });
  assert.equal(first.version, second.version);
});

test("inventory quote adapter reconciles exact scales without floating point", async () => {
  const fractionalQuantity = Object.freeze({ amount: "15", unit: "EA", scale: 1 });
  const port = createStorefrontInventoryQuotePort({
    warehouses: { async resolve() { return ["warehouse-a", "warehouse-b"]; } },
    stock: {
      async availability(input) {
        return input.warehouseId === "warehouse-a"
          ? availability("warehouse-a", "5", "1", 1)
          : availability("warehouse-b", "1", "2", 0);
      },
    },
  });

  const result = await port.resolve({
    context,
    principal,
    item,
    quantity: fractionalQuantity,
  });
  assert.equal(result.sufficient, true);
});

test("inventory quote adapter fails closed on duplicate warehouse scope and mismatched MOD-B evidence", async () => {
  await assert.rejects(
    createStorefrontInventoryQuotePort({
      warehouses: { async resolve() { return ["warehouse-a", "warehouse-a"]; } },
      stock: { async availability() { throw new Error("unexpected"); } },
    }).resolve({ context, principal, item, quantity }),
    /contains duplicates/u,
  );

  await assert.rejects(
    createStorefrontInventoryQuotePort({
      warehouses: { async resolve() { return ["warehouse-a"]; } },
      stock: {
        async availability() {
          return {
            ...availability("warehouse-a", "3", "1"),
            variantId: "variant-other",
          };
        },
      },
    }).resolve({ context, principal, item, quantity }),
    /mismatched scope/u,
  );
});
