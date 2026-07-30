import {
  StorefrontContractError,
  parseStorefrontHostContextV1,
  parseStorefrontProductCardV1,
  type StorefrontHostContextV1,
  type StorefrontProductCardV1,
} from "./index.js";

export interface StorefrontAvailableQuantityV1 {
  readonly amount: string;
  readonly unit: string;
  readonly scale: number;
  readonly asOf: string;
  readonly version: string;
}

export interface StorefrontPublicVariantV1 {
  readonly variantId: string;
  readonly sku: string;
  readonly title: string;
  readonly unitCode: string;
  readonly availability: StorefrontProductCardV1["availability"];
  readonly price: StorefrontProductCardV1["price"];
  readonly compareAtPrice: StorefrontProductCardV1["compareAtPrice"];
  readonly quantity: StorefrontAvailableQuantityV1 | null;
}

export interface StorefrontPublicProductV1 {
  readonly summary: StorefrontProductCardV1;
  readonly code: string;
  readonly description: string | null;
  readonly kind: "stock" | "service" | "bundle" | "non_stock";
  readonly pricingNotice: "tax_calculated_at_checkout";
  readonly variants: readonly StorefrontPublicVariantV1[];
}

export interface StorefrontPublicCatalogPageV1 {
  readonly contractVersion: "storefront-public-catalog.v1";
  readonly context: StorefrontHostContextV1;
  readonly items: readonly StorefrontPublicProductV1[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface StorefrontPublicProductDetailV1 {
  readonly contractVersion: "storefront-public-product.v1";
  readonly context: StorefrontHostContextV1;
  readonly product: StorefrontPublicProductV1;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXACT_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;
const PRODUCT_KINDS = ["stock", "service", "bundle", "non_stock"] as const;
const AVAILABILITY = [
  "available",
  "limited",
  "unavailable",
  "preorder",
  "unknown",
] as const;

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function boundedText(
  value: unknown,
  label: string,
  maximum: number,
): string {
  if (typeof value !== "string") {
    throw new StorefrontContractError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return boundedText(value, label, maximum);
}

function uuid(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 36).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new StorefrontContractError(`${label} must be a UUID.`);
  }
  return normalized;
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new StorefrontContractError(`${label} is outside the supported range.`);
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

function exactQuantity(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 120);
  if (!EXACT_DECIMAL_PATTERN.test(normalized)) {
    throw new StorefrontContractError(
      `${label} must be an exact non-negative decimal string.`,
    );
  }
  return normalized;
}

function exactVersion(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 120);
  if (!INTEGER_PATTERN.test(normalized)) {
    throw new StorefrontContractError(
      `${label} must be a non-negative integer string.`,
    );
  }
  return normalized;
}

function instant(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 80);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new StorefrontContractError(`${label} must be an ISO timestamp.`);
  }
  return new Date(parsed).toISOString();
}

function token(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 200);
  if (!TOKEN_PATTERN.test(normalized)) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function parseQuantity(
  value: unknown,
  availability: StorefrontPublicVariantV1["availability"],
): StorefrontAvailableQuantityV1 | null {
  if (value === null || value === undefined) return null;
  const source = asRecord(value, "variant.quantity");
  const quantity = Object.freeze({
    amount: exactQuantity(source.amount, "variant.quantity.amount"),
    unit: token(source.unit, "variant.quantity.unit").toUpperCase(),
    scale: integer(source.scale, "variant.quantity.scale", 0, 18),
    asOf: instant(source.asOf, "variant.quantity.asOf"),
    version: exactVersion(source.version, "variant.quantity.version"),
  });
  if (
    availability !== "available" &&
    availability !== "limited" &&
    BigInt(quantity.amount.replace(".", "")) > 0n
  ) {
    throw new StorefrontContractError(
      "Unavailable, preorder and unknown variants cannot expose positive available quantity.",
    );
  }
  return quantity;
}

