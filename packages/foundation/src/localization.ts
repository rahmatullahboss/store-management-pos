export type Locale = string & { readonly __brand: "Locale" };
export type TimeZone = string & { readonly __brand: "TimeZone" };
export type BusinessDate = string & { readonly __brand: "BusinessDate" };

export function locale(value: string): Locale {
  try {
    return Intl.getCanonicalLocales(value)[0] as Locale;
  } catch {
    throw new TypeError("Locale must be a valid BCP 47 identifier");
  }
}

export function timeZone(value: string): TimeZone {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return value as TimeZone;
  } catch {
    throw new TypeError("Timezone must be a valid IANA identifier");
  }
}

export function businessDate(value: string): BusinessDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError("Business date must use YYYY-MM-DD");
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new TypeError("Business date is invalid");
  return value as BusinessDate;
}
