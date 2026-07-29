import type { StorefrontMoneyV1 } from "../../../packages/storefront-contracts/src/index.js";

function fallbackFormat(
  money: StorefrontMoneyV1,
  negative: boolean,
  integer: bigint,
  fraction: string,
): string {
  const amount =
    money.scale === 0 ? integer.toString() : `${integer.toString()}.${fraction}`;
  return `${money.currency} ${negative ? "-" : ""}${amount}`;
}

export function formatStorefrontMoneyV1(
  money: StorefrontMoneyV1,
  locale: string,
): string {
  const minor = BigInt(money.minor);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const divisor = 10n ** BigInt(money.scale);
  const integer = absolute / divisor;
  const fraction =
    money.scale === 0
      ? ""
      : (absolute % divisor).toString().padStart(money.scale, "0");

  try {
    const groupedInteger = new Intl.NumberFormat(locale, {
      useGrouping: true,
      maximumFractionDigits: 0,
    }).format(integer);
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: money.currency,
      currencyDisplay: "symbol",
      useGrouping: true,
      minimumFractionDigits: money.scale,
      maximumFractionDigits: money.scale,
    });
    let integerInserted = false;
    return formatter
      .formatToParts(negative ? -1 : 1)
      .map((part) => {
        switch (part.type) {
          case "integer":
            if (integerInserted) return "";
            integerInserted = true;
            return groupedInteger;
          case "fraction":
            return fraction;
          case "minusSign":
            return negative ? part.value : "";
          case "plusSign":
          case "group":
            return "";
          default:
            return part.value;
        }
      })
      .join("");
  } catch {
    return fallbackFormat(money, negative, integer, fraction);
  }
}
