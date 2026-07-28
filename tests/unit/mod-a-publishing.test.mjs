import test from "node:test";
import assert from "node:assert/strict";
import { publishPriceListVersion, publishPromotionVersion } from "../../build/modules/pricing/src/publishing.js";
import { publishTaxConfiguration } from "../../build/modules/tax/src/publishing.js";

const IDS = {
  priceList: "018fa000-0000-7000-8000-000000000001",
  priceVersion: "018fa000-0000-7000-8000-000000000002",
  priceRule: "018fa000-0000-7000-8000-000000000003",
  variant: "018fa000-0000-7000-8000-000000000004",
  promotion: "018fa000-0000-7000-8000-000000000005",
  promotionVersion: "018fa000-0000-7000-8000-000000000006",
  jurisdiction: "018fa000-0000-7000-8000-000000000007",
  taxCode: "018fa000-0000-7000-8000-000000000008",
  taxVersion: "018fa000-0000-7000-8000-000000000009",
  taxRate: "018fa000-0000-7000-8000-000000000010",
};

function context(permissions) {
  return {
    requestId: "request-publish-one",
    traceId: "trace-publish-one",
    tenantId: "018f0000-0000-7000-8000-000000000001",
    actorId: "018f0000-0000-7000-8000-000000000101",
    locale: "en-GB",
    timeZone: "Europe/London",
    businessDate: "2026-07-28",
    region: "eu-west",
    permissions: new Set(permissions),
  };
}

function mockClient(row) {
  const calls = [];
  return {
    calls,
    client: {
      async query(text, values) {
        calls.push({ text, values });
        return { rows: [row] };
      },
    },
  };
}

test("price list publishing requires manage and publish permissions and serializes exact rules", async () => {
  const mock = mockClient({ price_list_id: IDS.priceList, version: "2", status: "scheduled", replayed: false, effective_from: "2026-08-01T00:00:00.000Z" });
  const input = {
    idempotencyKey: "publish-price-one",
    requestHash: "a".repeat(64),
    priceList: { id: IDS.priceList, code: "RETAIL-GBP", name: "Retail GBP", currency: "GBP", scale: 2, expectedCurrentVersion: 1n },
    version: { id: IDS.priceVersion, status: "scheduled", priority: 10, channel: "pos", effectiveFrom: "2026-08-01T00:00:00Z", reason: "Approved August price" },
    rules: [{ id: IDS.priceRule, variantId: IDS.variant, unitCode: "EA", minimumQuantityMinor: 1n, quantityScale: 0, unitPriceMinor: 1_250n, compareAtPriceMinor: 1_500n, minimumMarginBasisPoints: 2_000n, ruleVersion: 1n }],
  };
  const result = await publishPriceListVersion(mock.client, context(["pricing.price.manage", "pricing.price.publish"]), input);
  assert.equal(result.version, 2n);
  const list = JSON.parse(mock.calls[0].values[2]);
  const rules = JSON.parse(mock.calls[0].values[4]);
  assert.equal(list.expectedCurrentVersion, "1");
  assert.equal(rules[0].unitPriceMinor, "1250");
  assert.equal(rules[0].minimumMarginBasisPoints, "2000");
  await assert.rejects(() => publishPriceListVersion(mock.client, context(["pricing.price.manage"]), input), /Permission denied: pricing\.price\.publish/);
});

test("promotion publishing serializes redemption limits and enforces management permission", async () => {
  const mock = mockClient({ promotion_id: IDS.promotion, version: "1", status: "active", replayed: false, effective_from: "2026-08-01T00:00:00.000Z" });
  const input = {
    idempotencyKey: "publish-promotion-one",
    requestHash: "b".repeat(64),
    promotion: { id: IDS.promotion, code: "SAVE10", name: "Save ten", expectedCurrentVersion: 0n },
    version: {
      id: IDS.promotionVersion,
      status: "active",
      conditions: [],
      action: { type: "percentage", basisPoints: "1000" },
      effectiveFrom: "2026-08-01T00:00:00Z",
      globalRedemptionLimit: 10_000n,
      customerRedemptionLimit: 2n,
      reason: "Approved campaign",
    },
  };
  const result = await publishPromotionVersion(mock.client, context(["pricing.promotion.manage"]), input);
  assert.equal(result.aggregateId, IDS.promotion);
  const version = JSON.parse(mock.calls[0].values[3]);
  assert.equal(version.globalRedemptionLimit, "10000");
  assert.equal(version.customerRedemptionLimit, "2");
  await assert.rejects(() => publishPromotionVersion(mock.client, context([]), input), /Permission denied: pricing\.promotion\.manage/);
});

test("tax publishing accepts zero-rated components and requires manage plus publish permissions", async () => {
  const mock = mockClient({ tax_code_id: IDS.taxCode, version: "1", status: "active", replayed: false, effective_from: "2026-08-01T00:00:00.000Z" });
  const input = {
    idempotencyKey: "publish-tax-one",
    requestHash: "c".repeat(64),
    jurisdiction: { id: IDS.jurisdiction, code: "GB", name: "Great Britain", countryCode: "GB", expectedVersion: 0n },
    taxCode: { id: IDS.taxCode, code: "VAT-ZERO", name: "Zero VAT", expectedCurrentVersion: 0n },
    codeVersion: { id: IDS.taxVersion, status: "active", defaultTreatment: "zero_rated", priceMode: "exclusive", roundingMode: "half_up", effectiveFrom: "2026-08-01T00:00:00Z", reason: "Approved zero rate" },
    rates: [{ id: IDS.taxRate, code: "VAT0", name: "Zero rate", rateBasisPoints: 0n, recoverableBasisPoints: 0n }],
  };
  const result = await publishTaxConfiguration(mock.client, context(["tax.configuration.manage", "tax.configuration.publish"]), input);
  assert.equal(result.version, 1n);
  const jurisdiction = JSON.parse(mock.calls[0].values[2]);
  const taxCode = JSON.parse(mock.calls[0].values[3]);
  const rates = JSON.parse(mock.calls[0].values[5]);
  assert.equal(jurisdiction.expectedVersion, "0");
  assert.equal(taxCode.expectedCurrentVersion, "0");
  assert.equal(rates[0].rateBasisPoints, "0");
  await assert.rejects(() => publishTaxConfiguration(mock.client, context(["tax.configuration.manage"]), input), /Permission denied: tax\.configuration\.publish/);
});
