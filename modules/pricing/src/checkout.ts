import { money, type Money } from "../../../packages/foundation/src/index.js";
import type { PriceTaxSnapshot } from "./price-tax.js";

export interface CheckoutPriceTaxLine {
  readonly snapshotId: string;
  readonly calculationHash: string;
  readonly sourceLineId: string;
  readonly variantId: string;
  readonly quantityMinor: bigint;
  readonly quantityScale: number;
  readonly subtotal: Money;
  readonly discount: Money;
  readonly net: Money;
  readonly tax: Money;
  readonly gross: Money;
  readonly priceListVersion: bigint;
  readonly priceRuleVersion: bigint;
  readonly taxCalculationVersion: string;
}

export function checkoutLineFromPriceTaxSnapshot(snapshot: PriceTaxSnapshot): CheckoutPriceTaxLine {
  if (snapshot.subtotalMinor - snapshot.discountMinor !== snapshot.promotedAmountMinor) {
    throw new RangeError("Price-tax snapshot promotion totals do not reconcile");
  }
  if (snapshot.netMinor + snapshot.taxMinor !== snapshot.grossMinor) {
    throw new RangeError("Price-tax snapshot tax totals do not reconcile");
  }
  if (snapshot.taxPriceMode === "exclusive" && snapshot.promotedAmountMinor !== snapshot.netMinor) {
    throw new RangeError("Exclusive price-tax snapshot promoted amount must equal net");
  }
  if (snapshot.taxPriceMode === "inclusive" && snapshot.promotedAmountMinor !== snapshot.grossMinor) {
    throw new RangeError("Inclusive price-tax snapshot promoted amount must equal gross");
  }
  return Object.freeze({
    snapshotId: snapshot.snapshotId,
    calculationHash: snapshot.calculationHash,
    sourceLineId: snapshot.sourceLineId,
    variantId: snapshot.variantId,
    quantityMinor: snapshot.quantityMinor,
    quantityScale: snapshot.quantityScale,
    subtotal: money(snapshot.subtotalMinor, snapshot.currency, snapshot.moneyScale),
    discount: money(snapshot.discountMinor, snapshot.currency, snapshot.moneyScale),
    net: money(snapshot.netMinor, snapshot.currency, snapshot.moneyScale),
    tax: money(snapshot.taxMinor, snapshot.currency, snapshot.moneyScale),
    gross: money(snapshot.grossMinor, snapshot.currency, snapshot.moneyScale),
    priceListVersion: snapshot.priceListVersion,
    priceRuleVersion: snapshot.priceRuleVersion,
    taxCalculationVersion: snapshot.taxCalculationVersion,
  });
}