function parseVariant(
  value: unknown,
  context: StorefrontHostContextV1,
): StorefrontPublicVariantV1 {
  const source = asRecord(value, "variant");
  const availability = enumValue(
    source.availability,
    AVAILABILITY,
    "variant.availability",
  );
  const priceCard = parseStorefrontProductCardV1({
    contractVersion: "storefront-product-card.v1",
    productId: "00000000-0000-4000-8000-000000000000",
    variantId: uuid(source.variantId, "variant.variantId"),
    slug: "variant",
    name: "Variant",
    publicationState: "published",
    availability,
    pricePrefix: "none",
    price: source.price,
    compareAtPrice: source.compareAtPrice,
    media: null,
    badge: null,
  });
  if (
    priceCard.price.currency !== context.currency ||
    priceCard.compareAtPrice?.currency !== context.currency
  ) {
    throw new StorefrontContractError(
      "Variant price currency must match storefront context.",
    );
  }
  return Object.freeze({
    variantId: priceCard.variantId!,
    sku: boundedText(source.sku, "variant.sku", 160),
    title: boundedText(source.title, "variant.title", 240),
    unitCode: token(source.unitCode, "variant.unitCode").toUpperCase(),
    availability,
    price: priceCard.price,
    compareAtPrice: priceCard.compareAtPrice,
    quantity: parseQuantity(source.quantity, availability),
  });
}

function parseProduct(
  value: unknown,
  context: StorefrontHostContextV1,
): StorefrontPublicProductV1 {
  const source = asRecord(value, "product");
  const summary = parseStorefrontProductCardV1(source.summary);
  if (
    summary.price.currency !== context.currency ||
    summary.compareAtPrice?.currency !== context.currency
  ) {
    throw new StorefrontContractError(
      "Product price currency must match storefront context.",
    );
  }
  if (source.pricingNotice !== "tax_calculated_at_checkout") {
    throw new StorefrontContractError("Unsupported storefront pricing notice.");
  }
  if (!Array.isArray(source.variants) || source.variants.length === 0) {
    throw new StorefrontContractError(
      "Public products require at least one published priced variant.",
    );
  }
  if (source.variants.length > 100) {
    throw new StorefrontContractError(
      "Public product variant count is too large.",
    );
  }
  const variants = Object.freeze(
    source.variants.map((entry) => parseVariant(entry, context)),
  );
  if (
    summary.variantId !== null &&
    !variants.some((variant) => variant.variantId === summary.variantId)
  ) {
    throw new StorefrontContractError(
      "Product summary variant is not present in the public variant set.",
    );
  }
  return Object.freeze({
    summary,
    code: boundedText(source.code, "product.code", 160),
    description: optionalText(source.description, "product.description", 5_000),
    kind: enumValue(source.kind, PRODUCT_KINDS, "product.kind"),
    pricingNotice: "tax_calculated_at_checkout",
    variants,
  });
}

function parseCursor(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return uuid(value, "catalog.nextCursor");
}

export function parseStorefrontPublicCatalogPageV1(
  value: unknown,
): StorefrontPublicCatalogPageV1 {
  const source = asRecord(value, "catalog");
  if (source.contractVersion !== "storefront-public-catalog.v1") {
    throw new StorefrontContractError("Unsupported public catalog contract.");
  }
  const context = parseStorefrontHostContextV1(source.context);
  if (!Array.isArray(source.items) || source.items.length > 48) {
    throw new StorefrontContractError("Public catalog items are invalid.");
  }
  if (typeof source.hasMore !== "boolean") {
    throw new StorefrontContractError("catalog.hasMore must be boolean.");
  }
  const items = Object.freeze(
    source.items.map((entry) => parseProduct(entry, context)),
  );
  const nextCursor = parseCursor(source.nextCursor);
  if (source.hasMore !== (nextCursor !== null)) {
    throw new StorefrontContractError(
      "Catalog cursor and hasMore state are inconsistent.",
    );
  }
  return Object.freeze({
    contractVersion: "storefront-public-catalog.v1",
    context,
    items,
    nextCursor,
    hasMore: source.hasMore,
  });
}

export function parseStorefrontPublicProductDetailV1(
  value: unknown,
): StorefrontPublicProductDetailV1 {
  const source = asRecord(value, "productDetail");
  if (source.contractVersion !== "storefront-public-product.v1") {
    throw new StorefrontContractError("Unsupported public product contract.");
  }
  const context = parseStorefrontHostContextV1(source.context);
  return Object.freeze({
    contractVersion: "storefront-public-product.v1",
    context,
    product: parseProduct(source.product, context),
  });
}
