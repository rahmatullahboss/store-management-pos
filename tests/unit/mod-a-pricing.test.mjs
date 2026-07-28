import test from "node:test";
import assert from "node:assert/strict";
import { money } from "../../build/packages/foundation/src/money.js";
import { allocateMoneyExact, divideRounded, percentageOf } from "../../build/modules/pricing/src/exact.js";
import { definePriceList, definePriceRule, resolvePrice } from "../../build/modules/pricing/src/model.js";
import { evaluateManualDiscount, evaluatePromotions } from "../../build/modules/pricing/src/promotions.js";

const VARIANT_ID = "018f1000-0000-7000-8000-000000000101";

function basePriceList(overrides = {}) {
  return definePriceList({
    id: "018f2000-0000-7000-8000-000000000001",
    code: "RETAIL-GBP",
    name: "Retail GBP",
    currency: "GBP",
    scale: 2,
    status: "active",
    priority: 10,
    scope: {},
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    version: 1n,
    ...overrides,
  });
}

function priceRule(priceListId, unitPriceMinor, minimumQuantityMinor = 1n, overrides = {}) {
  return definePriceRule({
    id: `018f2000-0000-7000-8000-${String(unitPriceMinor).padStart(12, "0")}`,
    priceListId,
    variantId: VARIANT_ID,
    unitCode: "EA",
    minimumQuantityMinor,
    quantityScale: 0,
    unitPriceMinor,
    currency: "GBP",
    moneyScale: 2,
    priority: 10,
    version: 1n,
    ...overrides,
  });
}

test("pricing exact arithmetic applies deterministic rounding and allocation", () => {
  assert.equal(divideRounded(5n, 2n, "half_even"), 2n);
  assert.equal(divideRounded(7n, 2n, "half_even"), 4n);
  assert.equal(divideRounded(-5n, 2n, "floor"), -3n);
  assert.equal(percentageOf(money(999n, "GBP", 2), 1_500n, "half_up").amountMinor, 150n);
  const allocated = allocateMoneyExact(money(10n, "GBP", 2), [1n, 1n, 1n]);
  assert.deepEqual(allocated.map((entry) => entry.amountMinor), [4n, 3n, 3n]);
});

test("price resolution honours scope specificity and quantity tiers", () => {
  const global = basePriceList();
  const store = basePriceList({
    id: "018f2000-0000-7000-8000-000000000002",
    code: "STORE-GBP",
    name: "Store GBP",
    priority: 1,
    scope: { storeId: "store-1", channel: "pos" },
  });
  const resolved = resolvePrice(
    [global, store],
    [
      priceRule(global.id, 1_000n),
      priceRule(store.id, 950n),
      priceRule(store.id, 800n, 10n, { id: "018f2000-0000-7000-8000-000000000800", priority: 20, minimumMarginBasisPoints: 2_000n }),
    ],
    {
      variantId: VARIANT_ID,
      unitCode: "EA",
      quantityMinor: 12n,
      quantityScale: 0,
      currency: "GBP",
      scale: 2,
      storeId: "store-1",
      channel: "pos",
      at: "2026-07-28T00:00:00.000Z",
      cost: money(600n, "GBP", 2),
    },
  );
  assert.equal(resolved.priceListId, store.id);
  assert.equal(resolved.unitPrice.amountMinor, 800n);
  assert.equal(resolved.minimumAllowedPrice.amountMinor, 750n);
  assert.equal(resolved.scopeSpecificity, 6);
});

test("promotions enforce coupon, stacking group and exact allocation", () => {
  const context = {
    channel: "web",
    couponCodes: ["SAVE10"],
    at: "2026-07-28T00:00:00.000Z",
    lines: [
      { lineId: "line-1", variantId: "v1", categoryIds: ["shirts"], tags: ["summer"], quantityMinor: 1n, quantityScale: 0, unitPrice: money(1_000n, "GBP", 2) },
      { lineId: "line-2", variantId: "v2", categoryIds: ["shirts"], tags: ["summer"], quantityMinor: 1n, quantityScale: 0, unitPrice: money(500n, "GBP", 2) },
    ],
  };
  const result = evaluatePromotions([
    {
      id: "promo-10",
      code: "SAVE10",
      name: "Save 10%",
      status: "active",
      priority: 100,
      exclusive: false,
      stackingGroup: "cart-percent",
      conditions: [{ type: "coupon", codes: ["SAVE10"] }, { type: "minimum_subtotal", amount: money(1_000n, "GBP", 2) }],
      action: { type: "percentage", basisPoints: 1_000n },
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      version: 1n,
    },
    {
      id: "promo-5",
      code: "SAVE5",
      name: "Save 5%",
      status: "active",
      priority: 90,
      exclusive: false,
      stackingGroup: "cart-percent",
      conditions: [],
      action: { type: "percentage", basisPoints: 500n },
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      version: 1n,
    },
    {
      id: "promo-fixed",
      code: "FIXED1",
      name: "Fixed one pound",
      status: "active",
      priority: 80,
      exclusive: false,
      conditions: [{ type: "category", categoryIds: ["shirts"] }],
      action: { type: "fixed", amount: money(100n, "GBP", 2) },
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      version: 1n,
    },
  ], context);
  assert.equal(result.subtotal.amountMinor, 1_500n);
  assert.equal(result.discountTotal.amountMinor, 250n);
  assert.equal(result.total.amountMinor, 1_250n);
  assert.deepEqual(result.applied.map((entry) => entry.promotionCode), ["SAVE10", "FIXED1"]);
  assert.equal(result.applied[0].lineAllocations["line-1"].amountMinor + result.applied[0].lineAllocations["line-2"].amountMinor, 150n);
  assert.ok(result.rejected.some((entry) => entry.promotionId === "promo-5" && entry.reason === "stacking_group_already_applied"));
});

test("manual discounts require approval above threshold or below margin", () => {
  const pending = evaluateManualDiscount({
    currentPrice: money(1_000n, "GBP", 2),
    discount: money(200n, "GBP", 2),
    minimumAllowedPrice: money(850n, "GBP", 2),
    automaticApprovalLimitBasisPoints: 1_000n,
    approved: false,
    reason: "Customer recovery",
  });
  assert.equal(pending.allowed, false);
  assert.equal(pending.approvalRequired, true);
  assert.equal(pending.reason, "approval_required");
  const approved = evaluateManualDiscount({
    currentPrice: money(1_000n, "GBP", 2),
    discount: money(200n, "GBP", 2),
    minimumAllowedPrice: money(850n, "GBP", 2),
    automaticApprovalLimitBasisPoints: 1_000n,
    approved: true,
    reason: "Manager approved recovery",
  });
  assert.equal(approved.allowed, true);
  assert.equal(approved.resultingPrice.amountMinor, 800n);
});
