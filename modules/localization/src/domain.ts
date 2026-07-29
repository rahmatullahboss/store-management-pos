import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { businessDate, locale, timeZone, type BusinessDate, type Locale, type TimeZone } from "../../../packages/foundation/src/localization.js";
import { money, type Money } from "../../../packages/foundation/src/money.js";
import type { BusinessDayBoundaryV1, CashRoundingMode, CurrencyMetadataV1, TextDirection } from "./contracts.js";

const rtlScripts = new Set(["Adlm", "Arab", "Hebr", "Mand", "Nkoo", "Rohg", "Samr", "Syrc", "Thaa"]);
const timePattern = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)(?::(?<second>[0-5]\d))?$/u;

function canonicalLocale(value: string): Locale {
  return locale(value.trim());
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function localeCandidates(value: Locale): readonly Locale[] {
  const parsed = new Intl.Locale(value);
  const candidates: string[] = [];
  appendUnique(candidates, value);
  appendUnique(candidates, locale(parsed.baseName));
  if (parsed.script) appendUnique(candidates, locale(`${parsed.language}-${parsed.script}`));
  appendUnique(candidates, locale(parsed.language));
  return candidates as readonly Locale[];
}

export function textDirection(value: string): TextDirection {
  const maximized = new Intl.Locale(canonicalLocale(value)).maximize();
  return maximized.script && rtlScripts.has(maximized.script) ? "rtl" : "ltr";
}

export function buildLocaleFallbackChain(
  requested: string,
  supported: readonly string[],
  defaultLocale: string,
): readonly Locale[] {
  const canonicalSupported = supported.map(canonicalLocale);
  const supportedSet = new Set<string>(canonicalSupported);
  const fallback = canonicalLocale(defaultLocale);
  if (!supportedSet.has(fallback)) {
    throw new PlatformError("VALIDATION_FAILED", "Default locale must be included in supported locales", 400);
  }

  const chain: Locale[] = [];
  for (const candidate of localeCandidates(canonicalLocale(requested))) {
    if (supportedSet.has(candidate) && !chain.includes(candidate)) chain.push(candidate);
  }
  if (!chain.includes(fallback)) chain.push(fallback);
  return Object.freeze(chain);
}

function assertMetadata(metadata: CurrencyMetadataV1): void {
  if (!/^[A-Z]{3}$/u.test(metadata.currency)) {
    throw new PlatformError("VALIDATION_FAILED", "Currency metadata must use an uppercase ISO currency code", 400);
  }
  if (!Number.isInteger(metadata.accountingScale) || metadata.accountingScale < 0 || metadata.accountingScale > 12) {
    throw new PlatformError("VALIDATION_FAILED", "Currency accounting scale must be between 0 and 12", 400);
  }
  if (!/^\d+$/u.test(metadata.cashIncrementMinor) || BigInt(metadata.cashIncrementMinor) <= 0n) {
    throw new PlatformError("VALIDATION_FAILED", "Cash rounding increment must be a positive integer string", 400);
  }
  businessDate(metadata.effectiveFrom);
  if (metadata.effectiveTo) {
    businessDate(metadata.effectiveTo);
    if (metadata.effectiveTo < metadata.effectiveFrom) {
      throw new PlatformError("VALIDATION_FAILED", "Currency metadata effective range is invalid", 400);
    }
  }
  if (metadata.metadataVersion.trim().length === 0) {
    throw new PlatformError("VALIDATION_FAILED", "Currency metadata version is required", 400);
  }
}

function roundedMagnitude(amount: bigint, increment: bigint, mode: CashRoundingMode): bigint {
  const quotient = amount / increment;
  const remainder = amount % increment;
  if (remainder === 0n) return amount;
  if (mode === "down") return quotient * increment;
  if (mode === "up") return (quotient + 1n) * increment;
  return (remainder * 2n >= increment ? quotient + 1n : quotient) * increment;
}

export function roundCashAmount(value: Money, metadata: CurrencyMetadataV1): Money {
  assertMetadata(metadata);
  if (value.currency !== metadata.currency || value.scale !== metadata.accountingScale) {
    throw new PlatformError("VALIDATION_FAILED", "Money and currency metadata are incompatible", 400);
  }
  const increment = BigInt(metadata.cashIncrementMinor);
  const sign = value.amountMinor < 0n ? -1n : 1n;
  const magnitude = value.amountMinor < 0n ? -value.amountMinor : value.amountMinor;
  return money(sign * roundedMagnitude(magnitude, increment, metadata.cashRoundingMode), value.currency, value.scale);
}

export function selectCurrencyMetadata(
  versions: readonly CurrencyMetadataV1[],
  currency: string,
  onDate: string,
): CurrencyMetadataV1 {
  const date = businessDate(onDate);
  const matches = versions.filter((metadata) => {
    assertMetadata(metadata);
    return metadata.currency === currency && metadata.effectiveFrom <= date && (!metadata.effectiveTo || metadata.effectiveTo >= date);
  });
  if (matches.length === 0) throw new PlatformError("NOT_FOUND", "No effective currency metadata version exists", 404);
  if (matches.length > 1) throw new PlatformError("CONFLICT", "Overlapping currency metadata versions are not allowed", 409);
  return Object.freeze({ ...matches[0] });
}

function parseBoundaryTime(value: string): number {
  const match = timePattern.exec(value);
  if (!match?.groups) throw new PlatformError("VALIDATION_FAILED", "Business-day boundary must use HH:mm or HH:mm:ss", 400);
  return Number(match.groups.hour) * 3_600 + Number(match.groups.minute) * 60 + Number(match.groups.second ?? "0");
}

function localParts(instant: Date, zone: TimeZone): { readonly date: BusinessDate; readonly secondOfDay: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = new Map(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  const second = values.get("second");
  if (!year || !month || !day || !hour || !minute || !second) throw new Error("Intl did not return complete local date parts");
  return {
    date: businessDate(`${year}-${month}-${day}`),
    secondOfDay: Number(hour) * 3_600 + Number(minute) * 60 + Number(second),
  };
}

function previousBusinessDate(value: BusinessDate): BusinessDate {
  const [yearText, monthText, dayText] = value.split("-");
  const instant = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText) - 1));
  return businessDate(instant.toISOString().slice(0, 10));
}

