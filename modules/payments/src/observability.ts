const RESTRICTED_FIELD = /^(?:authorization|card|card_number|cardnumber|cvv|cvc|pan|password|secret|token|access_token|refresh_token|payment_method_token)$/iu;

function redact(value: unknown, key?: string): unknown {
  if (key && RESTRICTED_FIELD.test(key.replaceAll(/[-\s]/gu, "_"))) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
  }
  return value;
}

export function safePaymentDiagnosticFields(fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze(redact(fields) as Record<string, unknown>);
}
