import { addMoney, money, subtractMoney, type Money } from "../../../packages/foundation/src/index.js";
import { allocateMoneyExact, divideRounded, percentageOf, ratio, type Ratio } from "../../pricing/src/exact.js";
import { defineTaxCode, defineTaxRate, type TaxCalculation, type TaxCode, type TaxComponentResult, type TaxContext, type TaxExemption, type TaxRateComponent, type TaxTreatment } from "./model.js";

function effectiveAt(from: string, until: string | undefined, at: Date): boolean {
  return new Date(from) <= at && (until === undefined || new Date(until) > at);
}

function matchingExemption(exemptions: readonly TaxExemption[], context: TaxContext, at: Date): TaxExemption | undefined {
  return exemptions.find((exemption) => exemption.status === "active"
    && effectiveAt(exemption.validFrom, exemption.validUntil, at)
    && (exemption.customerId === undefined || exemption.customerId === context.customerId)
    && (exemption.customerGroupId === undefined || exemption.customerGroupId === context.customerGroupId)
    && (exemption.taxCodeId === undefined || exemption.taxCodeId === context.taxCodeId)
    && (exemption.jurisdictionId === undefined || exemption.jurisdictionId === context.jurisdictionId));
}

function addRatio(left: Ratio, right: Ratio): Ratio {
  return ratio(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator);
}

function multiplyRatio(left: Ratio, right: Ratio): Ratio {
  return ratio(left.numerator * right.numerator, left.denominator * right.denominator);
}

function grossFactor(rates: readonly TaxRateComponent[]): Ratio {
  let sumTaxFactors = ratio(0n, 1n);
  for (const rate of rates) {
    const baseFactor = rate.compound ? addRatio(ratio(1n, 1n), sumTaxFactors) : ratio(1n, 1n);
    const taxFactor = multiplyRatio(baseFactor, ratio(rate.rateBasisPoints, 10_000n));
    sumTaxFactors = addRatio(sumTaxFactors, taxFactor);
  }
  return addRatio(ratio(1n, 1n), sumTaxFactors);
}

function zeroCalculation(code: TaxCode, context: TaxContext, treatment: TaxTreatment, exemption?: TaxExemption): TaxCalculation {
  const amount = money(context.amountMinor, context.currency, context.scale);
  const zero = money(0n, context.currency, context.scale);
  return Object.freeze({
    sourceLineId: context.sourceLineId,
    taxCodeId: context.taxCodeId,
    jurisdictionId: context.jurisdictionId,
    treatment,
    priceMode: context.priceMode ?? code.priceMode,
    currency: amount.currency,
    scale: amount.scale,
    net: amount,
    tax: zero,
    gross: amount,
    components: Object.freeze([]),
    ...(exemption === undefined ? {} : { exemptionId: exemption.id }),
    calculationVersion: `tax-v1:${code.version.toString()}`,
    calculatedAt: new Date(context.at).toISOString(),
  });
}

function computeComponents(net: Money, rates: readonly TaxRateComponent[], code: TaxCode, treatment: TaxTreatment): readonly TaxComponentResult[] {
  let accumulated = money(0n, net.currency, net.scale);
  return Object.freeze(rates.map((rate) => {
    const taxableBase = rate.compound ? addMoney(net, accumulated) : net;
    const reportingTax = percentageOf(taxableBase, rate.rateBasisPoints, code.roundingMode);
    const chargedTax = treatment === "reverse_charge" ? money(0n, net.currency, net.scale) : reportingTax;
    const recoverableTax = percentageOf(reportingTax, rate.recoverableBasisPoints, code.roundingMode);
    accumulated = addMoney(accumulated, reportingTax);
    return Object.freeze({
      rateId: rate.id,
      code: rate.code,
      rateBasisPoints: rate.rateBasisPoints,
      compound: rate.compound,
      taxableBase,
      tax: chargedTax,
      recoverableTax,
      reportingTax,
    });
  }));
}

function reconcileInclusive(gross: Money, net: Money, components: readonly TaxComponentResult[]): readonly TaxComponentResult[] {
  if (components.length === 0) return components;
  const expectedTax = subtractMoney(gross, net);
  const actualTax = components.reduce((sum, component) => addMoney(sum, component.tax), money(0n, gross.currency, gross.scale));
  const delta = expectedTax.amountMinor - actualTax.amountMinor;
  if (delta === 0n) return components;
  const index = components.reduce((best, component, current) => component.tax.amountMinor > components[best]!.tax.amountMinor ? current : best, 0);
  return Object.freeze(components.map((component, current) => current === index ? Object.freeze({
    ...component,
    tax: money(component.tax.amountMinor + delta, gross.currency, gross.scale),
    reportingTax: money(component.reportingTax.amountMinor + delta, gross.currency, gross.scale),
  }) : component));
}

