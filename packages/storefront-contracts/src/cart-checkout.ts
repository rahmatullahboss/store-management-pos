import {
  StorefrontContractError,
  parseStorefrontHostContextV1,
  parseStorefrontMoneyV1,
  type StorefrontCartQuoteV1,
  type StorefrontHostContextV1,
  type StorefrontMoneyV1,
  type StorefrontQuoteLineV1,
} from "./index.js";

export interface StorefrontCartQuantityV1 {
  readonly amount: string;
  readonly unit: string;
  readonly scale: number;
}

export interface StorefrontCartDraftLineV1 {
  readonly productId: string;
  readonly variantId: string;
  readonly quantity: StorefrontCartQuantityV1;
}

export interface StorefrontCartQuoteRequestV1 {
  readonly contractVersion: "storefront-cart-quote-request.v1";
  readonly cartRevision: string;
  readonly idempotencyKey: string;
  readonly lines: readonly StorefrontCartDraftLineV1[];
  readonly couponCodes: readonly string[];
  readonly destinationCountryCode: string | null;
  readonly customerId: string | null;
  readonly shippingOptionId: string | null;
}

export interface StorefrontCartQuoteInventoryEvidenceV1 {
  readonly variantId: string;
  readonly version: string;
}

export interface StorefrontCartQuoteAuthorityV1 {
  readonly priceListRevision: string;
  readonly publicationGeneration: string;
  readonly calculationIds: readonly string[];
  readonly inventoryVersions: readonly StorefrontCartQuoteInventoryEvidenceV1[];
}

export type StorefrontCartQuoteStateV1 = "ready" | "changed" | "unavailable";

export interface StorefrontCartQuoteEnvelopeV1 {
  readonly contractVersion: "storefront-cart-quote-envelope.v1";
  readonly context: StorefrontHostContextV1;
  readonly cartRevision: string;
  readonly state: StorefrontCartQuoteStateV1;
  readonly quote: StorefrontCartQuoteV1;
  readonly authority: StorefrontCartQuoteAuthorityV1;
  readonly changedLineIds: readonly string[];
  readonly unavailableLineIds: readonly string[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;
const EVIDENCE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:,+/-]{0,255}$/u;
const COUPON_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const COUNTRY_PATTERN = /^[A-Z]{2}$/u;
const REQUEST_KEYS = new Set([
  "contractVersion",
  "cartRevision",
  "idempotencyKey",
  "lines",
  "couponCodes",
  "destinationCountryCode",
  "customerId",
  "shippingOptionId",
]);
const LINE_KEYS = new Set(["productId", "variantId", "quantity"]);
const QUANTITY_KEYS = new Set(["amount", "unit", "scale"]);
const ENVELOPE_KEYS = new Set([
  "contractVersion",
  "context",
  "cartRevision",
  "state",
  "quote",
  "authority",
  "changedLineIds",
  "unavailableLineIds",
]);
const QUOTE_KEYS = new Set([
  "contractVersion",
  "quoteId",
  "quoteRevision",
  "expiresAt",
  "lines",
  "subtotal",
  "discount",
  "shipping",
  "tax",
  "total",
]);
const QUOTE_LINE_KEYS = new Set([
  "lineId",
  "productId",
  "variantId",
  "quantity",
  "unitPrice",
  "subtotal",
  "discount",
  "tax",
  "total",
]);
const AUTHORITY_KEYS = new Set([
  "priceListRevision",
  "publicationGeneration",
  "calculationIds",
  "inventoryVersions",
]);
const INVENTORY_EVIDENCE_KEYS = new Set(["variantId", "version"]);

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function strictKeys(
  source: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const unexpected = Object.keys(source).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new StorefrontContractError(
      `${label} contains unsupported fields: ${unexpected.sort().join(", ")}.`,
    );
  }
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

function uuid(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 36).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new StorefrontContractError(`${label} must be a UUID.`);
  }
  return normalized;
}

function integerVersion(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 120);
  if (!INTEGER_PATTERN.test(normalized)) {
    throw new StorefrontContractError(
      `${label} must be a non-negative integer string.`,
    );
  }
  return normalized;
}

function evidenceToken(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 256);
  if (!EVIDENCE_TOKEN_PATTERN.test(normalized)) {
    throw new StorefrontContractError(`${label} must be an opaque evidence token.`);
  }
  return normalized;
}

function positiveAmount(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 120);
  if (!POSITIVE_INTEGER_PATTERN.test(normalized)) {
    throw new StorefrontContractError(
      `${label} must be a positive exact integer string.`,
    );
  }
  return normalized;
}

