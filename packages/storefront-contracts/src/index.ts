export class StorefrontContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StorefrontContractError";
  }
}

export type StorefrontPublicationStateV1 =
  | "draft"
  | "scheduled"
  | "published"
  | "hidden"
  | "archived";

export interface StorefrontMoneyV1 {
  readonly currency: string;
  readonly minor: string;
  readonly scale: number;
}

export interface StorefrontHostContextV1 {
  readonly tenantId: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly requestHostname: string;
  readonly canonicalHostname: string;
  readonly locale: string;
  readonly currency: string;
  readonly priceListRevision: string;
  readonly publicationGeneration: string;
}

export interface StorefrontBootstrapV1 {
  readonly contractVersion: "storefront-bootstrap.v1";
  readonly context: StorefrontHostContextV1;
  readonly themeRevision: string;
  readonly layoutRevision: string;
  readonly capabilities: readonly string[];
}

export interface StorefrontQuoteLineV1 {
  readonly lineId: string;
  readonly productId: string;
  readonly variantId: string;
  readonly quantity: string;
  readonly unitPrice: StorefrontMoneyV1;
  readonly subtotal: StorefrontMoneyV1;
  readonly discount: StorefrontMoneyV1;
  readonly tax: StorefrontMoneyV1;
  readonly total: StorefrontMoneyV1;
}

export interface StorefrontCartQuoteV1 {
  readonly contractVersion: "storefront-cart-quote.v1";
  readonly quoteId: string;
  readonly quoteRevision: string;
  readonly expiresAt: string;
  readonly lines: readonly StorefrontQuoteLineV1[];
  readonly subtotal: StorefrontMoneyV1;
  readonly discount: StorefrontMoneyV1;
  readonly shipping: StorefrontMoneyV1;
  readonly tax: StorefrontMoneyV1;
  readonly total: StorefrontMoneyV1;
}

const HOST_LABEL = /^(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CURRENCY = /^[A-Z]{3}$/;
const INTEGER_TEXT = /^-?(?:0|[1-9][0-9]*)$/;
const NON_EMPTY_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  source: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StorefrontContractError(`${label}.${key} must be a non-empty string.`);
  }
  return value.trim();
}

function requiredToken(
  source: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = requiredString(source, key, label);
  if (!NON_EMPTY_TOKEN.test(value)) {
    throw new StorefrontContractError(`${label}.${key} is not a valid token.`);
  }
  return value;
}

function requiredInteger(
  source: Record<string, unknown>,
  key: string,
  label: string,
): number {
  const value = source[key];
  if (!Number.isInteger(value)) {
    throw new StorefrontContractError(`${label}.${key} must be an integer.`);
  }
  return value as number;
}

function parseCapabilityList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new StorefrontContractError("bootstrap.capabilities must be an array.");
  }
  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !NON_EMPTY_TOKEN.test(item)) {
      throw new StorefrontContractError(
        "bootstrap.capabilities contains an invalid capability.",
      );
    }
    unique.add(item);
  }
  return Object.freeze([...unique]);
}

export function normalizeStorefrontHostname(value: string): string {
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname.includes(":") ||
    hostname.includes("/") ||
    hostname.includes("@")
  ) {
    throw new StorefrontContractError("Invalid storefront hostname.");
  }

  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some((label) => !HOST_LABEL.test(label))) {
    throw new StorefrontContractError("Invalid storefront hostname.");
  }
  return hostname;
}

export function parseStorefrontMoneyV1(value: unknown): StorefrontMoneyV1 {
  const source = asRecord(value, "money");
  const currency = requiredString(source, "currency", "money").toUpperCase();
  const minor = requiredString(source, "minor", "money");
  const scale = requiredInteger(source, "scale", "money");

  if (!CURRENCY.test(currency)) {
    throw new StorefrontContractError("money.currency must be an ISO-style code.");
  }
  if (!INTEGER_TEXT.test(minor)) {
    throw new StorefrontContractError("money.minor must be an integer string.");
  }
  if (scale < 0 || scale > 6) {
    throw new StorefrontContractError("money.scale is outside the supported range.");
  }

  return Object.freeze({ currency, minor, scale });
}

export function parseStorefrontHostContextV1(
  value: unknown,
): StorefrontHostContextV1 {
  const source = asRecord(value, "context");
  const currency = requiredString(source, "currency", "context").toUpperCase();
  if (!CURRENCY.test(currency)) {
    throw new StorefrontContractError("context.currency must be an ISO-style code.");
  }

  return Object.freeze({
    tenantId: requiredToken(source, "tenantId", "context"),
    storefrontId: requiredToken(source, "storefrontId", "context"),
    salesChannelId: requiredToken(source, "salesChannelId", "context"),
    requestHostname: normalizeStorefrontHostname(
      requiredString(source, "requestHostname", "context"),
    ),
    canonicalHostname: normalizeStorefrontHostname(
      requiredString(source, "canonicalHostname", "context"),
    ),
    locale: requiredString(source, "locale", "context"),
    currency,
    priceListRevision: requiredToken(source, "priceListRevision", "context"),
    publicationGeneration: requiredToken(
      source,
      "publicationGeneration",
      "context",
    ),
  });
}

export function parseStorefrontBootstrapV1(
  value: unknown,
): StorefrontBootstrapV1 {
  const source = asRecord(value, "bootstrap");
  const contractVersion = requiredString(
    source,
    "contractVersion",
    "bootstrap",
  );
  if (contractVersion !== "storefront-bootstrap.v1") {
    throw new StorefrontContractError("Unsupported storefront bootstrap contract.");
  }

  return Object.freeze({
    contractVersion,
    context: parseStorefrontHostContextV1(source.context),
    themeRevision: requiredToken(source, "themeRevision", "bootstrap"),
    layoutRevision: requiredToken(source, "layoutRevision", "bootstrap"),
    capabilities: parseCapabilityList(source.capabilities),
  });
}
