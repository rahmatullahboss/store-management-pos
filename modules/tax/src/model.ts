import { currencyCode, money, type CurrencyCode, type Money } from "../../../packages/foundation/src/index.js";
import type { RoundingMode } from "../../pricing/src/exact.js";

export type TaxTreatment = "standard" | "zero_rated" | "exempt" | "reverse_charge" | "out_of_scope";
export type TaxPriceMode = "exclusive" | "inclusive";

export interface TaxJurisdiction {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly countryCode: string;
  readonly parentId?: string;
  readonly priority: number;
  readonly status: "active" | "inactive";
}

export interface TaxCode {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly defaultTreatment: TaxTreatment;
  readonly priceMode: TaxPriceMode;
  readonly roundingMode: RoundingMode;
  readonly status: "active" | "inactive" | "retired";
  readonly version: bigint;
}

export interface TaxRateComponent {
  readonly id: string;
  readonly taxCodeId: string;
  readonly jurisdictionId: string;
  readonly code: string;
  readonly name: string;
  readonly rateBasisPoints: bigint;
  readonly compound: boolean;
  readonly recoverableBasisPoints: bigint;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly priority: number;
  readonly version: bigint;
}

export interface TaxExemption {
  readonly id: string;
  readonly customerId?: string;
  readonly customerGroupId?: string;
  readonly taxCodeId?: string;
  readonly jurisdictionId?: string;
  readonly certificateNumber: string;
  readonly reason: string;
  readonly validFrom: string;
  readonly validUntil?: string;
  readonly status: "active" | "revoked" | "expired";
}

export interface TaxContext {
  readonly taxCodeId: string;
  readonly jurisdictionId: string;
  readonly customerId?: string;
  readonly customerGroupId?: string;
  readonly currency: string;
  readonly scale: number;
  readonly amountMinor: bigint;
  readonly priceMode?: TaxPriceMode;
  readonly treatmentOverride?: TaxTreatment;
  readonly at: string;
  readonly quantityMinor?: bigint;
  readonly quantityScale?: number;
  readonly sourceLineId: string;
}

export interface TaxComponentResult {
  readonly rateId: string;
  readonly code: string;
  readonly rateBasisPoints: bigint;
  readonly compound: boolean;
  readonly taxableBase: Money;
  readonly tax: Money;
  readonly recoverableTax: Money;
  readonly reportingTax: Money;
}

export interface TaxCalculation {
  readonly sourceLineId: string;
  readonly taxCodeId: string;
  readonly jurisdictionId: string;
  readonly treatment: TaxTreatment;
  readonly priceMode: TaxPriceMode;
  readonly currency: CurrencyCode;
  readonly scale: number;
  readonly net: Money;
  readonly tax: Money;
  readonly gross: Money;
  readonly components: readonly TaxComponentResult[];
  readonly exemptionId?: string;
  readonly calculationVersion: string;
  readonly calculatedAt: string;
}

function validInstant(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError(`${field} is invalid`);
  return date.toISOString();
}

export function defineTaxCode(input: TaxCode): TaxCode {
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,63}$/.test(input.code.trim().toUpperCase())) throw new TypeError("Tax code is invalid");
  if (input.name.trim().length === 0 || input.name.length > 160) throw new TypeError("Tax code name is invalid");
  if (input.version <= 0n) throw new RangeError("Tax code version must be positive");
  return Object.freeze({ ...input, code: input.code.trim().toUpperCase(), name: input.name.trim() });
}

export function defineTaxRate(input: TaxRateComponent): TaxRateComponent {
  if (input.rateBasisPoints < 0n || input.rateBasisPoints > 10_000n) throw new RangeError("Tax rate must be between 0 and 10,000 basis points");
  if (input.recoverableBasisPoints < 0n || input.recoverableBasisPoints > 10_000n) throw new RangeError("Recoverable rate must be between 0 and 10,000 basis points");
  if (input.version <= 0n) throw new RangeError("Tax rate version must be positive");
  const effectiveFrom = validInstant(input.effectiveFrom, "Tax rate effectiveFrom");
  if (input.effectiveUntil !== undefined && new Date(input.effectiveUntil) <= new Date(effectiveFrom)) throw new TypeError("Tax rate effectiveUntil is invalid");
  return Object.freeze({
    ...input,
    code: input.code.trim().toUpperCase(),
    effectiveFrom,
    ...(input.effectiveUntil === undefined ? {} : { effectiveUntil: validInstant(input.effectiveUntil, "Tax rate effectiveUntil") }),
  });
}

export function taxMoney(amountMinor: bigint, currency: string, scale: number): Money {
  return money(amountMinor, currencyCode(currency), scale);
}