function token(value: unknown, label: string, minimum = 1): string {
  const normalized = boundedText(value, label, 200);
  if (normalized.length < minimum || !TOKEN_PATTERN.test(normalized)) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return uuid(value, label);
}

function optionalToken(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return token(value, label);
}

function instant(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 80);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new StorefrontContractError(`${label} must be an ISO timestamp.`);
  }
  return new Date(parsed).toISOString();
}

function parseQuantity(value: unknown): StorefrontCartQuantityV1 {
  const source = asRecord(value, "cartLine.quantity");
  strictKeys(source, QUANTITY_KEYS, "cartLine.quantity");
  const scale = source.scale;
  if (!Number.isInteger(scale) || (scale as number) < 0 || (scale as number) > 6) {
    throw new StorefrontContractError(
      "cartLine.quantity.scale must be an integer between 0 and 6.",
    );
  }
  return Object.freeze({
    amount: positiveAmount(source.amount, "cartLine.quantity.amount"),
    unit: token(source.unit, "cartLine.quantity.unit").toUpperCase(),
    scale: scale as number,
  });
}

function parseDraftLine(value: unknown): StorefrontCartDraftLineV1 {
  const source = asRecord(value, "cartLine");
  strictKeys(source, LINE_KEYS, "cartLine");
  return Object.freeze({
    productId: uuid(source.productId, "cartLine.productId"),
    variantId: uuid(source.variantId, "cartLine.variantId"),
    quantity: parseQuantity(source.quantity),
  });
}

function parseCoupons(value: unknown): readonly string[] {
  if (value === null || value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 8) {
    throw new StorefrontContractError(
      "cartQuoteRequest.couponCodes must contain at most 8 entries.",
    );
  }
  const coupons = value.map((entry) => {
    const normalized = boundedText(entry, "cartQuoteRequest.couponCode", 64).toUpperCase();
    if (!COUPON_PATTERN.test(normalized)) {
      throw new StorefrontContractError("cartQuoteRequest.couponCode is invalid.");
    }
    return normalized;
  });
  if (new Set(coupons).size !== coupons.length) {
    throw new StorefrontContractError(
      "cartQuoteRequest.couponCodes cannot contain duplicates.",
    );
  }
  return Object.freeze(coupons);
}

function parseCountry(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = boundedText(
    value,
    "cartQuoteRequest.destinationCountryCode",
    2,
  ).toUpperCase();
  if (!COUNTRY_PATTERN.test(normalized)) {
    throw new StorefrontContractError(
      "cartQuoteRequest.destinationCountryCode must be an ISO-style alpha-2 code.",
    );
  }
  return normalized;
}

export function parseStorefrontCartQuoteRequestV1(
  value: unknown,
): StorefrontCartQuoteRequestV1 {
  const source = asRecord(value, "cartQuoteRequest");
  strictKeys(source, REQUEST_KEYS, "cartQuoteRequest");
  if (source.contractVersion !== "storefront-cart-quote-request.v1") {
    throw new StorefrontContractError("Unsupported cart quote request contract.");
  }
  if (!Array.isArray(source.lines) || source.lines.length < 1 || source.lines.length > 100) {
    throw new StorefrontContractError(
      "cartQuoteRequest.lines must contain between 1 and 100 entries.",
    );
  }
  const lines = source.lines.map(parseDraftLine);
  const logicalLines = lines.map((line) => `${line.productId}:${line.variantId}`);
  if (new Set(logicalLines).size !== logicalLines.length) {
    throw new StorefrontContractError(
      "cartQuoteRequest.lines cannot contain duplicate product variants.",
    );
  }
  return Object.freeze({
    contractVersion: "storefront-cart-quote-request.v1",
    cartRevision: integerVersion(
      source.cartRevision,
      "cartQuoteRequest.cartRevision",
    ),
    idempotencyKey: token(
      source.idempotencyKey,
      "cartQuoteRequest.idempotencyKey",
      8,
    ),
    lines: Object.freeze(lines),
    couponCodes: parseCoupons(source.couponCodes),
    destinationCountryCode: parseCountry(source.destinationCountryCode),
    customerId: optionalUuid(source.customerId, "cartQuoteRequest.customerId"),
    shippingOptionId: optionalToken(
      source.shippingOptionId,
      "cartQuoteRequest.shippingOptionId",
    ),
  });
}

