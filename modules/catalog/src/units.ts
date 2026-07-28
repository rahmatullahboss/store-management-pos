import { quantity, unitCode, type Quantity, type UnitCode } from "../../../packages/foundation/src/index.js";

export interface Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export interface UnitDefinition {
  readonly code: UnitCode;
  readonly name: string;
  readonly dimension: string;
  readonly decimalScale: number;
  readonly isBaseUnit: boolean;
}

export interface UnitConversionVersion {
  readonly id: string;
  readonly fromUnit: UnitCode;
  readonly toUnit: UnitCode;
  readonly factor: Rational;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly version: bigint;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

export function rational(numerator: bigint, denominator: bigint): Rational {
  if (denominator === 0n) throw new RangeError("Unit conversion denominator cannot be zero");
  const sign = denominator < 0n ? -1n : 1n;
  const normalizedNumerator = numerator * sign;
  const normalizedDenominator = denominator * sign;
  const divisor = greatestCommonDivisor(normalizedNumerator, normalizedDenominator);
  return Object.freeze({ numerator: normalizedNumerator / divisor, denominator: normalizedDenominator / divisor });
}

export function defineUnit(input: Omit<UnitDefinition, "code"> & { readonly code: string }): UnitDefinition {
  if (input.name.trim().length === 0 || input.name.length > 120) throw new TypeError("Unit name is invalid");
  if (!/^[a-z][a-z0-9._/-]{1,63}$/i.test(input.dimension)) throw new TypeError("Unit dimension is invalid");
  if (!Number.isInteger(input.decimalScale) || input.decimalScale < 0 || input.decimalScale > 18) throw new RangeError("Unit decimal scale is invalid");
  return Object.freeze({ ...input, code: unitCode(input.code), name: input.name.trim(), dimension: input.dimension.toLowerCase() });
}

export function defineUnitConversion(input: Omit<UnitConversionVersion, "fromUnit" | "toUnit" | "factor"> & {
  readonly fromUnit: string;
  readonly toUnit: string;
  readonly numerator: bigint;
  readonly denominator: bigint;
}): UnitConversionVersion {
  const fromUnit = unitCode(input.fromUnit);
  const toUnit = unitCode(input.toUnit);
  if (fromUnit === toUnit) throw new TypeError("A conversion must use different units");
  if (input.numerator <= 0n) throw new RangeError("Unit conversion factor must be positive");
  if (input.version <= 0n) throw new RangeError("Unit conversion version must be positive");
  const effectiveFrom = new Date(input.effectiveFrom);
  if (Number.isNaN(effectiveFrom.valueOf())) throw new TypeError("Conversion effectiveFrom is invalid");
  if (input.effectiveUntil !== undefined) {
    const effectiveUntil = new Date(input.effectiveUntil);
    if (Number.isNaN(effectiveUntil.valueOf()) || effectiveUntil <= effectiveFrom) throw new TypeError("Conversion effectiveUntil is invalid");
  }
  return Object.freeze({
    id: input.id,
    fromUnit,
    toUnit,
    factor: rational(input.numerator, input.denominator),
    effectiveFrom: effectiveFrom.toISOString(),
    ...(input.effectiveUntil === undefined ? {} : { effectiveUntil: new Date(input.effectiveUntil).toISOString() }),
    version: input.version,
  });
}

export function convertQuantityExact(value: Quantity, conversion: UnitConversionVersion, targetScale: number): Quantity {
  if (value.unit !== conversion.fromUnit) throw new TypeError("Quantity unit does not match conversion source");
  if (!Number.isInteger(targetScale) || targetScale < 0 || targetScale > 18) throw new RangeError("Target scale is invalid");
  const sourceScaleFactor = 10n ** BigInt(value.scale);
  const targetScaleFactor = 10n ** BigInt(targetScale);
  const numerator = value.amount * conversion.factor.numerator * targetScaleFactor;
  const denominator = conversion.factor.denominator * sourceScaleFactor;
  if (numerator % denominator !== 0n) throw new RangeError("Conversion cannot be represented exactly at the target scale");
  return quantity(numerator / denominator, conversion.toUnit, targetScale);
}

export function resolveEffectiveConversion(
  conversions: readonly UnitConversionVersion[],
  fromUnit: string,
  toUnit: string,
  at: string,
): UnitConversionVersion {
  const source = unitCode(fromUnit);
  const target = unitCode(toUnit);
  const instant = new Date(at);
  if (Number.isNaN(instant.valueOf())) throw new TypeError("Conversion instant is invalid");
  const candidates = conversions
    .filter((conversion) => conversion.fromUnit === source && conversion.toUnit === target)
    .filter((conversion) => new Date(conversion.effectiveFrom) <= instant)
    .filter((conversion) => conversion.effectiveUntil === undefined || new Date(conversion.effectiveUntil) > instant)
    .sort((left, right) => Number(right.version - left.version));
  const selected = candidates[0];
  if (!selected) throw new RangeError(`No effective conversion exists from ${source} to ${target}`);
  return selected;
}