export function businessDateForInstant(instantValue: string | Date, boundary: BusinessDayBoundaryV1): BusinessDate {
  const zone = timeZone(boundary.timeZone);
  const instant = instantValue instanceof Date ? new Date(instantValue.getTime()) : new Date(instantValue);
  if (Number.isNaN(instant.getTime())) throw new PlatformError("VALIDATION_FAILED", "Instant must be a valid timestamp", 400);
  const boundarySecond = parseBoundaryTime(boundary.localStartTime);
  businessDate(boundary.effectiveFrom);
  if (boundary.effectiveTo) businessDate(boundary.effectiveTo);
  if (boundary.boundaryVersion.trim().length === 0) {
    throw new PlatformError("VALIDATION_FAILED", "Business-day boundary version is required", 400);
  }
  const local = localParts(instant, zone);
  return local.secondOfDay < boundarySecond ? previousBusinessDate(local.date) : local.date;
}

export function assertNonOverlappingEffectiveRanges<T extends { readonly effectiveFrom: string; readonly effectiveTo?: string }>(
  versions: readonly T[],
): void {
  const sorted = [...versions].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (!current) continue;
    businessDate(current.effectiveFrom);
    if (current.effectiveTo) businessDate(current.effectiveTo);
    const next = sorted[index + 1];
    if (next && (!current.effectiveTo || current.effectiveTo >= next.effectiveFrom)) {
      throw new PlatformError("CONFLICT", "Effective-dated versions overlap", 409);
    }
  }
}
