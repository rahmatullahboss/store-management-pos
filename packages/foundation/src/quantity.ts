export type UnitCode = string & { readonly __brand: "UnitCode" };
export interface Quantity { readonly amount: bigint; readonly scale: number; readonly unit: UnitCode }

export function unitCode(value: string): UnitCode {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,31}$/.test(normalized)) throw new TypeError("Unit code is invalid");
  return normalized as UnitCode;
}

export function quantity(amount: bigint, unit: string, scale = 6): Quantity {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) throw new RangeError("Quantity scale must be between 0 and 18");
  return Object.freeze({ amount, scale, unit: unitCode(unit) });
}

export function addQuantity(left: Quantity, right: Quantity): Quantity {
  if (left.unit !== right.unit || left.scale !== right.scale) throw new TypeError("Quantity values use different units or scales");
  return quantity(left.amount + right.amount, left.unit, left.scale);
}
