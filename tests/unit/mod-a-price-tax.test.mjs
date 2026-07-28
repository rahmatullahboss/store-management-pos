import test from "node:test";
import assert from "node:assert/strict";
import { calculatePriceAndTax } from "../../build/modules/pricing/src/price-tax.js";
import { persistPriceTaxSnapshot } from "../../build/modules/pricing/src/price-tax-repository.js";
import { definePriceList, definePriceRule } from "../../build/modules/pricing/src/model.js";

const VARIANT_ID = "018f5000-0000-7000-8000-000000000001";
const PRODUCT_ID = "018f5000-0000-7000-8000-000000000002";
const PRICE_LIST_ID = "018f5000-0000-7000-8000-000000000003";
const PRICE_RULE_ID = "018f5000-0000-7000-8000-000000000004";
const PROMOTION_ID = "018f5000-0000-7000-8000-000000000005";
const TAX_CODE_ID = "018f5000-0000-7000-8000-000000000006";
const JURISDICTION_ID = "018f5000-0000-7000-8000-000000000007";
const RATE_ID = "018f5000-0000-7000-8000-000000000008";
const SNAPSHOT_ID = "018f5000-0000-7000-8000-000000000009";

function priceList() {
  return definePriceList({
    id: PRICE_LIST_ID,
    code: "RETAIL-GBP",
    name: "Retail GBP",
    currency: "GBP",
    scale: 2,
    status: "active",
    priority: 10,
    scope: { channel: "pos" },
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    version: 7n,
  });
}

function priceRule() {
  return definePriceRule({
    id: PRICE_RULE_ID,
    priceListId: PRICE_LIST_ID,
    variantId: VARIANT_ID,
    unitCode: "EA",
    minimumQuantityMinor: 1n,
    quantityScale: 0,
    unitPriceMinor: 1_000n,
    currency: "GBP",
    moneyScale: 2,
    priority: 10,
    version: 3n,
  });
}

function baseInput(overrides = {}) {
  return {
    snapshotId: SNAPSHOT_ID,
    sourceLineId: "sale-line-1",
    productId: PRODUCT_ID,
    categoryIds: ["shirts"],
    tags: ["summer"],
    priceContext: {
      variantId: VARIANT_ID,
      unitCode: "EA",
      quantityMinor: 2n,
      quantityScale: 0,
      currency: "GBP",
      scale: 2,
      channel: "pos",
      at: "2026-07-28T10:00:00.000Z",
    },
    priceLists: [priceList()],
    priceRules: [priceRule()],
    promotions: [{
      id: PROMOTION_ID,
      code: "SAVE10",
      name: "Save ten percent",
      status: "active",
      priority: 100,
      exclusive: false,
      conditions: [{ type: "coupon", codes: ["SAVE10"] }],
      action: { type: "percentage", basisPoints: 1_000n },
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      version: 4n,
    }],
    promotionContext: {
      channel: "pos",
      couponCodes: ["SAVE10"],
      at: "2026-07-28T10:00:00.000Z",
    },
    taxCode: {
      id: TAX_CODE_ID,
      code: "VAT-STANDARD",
      name: "Standard VAT",
      defaultTreatment: "standard",
      priceMode: "exclusive",
      roundingMode: "half_up",
      status: "active",
      version: 2n,
    },
    taxRates: [{
      id: RATE_ID,
      taxCodeId: TAX_CODE_ID,
      jurisdictionId: JURISDICTION_ID,
      code: "VAT20",
      name: "VAT 20%",
      rateBasisPoints: 2_000n,
      compound: false,
      recoverableBasisPoints: 10_000n,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      priority: 10,
      version: 5n,
    }],
    taxContext: {
      taxCodeId: TAX_CODE_ID,
      jurisdictionId: JURISDICTION_ID,
    },
    rounding: "half_up",
    ...overrides,
  };
}