function nonNegativeMoney(
  value: unknown,
  label: string,
  context: StorefrontHostContextV1,
  expectedScale?: number,
): StorefrontMoneyV1 {
  const money = parseStorefrontMoneyV1(value);
  if (BigInt(money.minor) < 0n) {
    throw new StorefrontContractError(`${label} cannot be negative.`);
  }
  if (money.currency !== context.currency) {
    throw new StorefrontContractError(
      `${label} currency must match storefront context.`,
    );
  }
  if (expectedScale !== undefined && money.scale !== expectedScale) {
    throw new StorefrontContractError(
      `${label} scale must match the quote currency scale.`,
    );
  }
  return money;
}

function parseQuoteLine(
  value: unknown,
  context: StorefrontHostContextV1,
  expectedScale: number,
): StorefrontQuoteLineV1 {
  const source = asRecord(value, "cartQuote.line");
  strictKeys(source, QUOTE_LINE_KEYS, "cartQuote.line");
  return Object.freeze({
    lineId: uuid(source.lineId, "cartQuote.line.lineId"),
    productId: uuid(source.productId, "cartQuote.line.productId"),
    variantId: uuid(source.variantId, "cartQuote.line.variantId"),
    quantity: positiveAmount(source.quantity, "cartQuote.line.quantity"),
    unitPrice: nonNegativeMoney(
      source.unitPrice,
      "cartQuote.line.unitPrice",
      context,
      expectedScale,
    ),
    subtotal: nonNegativeMoney(
      source.subtotal,
      "cartQuote.line.subtotal",
      context,
      expectedScale,
    ),
    discount: nonNegativeMoney(
      source.discount,
      "cartQuote.line.discount",
      context,
      expectedScale,
    ),
    tax: nonNegativeMoney(
      source.tax,
      "cartQuote.line.tax",
      context,
      expectedScale,
    ),
    total: nonNegativeMoney(
      source.total,
      "cartQuote.line.total",
      context,
      expectedScale,
    ),
  });
}

function parseQuote(
  value: unknown,
  context: StorefrontHostContextV1,
): StorefrontCartQuoteV1 {
  const source = asRecord(value, "cartQuote");
  strictKeys(source, QUOTE_KEYS, "cartQuote");
  if (source.contractVersion !== "storefront-cart-quote.v1") {
    throw new StorefrontContractError("Unsupported cart quote contract.");
  }
  const subtotal = nonNegativeMoney(source.subtotal, "cartQuote.subtotal", context);
  const expectedScale = subtotal.scale;
  if (!Array.isArray(source.lines) || source.lines.length < 1 || source.lines.length > 100) {
    throw new StorefrontContractError(
      "cartQuote.lines must contain between 1 and 100 entries.",
    );
  }
  const lines = source.lines.map((entry) =>
    parseQuoteLine(entry, context, expectedScale)
  );
  const lineIds = lines.map((line) => line.lineId);
  if (new Set(lineIds).size !== lineIds.length) {
    throw new StorefrontContractError("cartQuote line IDs must be unique.");
  }
  return Object.freeze({
    contractVersion: "storefront-cart-quote.v1",
    quoteId: uuid(source.quoteId, "cartQuote.quoteId"),
    quoteRevision: integerVersion(source.quoteRevision, "cartQuote.quoteRevision"),
    expiresAt: instant(source.expiresAt, "cartQuote.expiresAt"),
    lines: Object.freeze(lines),
    subtotal,
    discount: nonNegativeMoney(
      source.discount,
      "cartQuote.discount",
      context,
      expectedScale,
    ),
    shipping: nonNegativeMoney(
      source.shipping,
      "cartQuote.shipping",
      context,
      expectedScale,
    ),
    tax: nonNegativeMoney(source.tax, "cartQuote.tax", context, expectedScale),
    total: nonNegativeMoney(
      source.total,
      "cartQuote.total",
      context,
      expectedScale,
    ),
  });
}

function parseCalculationIds(value: unknown, expectedLength: number): readonly string[] {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new StorefrontContractError(
      "cartQuote.authority.calculationIds must contain one entry per quoted line.",
    );
  }
  const calculationIds = value.map((entry) =>
    token(entry, "cartQuote.authority.calculationId")
  );
  if (new Set(calculationIds).size !== calculationIds.length) {
    throw new StorefrontContractError(
      "cartQuote.authority.calculationIds must be unique.",
    );
  }
  return Object.freeze(calculationIds);
}

