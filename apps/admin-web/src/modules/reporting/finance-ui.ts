export interface FinanceMoney {
  readonly amountMinor: string;
  readonly currency: string;
  readonly scale: number;
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function formatFinanceMoney(value: FinanceMoney, locale: string): string {
  if (!/^-?\d+$/u.test(value.amountMinor) || !Number.isInteger(value.scale) || value.scale < 0 || value.scale > 12) {
    throw new Error("Invalid finance money value");
  }
  const minor = BigInt(value.amountMinor);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const divisor = 10n ** BigInt(value.scale);
  const whole = absolute / divisor;
  const fraction = value.scale === 0 ? "" : (absolute % divisor).toString().padStart(value.scale, "0");
  const numeric = `${negative ? "-" : ""}${whole.toString()}${fraction ? `.${fraction}` : ""}`;
  const parsed = Number(numeric);
  if (whole <= BigInt(Number.MAX_SAFE_INTEGER) && Number.isFinite(parsed)) {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: value.currency,
      minimumFractionDigits: value.scale,
      maximumFractionDigits: value.scale,
    }).format(parsed);
  }
  return `${value.currency} ${numeric}`;
}

export function statusChip(label: string, tone: "success" | "warning" | "danger" | "neutral"): string {
  return `<span class="status-chip status-chip--${tone}"><span class="status-chip__dot" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

export function freshnessLabel(refreshedAt: string): string {
  return refreshedAt ? `Refreshed ${escapeHtml(refreshedAt)}` : "No refresh evidence";
}
