import { money, type Money } from "../../../packages/foundation/src/index.js";

export type RoundingMode = "half_up" | "half_even" | "floor" | "ceiling" | "toward_zero";

export interface Ratio {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export function ratio(numerator: bigint, denominator: bigint): Ratio {
  if (denominator <= 0n) throw new RangeError("Ratio denominator must be positive");
  return Object.freeze({ numerator, denominator });
}

function quotientWithRemainder(numerator: bigint, denominator: bigint): { quotient: bigint; remainder: bigint } {
  const quotient = numerator / denominator;
  return { quotient, remainder: numerator % denominator };
}

export function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator <= 0n) throw new RangeError("Denominator must be positive");
  const { quotient, remainder } = quotientWithRemainder(numerator, denominator);
  if (remainder === 0n) return quotient;
  const sign = numerator < 0n ? -1n : 1n;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  switch (mode) {
    case "toward_zero": return quotient;
    case "floor": return sign < 0n ? quotient - 1n : quotient;
    case "ceiling": return sign > 0n ? quotient + 1n : quotient;
    case "half_up": return absoluteRemainder * 2n >= denominator ? quotient + sign : quotient;
    case "half_even": {
      const doubled = absoluteRemainder * 2n;
      if (doubled > denominator) return quotient + sign;
      if (doubled < denominator) return quotient;
      return quotient % 2n === 0n ? quotient : quotient + sign;
    }
  }
}

export function multiplyMoneyByRatio(value: Money, valueRatio: Ratio, mode: RoundingMode): Money {
  return money(divideRounded(value.amountMinor * valueRatio.numerator, valueRatio.denominator, mode), value.currency, value.scale);
}

export function percentageRatio(basisPoints: bigint): Ratio {
  if (basisPoints < 0n || basisPoints > 10_000n) throw new RangeError("Percentage basis points must be between 0 and 10,000");
  return ratio(basisPoints, 10_000n);
}

export function percentageOf(value: Money, basisPoints: bigint, mode: RoundingMode): Money {
  return multiplyMoneyByRatio(value, percentageRatio(basisPoints), mode);
}

export function clampMoney(value: Money, minimum: Money, maximum: Money): Money {
  if (value.currency !== minimum.currency || value.currency !== maximum.currency || value.scale !== minimum.scale || value.scale !== maximum.scale) {
    throw new TypeError("Money clamp values are incompatible");
  }
  if (minimum.amountMinor > maximum.amountMinor) throw new RangeError("Money clamp minimum exceeds maximum");
  return value.amountMinor < minimum.amountMinor ? minimum : value.amountMinor > maximum.amountMinor ? maximum : value;
}

export interface CashRoundingResult {
  readonly original: Money;
  readonly rounded: Money;
  readonly adjustment: Money;
  readonly incrementMinor: bigint;
  readonly mode: RoundingMode;
}

export function roundMoneyToIncrement(value: Money, incrementMinor: bigint, mode: RoundingMode): CashRoundingResult {
  if (incrementMinor <= 0n) throw new RangeError("Cash rounding increment must be positive");
  const roundedAmount = divideRounded(value.amountMinor, incrementMinor, mode) * incrementMinor;
  return Object.freeze({
    original: value,
    rounded: money(roundedAmount, value.currency, value.scale),
    adjustment: money(roundedAmount - value.amountMinor, value.currency, value.scale),
    incrementMinor,
    mode,
  });
}

export function allocateMoneyExact(total: Money, weights: readonly bigint[]): readonly Money[] {
  if (weights.length === 0) throw new TypeError("At least one allocation weight is required");
  if (weights.some((weight) => weight < 0n)) throw new RangeError("Allocation weights cannot be negative");
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0n);
  if (weightTotal === 0n) throw new RangeError("Allocation weights cannot all be zero");
  const sign = total.amountMinor < 0n ? -1n : 1n;
  const absolute = total.amountMinor < 0n ? -total.amountMinor : total.amountMinor;
  const provisional = weights.map((weight, index) => {
    const product = absolute * weight;
    return { index, amount: product / weightTotal, remainder: product % weightTotal };
  });
  let remaining = absolute - provisional.reduce((sum, entry) => sum + entry.amount, 0n);
  const ranked = [...provisional].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (let index = 0; remaining > 0n; index += 1, remaining -= 1n) ranked[index % ranked.length]!.amount += 1n;
  return Object.freeze(provisional.sort((left, right) => left.index - right.index).map((entry) => money(entry.amount * sign, total.currency, total.scale)));
}