export function calculateTax(input: {
  readonly code: TaxCode;
  readonly rates: readonly TaxRateComponent[];
  readonly exemptions?: readonly TaxExemption[];
  readonly context: TaxContext;
}): TaxCalculation {
  const code = defineTaxCode(input.code);
  const at = new Date(input.context.at);
  if (Number.isNaN(at.valueOf())) throw new TypeError("Tax calculation instant is invalid");
  if (input.context.amountMinor < 0n) throw new RangeError("Tax amount cannot be negative");
  if (code.status !== "active") throw new RangeError("Tax code is not active");
  const exemption = matchingExemption(input.exemptions ?? [], input.context, at);
  const treatment = exemption === undefined ? (input.context.treatmentOverride ?? code.defaultTreatment) : "exempt";
  if (treatment === "exempt" || treatment === "zero_rated" || treatment === "out_of_scope") return zeroCalculation(code, input.context, treatment, exemption);

  const rates = input.rates
    .map(defineTaxRate)
    .filter((rate) => rate.taxCodeId === code.id && rate.jurisdictionId === input.context.jurisdictionId)
    .filter((rate) => effectiveAt(rate.effectiveFrom, rate.effectiveUntil, at))
    .sort((left, right) => left.priority - right.priority || left.code.localeCompare(right.code));
  if (rates.length === 0) throw new RangeError("No effective tax rate matched the request");
  const supplied = money(input.context.amountMinor, input.context.currency, input.context.scale);
  const priceMode = input.context.priceMode ?? code.priceMode;
  let net: Money;
  let gross: Money;
  let components: readonly TaxComponentResult[];
  if (priceMode === "exclusive") {
    net = supplied;
    components = computeComponents(net, rates, code, treatment);
    const charged = components.reduce((sum, component) => addMoney(sum, component.tax), money(0n, net.currency, net.scale));
    gross = addMoney(net, charged);
  } else {
    gross = supplied;
    if (treatment === "reverse_charge") {
      net = gross;
      components = computeComponents(net, rates, code, treatment);
    } else {
      const factor = grossFactor(rates);
      net = money(divideRounded(gross.amountMinor * factor.denominator, factor.numerator, code.roundingMode), gross.currency, gross.scale);
      components = reconcileInclusive(gross, net, computeComponents(net, rates, code, treatment));
    }
  }
  const tax = components.reduce((sum, component) => addMoney(sum, component.tax), money(0n, net.currency, net.scale));
  return Object.freeze({
    sourceLineId: input.context.sourceLineId,
    taxCodeId: code.id,
    jurisdictionId: input.context.jurisdictionId,
    treatment,
    priceMode,
    currency: net.currency,
    scale: net.scale,
    net,
    tax,
    gross,
    components,
    calculationVersion: `tax-v1:${code.version.toString()}:${rates.map((rate) => rate.version.toString()).join(".")}`,
    calculatedAt: at.toISOString(),
  });
}

export function allocateReturnTax(original: TaxCalculation, returnLineAmounts: readonly Money[]): readonly TaxCalculation[] {
  if (returnLineAmounts.length === 0) throw new TypeError("At least one return line amount is required");
  const weights = returnLineAmounts.map((amount) => {
    if (amount.currency !== original.gross.currency || amount.scale !== original.gross.scale) throw new TypeError("Return amount currency is incompatible");
    if (amount.amountMinor < 0n) throw new RangeError("Return amount cannot be negative");
    return amount.amountMinor;
  });
  const netAllocations = allocateMoneyExact(original.net, weights);
  const taxAllocations = allocateMoneyExact(original.tax, weights);
  return Object.freeze(returnLineAmounts.map((gross, index) => {
    const net = netAllocations[index]!;
    const tax = taxAllocations[index]!;
    return Object.freeze({
      ...original,
      sourceLineId: `${original.sourceLineId}:return:${index + 1}`,
      net,
      tax,
      gross,
      components: Object.freeze(original.components.map((component) => {
        const componentTax = allocateMoneyExact(component.tax, weights)[index]!;
        const reportingTax = allocateMoneyExact(component.reportingTax, weights)[index]!;
        const recoverableTax = allocateMoneyExact(component.recoverableTax, weights)[index]!;
        return Object.freeze({ ...component, taxableBase: net, tax: componentTax, reportingTax, recoverableTax });
      })),
      calculationVersion: `${original.calculationVersion}:return`,
    });
  }));
}
