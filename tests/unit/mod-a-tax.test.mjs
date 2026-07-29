import test from "node:test";
import assert from "node:assert/strict";
import { money } from "../../build/packages/foundation/src/money.js";
import { allocateReturnTax, calculateTax } from "../../build/modules/tax/src/calculator.js";

const TAX_CODE_ID = "018f3000-0000-7000-8000-000000000001";
const JURISDICTION_ID = "018f3000-0000-7000-8000-000000000002";

function taxCode(overrides = {}) {
  return {
    id: TAX_CODE_ID,
    code: "VAT-STANDARD",
    name: "Standard VAT",
    defaultTreatment: "standard",
    priceMode: "exclusive",
    roundingMode: "half_up",
    status: "active",
    version: 1n,
    ...overrides,
  };
}

function rate(overrides = {}) {
  return {
    id: "018f3000-0000-7000-8000-000000000003",
    taxCodeId: TAX_CODE_ID,
    jurisdictionId: JURISDICTION_ID,
    code: "VAT20",
    name: "VAT 20%",
    rateBasisPoints: 2_000n,
    compound: false,
    recoverableBasisPoints: 10_000n,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    priority: 10,
    version: 1n,
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    taxCodeId: TAX_CODE_ID,
    jurisdictionId: JURISDICTION_ID,
    currency: "GBP",
    scale: 2,
    amountMinor: 10_000n,
    at: "2026-07-28T00:00:00.000Z",
    sourceLineId: "line-1",
    ...overrides,
  };
}

test("exclusive and inclusive tax calculations reconcile exactly", () => {
  const exclusive = calculateTax({ code: taxCode(), rates: [rate()], context: context() });
  assert.equal(exclusive.net.amountMinor, 10_000n);
  assert.equal(exclusive.tax.amountMinor, 2_000n);
  assert.equal(exclusive.gross.amountMinor, 12_000n);
  assert.equal(exclusive.components[0].recoverableTax.amountMinor, 2_000n);

  const inclusive = calculateTax({
    code: taxCode({ priceMode: "inclusive" }),
    rates: [rate()],
    context: context({ amountMinor: 12_000n, priceMode: "inclusive" }),
  });
  assert.equal(inclusive.net.amountMinor, 10_000n);
  assert.equal(inclusive.tax.amountMinor, 2_000n);
  assert.equal(inclusive.gross.amountMinor, 12_000n);
  assert.equal(inclusive.net.amountMinor + inclusive.tax.amountMinor, inclusive.gross.amountMinor);
});

test("compound components calculate on prior reporting tax", () => {
  const result = calculateTax({
    code: taxCode(),
    rates: [
      rate({ id: "018f3000-0000-7000-8000-000000000010", code: "LEVY10", name: "Levy 10%", rateBasisPoints: 1_000n, priority: 10 }),
      rate({ id: "018f3000-0000-7000-8000-000000000011", code: "VAT5", name: "VAT 5% compound", rateBasisPoints: 500n, compound: true, priority: 20 }),
    ],
    context: context(),
  });
  assert.equal(result.components[0].tax.amountMinor, 1_000n);
  assert.equal(result.components[1].taxableBase.amountMinor, 11_000n);
  assert.equal(result.components[1].tax.amountMinor, 550n);
  assert.equal(result.tax.amountMinor, 1_550n);
  assert.equal(result.gross.amountMinor, 11_550n);
});

test("exempt, zero-rated and reverse-charge treatments preserve reporting semantics", () => {
  const exemption = {
    id: "018f3000-0000-7000-8000-000000000020",
    customerId: "customer-1",
    taxCodeId: TAX_CODE_ID,
    jurisdictionId: JURISDICTION_ID,
    certificateNumber: "CERT-001",
    reason: "Approved statutory exemption",
    validFrom: "2026-01-01T00:00:00.000Z",
    status: "active",
  };
  const exempt = calculateTax({ code: taxCode(), rates: [rate()], exemptions: [exemption], context: context({ customerId: "customer-1" }) });
  assert.equal(exempt.treatment, "exempt");
  assert.equal(exempt.exemptionId, exemption.id);
  assert.equal(exempt.tax.amountMinor, 0n);

  const zeroRated = calculateTax({ code: taxCode({ defaultTreatment: "zero_rated" }), rates: [rate()], context: context() });
  assert.equal(zeroRated.tax.amountMinor, 0n);
  assert.equal(zeroRated.gross.amountMinor, 10_000n);

  const reverse = calculateTax({ code: taxCode(), rates: [rate()], context: context({ treatmentOverride: "reverse_charge" }) });
  assert.equal(reverse.tax.amountMinor, 0n);
  assert.equal(reverse.gross.amountMinor, 10_000n);
  assert.equal(reverse.components[0].reportingTax.amountMinor, 2_000n);
  assert.equal(reverse.components[0].recoverableTax.amountMinor, 2_000n);
});

test("return tax allocation reconciles to the original snapshot", () => {
  const original = calculateTax({
    code: taxCode({ priceMode: "inclusive" }),
    rates: [rate()],
    context: context({ amountMinor: 12_000n, priceMode: "inclusive" }),
  });
  const returns = allocateReturnTax(original, [money(7_200n, "GBP", 2), money(4_800n, "GBP", 2)]);
  assert.equal(returns.reduce((sum, item) => sum + item.net.amountMinor, 0n), original.net.amountMinor);
  assert.equal(returns.reduce((sum, item) => sum + item.tax.amountMinor, 0n), original.tax.amountMinor);
  assert.equal(returns.reduce((sum, item) => sum + item.gross.amountMinor, 0n), original.gross.amountMinor);
  assert.equal(returns[0].net.amountMinor + returns[0].tax.amountMinor, returns[0].gross.amountMinor);
  assert.equal(returns[1].net.amountMinor + returns[1].tax.amountMinor, returns[1].gross.amountMinor);
});
