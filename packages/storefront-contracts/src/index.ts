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

export type StorefrontAvailabilityV1 =
  | "available"
  | "limited"
  | "unavailable"
  | "preorder"
  | "unknown";

export type StorefrontPricePrefixV1 = "none" | "from";

export interface StorefrontProductMediaV1 {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

export interface StorefrontProductCardV1 {
  readonly contractVersion: "storefront-product-card.v1";
  readonly productId: string;
  readonly variantId: string | null;
  readonly slug: string;
  readonly name: string;
  readonly publicationState: "published";
  readonly availability: StorefrontAvailabilityV1;
  readonly pricePrefix: StorefrontPricePrefixV1;
  readonly price: StorefrontMoneyV1;
  readonly compareAtPrice: StorefrontMoneyV1 | null;
  readonly media: StorefrontProductMediaV1 | null;
  readonly badge: string | null;
}

const HOST_LABEL = /^(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CURRENCY = /^[A-Z]{3}$/;
const INTEGER_TEXT = /^-?(?:0|[1-9][0-9]*)$/;
const NON_EMPTY_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const AVAILABILITY_VALUES: readonly StorefrontAvailabilityV1[] = [
  "available",
  "limited",
  "unavailable",
  "preorder",
  "unknown",
];
const PRICE_PREFIX_VALUES: readonly StorefrontPricePrefixV1[] = ["none", "from"];

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
    throw new StorefrontContractError(
      `${label}.${key} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function boundedText(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  if (typeof value !== "string") {
    throw new StorefrontContractError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximumLength ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function optionalBoundedText(
  value: unknown,
  label: string,
  maximumLength: number,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return boundedText(value, label, maximumLength);
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

function optionalToken(
  source: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = source[key];
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !NON_EMPTY_TOKEN.test(value)) {
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

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new StorefrontContractError(`${label} is unsupported.`);
  }
  return value as T;
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

function parseProductSlug(value: unknown): string {
  const slug = boundedText(value, "productCard.slug", 180);
  if (
    /[\s/\\?#]/u.test(slug) ||
    slug === "." ||
    slug === ".." ||
    slug.startsWith(".")
  ) {
    throw new StorefrontContractError("productCard.slug is invalid.");
  }
  return slug;
}

function parseMediaSource(value: unknown): string {
  const source = boundedText(value, "productCard.media.src", 2_048);
  if (source.startsWith("/") && !source.startsWith("//")) {
    if (source.includes("\\") || source.includes("#")) {
      throw new StorefrontContractError("productCard.media.src is invalid.");
    }
    return source;
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new StorefrontContractError("productCard.media.src is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    throw new StorefrontContractError("productCard.media.src is invalid.");
  }
  return url.toString();
}

function parseProductMedia(
  value: unknown,
  productName: string,
): StorefrontProductMediaV1 | null {
  if (value === null || value === undefined) return null;
  const source = asRecord(value, "productCard.media");
  const width = requiredInteger(source, "width", "productCard.media");
  const height = requiredInteger(source, "height", "productCard.media");
  if (width < 1 || width > 8_192 || height < 1 || height > 8_192) {
    throw new StorefrontContractError(
      "productCard.media dimensions are unsupported.",
    );
  }
  return Object.freeze({
    src: parseMediaSource(source.src),
    alt:
      optionalBoundedText(source.alt, "productCard.media.alt", 300) ??
      productName,
    width,
    height,
  });
}

function assertNonNegativePrice(
  money: StorefrontMoneyV1,
  label: string,
): void {
  if (BigInt(money.minor) < 0n) {
    throw new StorefrontContractError(`${label} cannot be negative.`);
  }
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
    throw new StorefrontContractError(
      "context.currency must be an ISO-style code.",
    );
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

export function parseStorefrontProductCardV1(
  value: unknown,
): StorefrontProductCardV1 {
  const source = asRecord(value, "productCard");
  const contractVersion = requiredString(
    source,
    "contractVersion",
    "productCard",
  );
  if (contractVersion !== "storefront-product-card.v1") {
    throw new StorefrontContractError(
      "Unsupported storefront product-card contract.",
    );
  }
  if (source.publicationState !== "published") {
    throw new StorefrontContractError(
      "Only published products can enter the public card contract.",
    );
  }

  const name = boundedText(source.name, "productCard.name", 240);
  const price = parseStorefrontMoneyV1(source.price);
  assertNonNegativePrice(price, "productCard.price");
  const compareAtPrice =
    source.compareAtPrice === null || source.compareAtPrice === undefined
      ? null
      : parseStorefrontMoneyV1(source.compareAtPrice);
  if (compareAtPrice) {
    assertNonNegativePrice(compareAtPrice, "productCard.compareAtPrice");
    if (
      compareAtPrice.currency !== price.currency ||
      compareAtPrice.scale !== price.scale
    ) {
      throw new StorefrontContractError(
        "productCard compare-at price must match price currency and scale.",
      );
    }
  }

  return Object.freeze({
    contractVersion,
    productId: requiredToken(source, "productId", "productCard"),
    variantId: optionalToken(source, "variantId", "productCard"),
    slug: parseProductSlug(source.slug),
    name,
    publicationState: "published",
    availability: enumValue(
      source.availability,
      AVAILABILITY_VALUES,
      "productCard.availability",
    ),
    pricePrefix: enumValue(
      source.pricePrefix,
      PRICE_PREFIX_VALUES,
      "productCard.pricePrefix",
    ),
    price,
    compareAtPrice,
    media: parseProductMedia(source.media, name),
    badge: optionalBoundedText(source.badge, "productCard.badge", 80),
  });
}
