import {
  StorefrontContractError,
} from "./index.js";
import type {
  StorefrontCheckoutDestinationV1,
} from "./checkout-capabilities.js";

export interface StorefrontCheckoutSubmissionIntentV1 {
  readonly contractVersion: "storefront-checkout-submission-intent.v1";
  readonly quoteId: string;
  readonly quoteRevision: string;
  readonly cartRevision: string;
  readonly idempotencyKey: string;
  readonly destination: StorefrontCheckoutDestinationV1 | null;
  readonly countryPolicyRevision: string;
  readonly shippingOptionId: string;
  readonly shippingOptionVersion: string;
  readonly shippingRevision: string;
  readonly paymentCapabilityId: string;
  readonly paymentCapabilityVersion: string;
  readonly paymentRevision: string;
  readonly paymentMethodReference: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;
const COUNTRY_PATTERN = /^[A-Z]{2}$/u;
const REGION_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,31}$/u;
const REQUEST_KEYS = new Set([
  "contractVersion",
  "quoteId",
  "quoteRevision",
  "cartRevision",
  "idempotencyKey",
  "destination",
  "countryPolicyRevision",
  "shippingOptionId",
  "shippingOptionVersion",
  "shippingRevision",
  "paymentCapabilityId",
  "paymentCapabilityVersion",
  "paymentRevision",
  "paymentMethodReference",
]);
const DESTINATION_KEYS = new Set([
  "countryCode",
  "regionCode",
  "postalCode",
  "city",
]);

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

function optionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return boundedText(value, label, maximum);
}

function token(value: unknown, label: string, minimum = 1): string {
  const normalized = boundedText(value, label, 200);
  if (normalized.length < minimum || !TOKEN_PATTERN.test(normalized)) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return normalized;
}

function optionalToken(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return token(value, label);
}

function uuid(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 36).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new StorefrontContractError(`${label} must be a UUID.`);
  }
  return normalized;
}

function revision(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 120);
  if (!INTEGER_PATTERN.test(normalized)) {
    throw new StorefrontContractError(
      `${label} must be a non-negative integer string.`,
    );
  }
  return normalized;
}

function parseDestination(
  value: unknown,
): StorefrontCheckoutDestinationV1 | null {
  if (value === null || value === undefined) return null;
  const source = asRecord(value, "checkoutSubmission.destination");
  strictKeys(source, DESTINATION_KEYS, "checkoutSubmission.destination");
  const countryCode = boundedText(
    source.countryCode,
    "checkoutSubmission.destination.countryCode",
    2,
  ).toUpperCase();
  if (!COUNTRY_PATTERN.test(countryCode)) {
    throw new StorefrontContractError(
      "checkoutSubmission.destination.countryCode must be an ISO-style alpha-2 code.",
    );
  }
  const region = optionalText(
    source.regionCode,
    "checkoutSubmission.destination.regionCode",
    32,
  );
  const regionCode = region === null ? null : region.toUpperCase();
  if (regionCode !== null && !REGION_PATTERN.test(regionCode)) {
    throw new StorefrontContractError(
      "checkoutSubmission.destination.regionCode is invalid.",
    );
  }
  return Object.freeze({
    countryCode,
    regionCode,
    postalCode: optionalText(
      source.postalCode,
      "checkoutSubmission.destination.postalCode",
      40,
    ),
    city: optionalText(
      source.city,
      "checkoutSubmission.destination.city",
      120,
    ),
  });
}

export function parseStorefrontCheckoutSubmissionIntentV1(
  value: unknown,
): StorefrontCheckoutSubmissionIntentV1 {
  const source = asRecord(value, "checkoutSubmission");
  strictKeys(source, REQUEST_KEYS, "checkoutSubmission");
  if (source.contractVersion !== "storefront-checkout-submission-intent.v1") {
    throw new StorefrontContractError(
      "Unsupported storefront checkout submission intent contract.",
    );
  }
  return Object.freeze({
    contractVersion: "storefront-checkout-submission-intent.v1",
    quoteId: uuid(source.quoteId, "checkoutSubmission.quoteId"),
    quoteRevision: revision(
      source.quoteRevision,
      "checkoutSubmission.quoteRevision",
    ),
    cartRevision: revision(
      source.cartRevision,
      "checkoutSubmission.cartRevision",
    ),
    idempotencyKey: token(
      source.idempotencyKey,
      "checkoutSubmission.idempotencyKey",
      8,
    ),
    destination: parseDestination(source.destination),
    countryPolicyRevision: token(
      source.countryPolicyRevision,
      "checkoutSubmission.countryPolicyRevision",
    ),
    shippingOptionId: token(
      source.shippingOptionId,
      "checkoutSubmission.shippingOptionId",
    ),
    shippingOptionVersion: token(
      source.shippingOptionVersion,
      "checkoutSubmission.shippingOptionVersion",
    ),
    shippingRevision: token(
      source.shippingRevision,
      "checkoutSubmission.shippingRevision",
    ),
    paymentCapabilityId: token(
      source.paymentCapabilityId,
      "checkoutSubmission.paymentCapabilityId",
    ),
    paymentCapabilityVersion: token(
      source.paymentCapabilityVersion,
      "checkoutSubmission.paymentCapabilityVersion",
    ),
    paymentRevision: token(
      source.paymentRevision,
      "checkoutSubmission.paymentRevision",
    ),
    paymentMethodReference: optionalToken(
      source.paymentMethodReference,
      "checkoutSubmission.paymentMethodReference",
    ),
  });
}
