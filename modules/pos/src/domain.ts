import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { addMoney, compareMoney, money, multiplyMoney, subtractMoney, type Money } from "../../../packages/foundation/src/money.js";

export interface CartLine {
  readonly lineId: string;
  readonly variantId: string;
  readonly quantity: bigint;
  readonly unitPrice: Money;
  readonly discountTotal: Money;
  readonly taxTotal: Money;
}

export interface CartTotals {
  readonly gross: Money;
  readonly discount: Money;
  readonly tax: Money;
  readonly payable: Money;
}

export type TenderState = "accepted" | "authorized" | "captured" | "unknown" | "declined";

export interface CheckoutTender {
  readonly tenderId: string;
  readonly kind: "cash" | "external_card" | "stored_value";
  readonly amount: Money;
  readonly state: TenderState;
}

export interface CheckoutReadiness {
  readonly payable: Money;
  readonly tendered: Money;
  readonly ready: true;
}

export function calculateLineTotal(line: CartLine): Money {
  if (line.quantity <= 0n) throw new PlatformError("VALIDATION_FAILED", "Cart quantity must be positive", 400);
  if (line.discountTotal.amountMinor < 0n || line.taxTotal.amountMinor < 0n) {
    throw new PlatformError("VALIDATION_FAILED", "Discount and tax totals cannot be negative", 400);
  }

  const gross = multiplyMoney(line.unitPrice, line.quantity);
  if (compareMoney(line.discountTotal, gross) > 0) {
    throw new PlatformError("VALIDATION_FAILED", "Line discount cannot exceed the gross line amount", 400);
  }
  return addMoney(subtractMoney(gross, line.discountTotal), line.taxTotal);
}

export function calculateCartTotals(lines: readonly CartLine[], currency: string, scale = 2): CartTotals {
  let gross = money(0n, currency, scale);
  let discount = money(0n, currency, scale);
  let tax = money(0n, currency, scale);

  for (const line of lines) {
    const lineGross = multiplyMoney(line.unitPrice, line.quantity);
    calculateLineTotal(line);
    gross = addMoney(gross, lineGross);
    discount = addMoney(discount, line.discountTotal);
    tax = addMoney(tax, line.taxTotal);
  }

  return Object.freeze({ gross, discount, tax, payable: addMoney(subtractMoney(gross, discount), tax) });
}

export function assertCheckoutReady(payable: Money, tenders: readonly CheckoutTender[]): CheckoutReadiness {
  const unknown = tenders.find((tender) => tender.state === "unknown");
  if (unknown) {
    throw new PlatformError("CONFLICT", "Payment state is unknown; query provider status before retrying", 409, { tenderId: unknown.tenderId });
  }

  const unconfirmed = tenders.find((tender) => tender.state === "authorized");
  if (unconfirmed) {
    throw new PlatformError("CONFLICT", "Authorized payment is not yet confirmed for checkout completion", 409, { tenderId: unconfirmed.tenderId });
  }

  const declined = tenders.find((tender) => tender.state === "declined");
  if (declined) {
    throw new PlatformError("VALIDATION_FAILED", "Declined tender cannot complete checkout", 400, { tenderId: declined.tenderId });
  }

  let tendered = money(0n, payable.currency, payable.scale);
  for (const tender of tenders) tendered = addMoney(tendered, tender.amount);
  if (compareMoney(tendered, payable) !== 0) {
    throw new PlatformError("VALIDATION_FAILED", "Confirmed tender total must equal the checkout payable total", 400);
  }

  return Object.freeze({ payable, tendered, ready: true });
}