test("CalculatePriceAndTax applies promotions before exclusive tax and captures versions", async () => {
  const snapshot = await calculatePriceAndTax(baseInput());
  assert.equal(snapshot.schemaVersion, "1.0");
  assert.equal(snapshot.unitPriceMinor, 1_000n);
  assert.equal(snapshot.subtotalMinor, 2_000n);
  assert.equal(snapshot.discountMinor, 200n);
  assert.equal(snapshot.promotedAmountMinor, 1_800n);
  assert.equal(snapshot.netMinor, 1_800n);
  assert.equal(snapshot.taxMinor, 360n);
  assert.equal(snapshot.grossMinor, 2_160n);
  assert.equal(snapshot.priceListVersion, 7n);
  assert.equal(snapshot.priceRuleVersion, 3n);
  assert.deepEqual(snapshot.promotions.map((entry) => [entry.promotionId, entry.version, entry.discountMinor]), [[PROMOTION_ID, 4n, 200n]]);
  assert.deepEqual(snapshot.taxComponents.map((entry) => [entry.rateId, entry.rateBasisPoints, entry.taxMinor]), [[RATE_ID, 2_000n, 360n]]);
  assert.match(snapshot.calculationHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(snapshot));
});

test("CalculatePriceAndTax is deterministic and reconciles inclusive prices", async () => {
  const inclusiveInput = baseInput({
    promotions: [],
    promotionContext: { channel: "pos", at: "2026-07-28T10:00:00.000Z" },
    priceRules: [definePriceRule({
      id: PRICE_RULE_ID,
      priceListId: PRICE_LIST_ID,
      variantId: VARIANT_ID,
      unitCode: "EA",
      minimumQuantityMinor: 1n,
      quantityScale: 0,
      unitPriceMinor: 1_200n,
      currency: "GBP",
      moneyScale: 2,
      priority: 10,
      version: 3n,
    })],
    priceContext: {
      variantId: VARIANT_ID,
      unitCode: "EA",
      quantityMinor: 1n,
      quantityScale: 0,
      currency: "GBP",
      scale: 2,
      channel: "pos",
      at: "2026-07-28T10:00:00.000Z",
    },
    taxCode: { ...baseInput().taxCode, priceMode: "inclusive" },
  });
  const first = await calculatePriceAndTax(inclusiveInput);
  const second = await calculatePriceAndTax(inclusiveInput);
  assert.equal(first.calculationHash, second.calculationHash);
  assert.equal(first.promotedAmountMinor, 1_200n);
  assert.equal(first.netMinor, 1_000n);
  assert.equal(first.taxMinor, 200n);
  assert.equal(first.grossMinor, 1_200n);
  assert.equal(first.netMinor + first.taxMinor, first.grossMinor);
});

test("combined snapshot repository requires both pricing and tax permissions and serializes exact values", async () => {
  const snapshot = await calculatePriceAndTax(baseInput());
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      return { rows: [{
        snapshot_id: snapshot.snapshotId,
        source_line_id: snapshot.sourceLineId,
        variant_id: snapshot.variantId,
        currency: snapshot.currency,
        scale: snapshot.moneyScale,
        subtotal_minor: snapshot.subtotalMinor.toString(),
        discount_minor: snapshot.discountMinor.toString(),
        net_minor: snapshot.netMinor.toString(),
        tax_minor: snapshot.taxMinor.toString(),
        gross_minor: snapshot.grossMinor.toString(),
        calculation_hash: snapshot.calculationHash,
        replayed: false,
        created_at: "2026-07-28T10:00:00.000Z",
      }] };
    },
  };
  const context = {
    requestId: "request-price-tax-1",
    traceId: "trace-price-tax-1",
    tenantId: "018f0000-0000-7000-8000-000000000001",
    actorId: "018f0000-0000-7000-8000-000000000101",
    locale: "en-GB",
    timeZone: "Europe/London",
    businessDate: "2026-07-28",
    region: "eu-west",
    permissions: new Set(["pricing.price.read", "tax.calculation.read"]),
  };
  const persisted = await persistPriceTaxSnapshot(client, context, {
    idempotencyKey: "price-tax-idempotency-1",
    requestHash: "f".repeat(64),
    snapshot,
  });
  assert.equal(persisted.grossMinor, 2_160n);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /pricing\.record_price_tax_snapshot/);
  const serialized = JSON.parse(queries[0].values[2]);
  assert.equal(serialized.grossMinor, "2160");
  assert.equal(serialized.promotions[0].version, "4");
  assert.equal(serialized.taxComponents[0].rateBasisPoints, "2000");

  await assert.rejects(() => persistPriceTaxSnapshot(client, { ...context, permissions: new Set(["pricing.price.read"]) }, {
    idempotencyKey: "price-tax-idempotency-2",
    requestHash: "e".repeat(64),
    snapshot,
  }), /Permission denied: tax\.calculation\.read/);
});
