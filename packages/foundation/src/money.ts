export type CurrencyCode = string & { readonly __brand: "CurrencyCode" };

export function currencyCode(value: string): CurrencyCode {
  const normalized = value.toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new TypeError("Currency must be a three-letter ISO code");
  return normalized as CurrencyCode;
}

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;
  readonly scale: number;
}

export function money(amountMinor: bigint, currency: string, scale = 2): Money {
  if (!Number.isInteger(scale) || scale < 0 || scale > 12) throw new RangeError("Money scale must be between 0 and 12");
  return Object.freeze({ amountMinor, currency: currencyCode(currency), scale });
}

export function addMoney(left: Money, right: Money): Money {
  assertCompatibleMoney(left, right);
  return money(left.amountMinor + right.amountMinor, left.currency, left.scale);
}

export function subtractMoney(left: Money, right: Money): Money {
  assertCompatibleMoney(left, right);
  return money(left.amountMinor - right.amountMinor, left.currency, left.scale);
}

export function multiplyMoney(value: Money, factor: bigint): Money {
  return money(value.amountMinor * factor, value.currency, value.scale);
}

export function compareMoney(left: Money, right: Money): -1 | 0 | 1 {
  assertCompatibleMoney(left, right);
  return left.amountMinor < right.amountMinor ? -1 : left.amountMinor > right.amountMinor ? 1 : 0;
}

export function formatMoneyExact(value: Money): string {
  const negative = value.amountMinor < 0n;
  const absolute = negative ? -value.amountMinor : value.amountMinor;
  const divisor = 10n ** BigInt(value.scale);
  const units = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(value.scale, "0");
  return `${negative ? "-" : ""}${units.toString()}${value.scale === 0 ? "" : `.${fraction}`} ${value.currency}`;
}

function assertCompatibleMoney(left: Money, right: Money): void {
  if (left.currency !== right.currency || left.scale !== right.scale) throw new TypeError("Money values use different currencies or scales");
}