function parseInventoryVersions(
  value: unknown,
  quotedVariantIds: readonly string[],
): readonly StorefrontCartQuoteInventoryEvidenceV1[] {
  if (!Array.isArray(value) || value.length !== quotedVariantIds.length) {
    throw new StorefrontContractError(
      "cartQuote.authority.inventoryVersions must contain one entry per quoted line.",
    );
  }
  const entries = value.map((entry) => {
    const source = asRecord(entry, "cartQuote.authority.inventoryVersion");
    strictKeys(
      source,
      INVENTORY_EVIDENCE_KEYS,
      "cartQuote.authority.inventoryVersion",
    );
    return Object.freeze({
      variantId: uuid(
        source.variantId,
        "cartQuote.authority.inventoryVersion.variantId",
      ),
      version: evidenceToken(
        source.version,
        "cartQuote.authority.inventoryVersion.version",
      ),
    });
  });
  const variants = entries.map((entry) => entry.variantId);
  if (
    new Set(variants).size !== variants.length ||
    [...variants].sort().join(":") !== [...quotedVariantIds].sort().join(":")
  ) {
    throw new StorefrontContractError(
      "cartQuote.authority.inventoryVersions must match quoted variants exactly.",
    );
  }
  return Object.freeze(entries);
}

function parseLineIdList(
  value: unknown,
  label: string,
  quotedLineIds: ReadonlySet<string>,
): readonly string[] {
  if (!Array.isArray(value) || value.length > quotedLineIds.size) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  const ids = value.map((entry) => uuid(entry, label));
  if (new Set(ids).size !== ids.length || ids.some((id) => !quotedLineIds.has(id))) {
    throw new StorefrontContractError(`${label} must reference unique quoted lines.`);
  }
  return Object.freeze(ids);
}

export function parseStorefrontCartQuoteEnvelopeV1(
  value: unknown,
): StorefrontCartQuoteEnvelopeV1 {
  const source = asRecord(value, "cartQuoteEnvelope");
  strictKeys(source, ENVELOPE_KEYS, "cartQuoteEnvelope");
  if (source.contractVersion !== "storefront-cart-quote-envelope.v1") {
    throw new StorefrontContractError("Unsupported cart quote envelope contract.");
  }
  const context = parseStorefrontHostContextV1(source.context);
  const quote = parseQuote(source.quote, context);
  const quotedLineIds = new Set(quote.lines.map((line) => line.lineId));
  const changedLineIds = parseLineIdList(
    source.changedLineIds,
    "cartQuoteEnvelope.changedLineIds",
    quotedLineIds,
  );
  const unavailableLineIds = parseLineIdList(
    source.unavailableLineIds,
    "cartQuoteEnvelope.unavailableLineIds",
    quotedLineIds,
  );
  const state = source.state;
  if (state !== "ready" && state !== "changed" && state !== "unavailable") {
    throw new StorefrontContractError("cartQuoteEnvelope.state is unsupported.");
  }
  if (
    (state === "ready" && (changedLineIds.length > 0 || unavailableLineIds.length > 0)) ||
    (state === "changed" && changedLineIds.length === 0) ||
    (state === "unavailable" && unavailableLineIds.length === 0)
  ) {
    throw new StorefrontContractError(
      "cartQuoteEnvelope state does not match its line recovery markers.",
    );
  }

  const authoritySource = asRecord(source.authority, "cartQuote.authority");
  strictKeys(authoritySource, AUTHORITY_KEYS, "cartQuote.authority");
  const priceListRevision = token(
    authoritySource.priceListRevision,
    "cartQuote.authority.priceListRevision",
  );
  const publicationGeneration = token(
    authoritySource.publicationGeneration,
    "cartQuote.authority.publicationGeneration",
  );
  if (
    priceListRevision !== context.priceListRevision ||
    publicationGeneration !== context.publicationGeneration
  ) {
    throw new StorefrontContractError(
      "cartQuote authority revisions must match the resolved storefront context.",
    );
  }
  const authority = Object.freeze({
    priceListRevision,
    publicationGeneration,
    calculationIds: parseCalculationIds(
      authoritySource.calculationIds,
      quote.lines.length,
    ),
    inventoryVersions: parseInventoryVersions(
      authoritySource.inventoryVersions,
      quote.lines.map((line) => line.variantId),
    ),
  });

  return Object.freeze({
    contractVersion: "storefront-cart-quote-envelope.v1",
    context,
    cartRevision: integerVersion(
      source.cartRevision,
      "cartQuoteEnvelope.cartRevision",
    ),
    state,
    quote,
    authority,
    changedLineIds,
    unavailableLineIds,
  });
}
