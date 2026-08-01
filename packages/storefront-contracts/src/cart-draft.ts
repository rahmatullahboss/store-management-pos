import { StorefrontContractError } from "./index.js";
import type { StorefrontCartQuantityV1 } from "./cart-checkout.js";

export interface StorefrontCartDraftItemV1 {
  readonly productId: string;
  readonly variantId: string;
  readonly quantity: StorefrontCartQuantityV1;
}

export interface StorefrontCartDraftV1 {
  readonly contractVersion: "storefront-cart-draft.v1";
  readonly revision: string;
  readonly lines: readonly StorefrontCartDraftItemV1[];
  readonly couponCodes: readonly string[];
  readonly destinationCountryCode: string | null;
  readonly updatedAt: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const UNIT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u;
const COUPON_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const COUNTRY_PATTERN = /^[A-Z]{2}$/u;
const DRAFT_KEYS = new Set([
  "contractVersion",
  "revision",
  "lines",
  "couponCodes",
  "destinationCountryCode",
  "updatedAt",
]);
const LINE_KEYS = new Set(["productId", "variantId", "quantity"]);
const QUANTITY_KEYS = new Set(["amount", "unit", "scale"]);

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

function boundedText(value: unknown, label: string, maximum: number): string {
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

function revision(value: unknown): string {
  const normalized = boundedText(value, "cartDraft.revision", 120);
  if (!INTEGER_PATTERN.test(normalized)) {
    throw new StorefrontContractError(
      "cartDraft.revision must be a non-negative integer string.",
    );
  }
  return normalized;
}

function instant(value: unknown): string {
  const normalized = boundedText(value, "cartDraft.updatedAt", 80);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new StorefrontContractError("cartDraft.updatedAt must be an ISO timestamp.");
  }
  return new Date(parsed).toISOString();
}

function quantity(value: unknown): StorefrontCartQuantityV1 {
  const source = asRecord(value, "cartDraft.quantity");
  strictKeys(source, QUANTITY_KEYS, "cartDraft.quantity");
  const amount = boundedText(source.amount, "cartDraft.quantity.amount", 120);
  if (!POSITIVE_INTEGER_PATTERN.test(amount)) {
    throw new StorefrontContractError(
      "cartDraft.quantity.amount must be a positive exact integer string.",
    );
  }
  const scale = source.scale;
  if (!Number.isInteger(scale) || (scale as number) < 0 || (scale as number) > 6) {
    throw new StorefrontContractError(
      "cartDraft.quantity.scale must be an integer between 0 and 6.",
    );
  }
  const unit = boundedText(source.unit, "cartDraft.quantity.unit", 32).toUpperCase();
  if (!UNIT_PATTERN.test(unit)) {
    throw new StorefrontContractError("cartDraft.quantity.unit is invalid.");
  }
  return Object.freeze({ amount, unit, scale: scale as number });
}

export function parseStorefrontCartDraftItemV1(
  value: unknown,
): StorefrontCartDraftItemV1 {
  const source = asRecord(value, "cartDraft.line");
  strictKeys(source, LINE_KEYS, "cartDraft.line");
  return Object.freeze({
    productId: uuid(source.productId, "cartDraft.line.productId"),
    variantId: uuid(source.variantId, "cartDraft.line.variantId"),
    quantity: quantity(source.quantity),
  });
}

function coupons(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new StorefrontContractError(
      "cartDraft.couponCodes must contain at most 8 entries.",
    );
  }
  const normalized = value.map((entry) => {
    const coupon = boundedText(entry, "cartDraft.couponCode", 64).toUpperCase();
    if (!COUPON_PATTERN.test(coupon)) {
      throw new StorefrontContractError("cartDraft.couponCode is invalid.");
    }
    return coupon;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new StorefrontContractError(
      "cartDraft.couponCodes cannot contain duplicates.",
    );
  }
  return Object.freeze(normalized);
}

function destinationCountry(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const country = boundedText(value, "cartDraft.destinationCountryCode", 2).toUpperCase();
  if (!COUNTRY_PATTERN.test(country)) {
    throw new StorefrontContractError(
      "cartDraft.destinationCountryCode must be an ISO-style alpha-2 code.",
    );
  }
  return country;
}

export function parseStorefrontCartDraftV1(value: unknown): StorefrontCartDraftV1 {
  const source = asRecord(value, "cartDraft");
  strictKeys(source, DRAFT_KEYS, "cartDraft");
  if (source.contractVersion !== "storefront-cart-draft.v1") {
    throw new StorefrontContractError("Unsupported storefront cart draft contract.");
  }
  if (!Array.isArray(source.lines) || source.lines.length > 100) {
    throw new StorefrontContractError(
      "cartDraft.lines must contain at most 100 entries.",
    );
  }
  const lines = source.lines.map(parseStorefrontCartDraftItemV1);
  const identities = lines.map((line) => `${line.productId}:${line.variantId}`);
  if (new Set(identities).size !== identities.length) {
    throw new StorefrontContractError(
      "cartDraft.lines cannot contain duplicate product variants.",
    );
  }
  return Object.freeze({
    contractVersion: "storefront-cart-draft.v1",
    revision: revision(source.revision),
    lines: Object.freeze(lines),
    couponCodes: coupons(source.couponCodes),
    destinationCountryCode: destinationCountry(source.destinationCountryCode),
    updatedAt: instant(source.updatedAt),
  });
}
