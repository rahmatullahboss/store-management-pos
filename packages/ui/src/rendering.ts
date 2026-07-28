export interface DisplayMoney { readonly amountMinor: bigint; readonly currency: string; readonly scale: number }
export interface DisplayQuantity { readonly amount: bigint; readonly unit: string; readonly scale: number }

function exactDecimal(amount: bigint, scale: number): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const divisor = 10n ** BigInt(scale);
  const units = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(scale, "0");
  return `${negative ? "-" : ""}${units.toString()}${scale === 0 ? "" : `.${fraction}`}`;
}

export function renderMoney(value: DisplayMoney, locale: string): string {
  const decimal = exactDecimal(value.amountMinor, value.scale);
  const numeric = Number(decimal);
  if (Number.isSafeInteger(value.amountMinor) && Number.isFinite(numeric)) return new Intl.NumberFormat(locale, { style: "currency", currency: value.currency, minimumFractionDigits: value.scale, maximumFractionDigits: value.scale }).format(numeric);
  return `${decimal} ${value.currency}`;
}

export function renderQuantity(value: DisplayQuantity): string { return `${exactDecimal(value.amount, value.scale)} ${value.unit}`; }
export function renderDateTime(value: string | Date, locale: string, timeZone: string): string { return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value)); }
export function renderStatus(status: string): string { return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
