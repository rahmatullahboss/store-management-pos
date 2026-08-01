import {
  StorefrontContractError,
  parseStorefrontHostContextV1,
  parseStorefrontMoneyV1,
  type StorefrontHostContextV1,
  type StorefrontMoneyV1,
} from "./index.js";

export interface StorefrontCheckoutDestinationV1 {
  readonly countryCode: string;
  readonly regionCode: string | null;
  readonly postalCode: string | null;
  readonly city: string | null;
}

export interface StorefrontCheckoutCapabilityRequestV1 {
  readonly contractVersion: "storefront-checkout-capability-request.v1";
  readonly quoteId: string;
  readonly quoteRevision: string;
  readonly cartRevision: string;
  readonly destination: StorefrontCheckoutDestinationV1 | null;
  readonly shippingOptionId: string | null;
  readonly paymentCapabilityId: string | null;
}

export type StorefrontShippingMethodV1 =
  | "pickup"
  | "local_delivery"
  | "ship_from_store";

export interface StorefrontShippingOptionV1 {
  readonly optionId: string;
  readonly method: StorefrontShippingMethodV1;
  readonly label: string;
  readonly amount: StorefrontMoneyV1;
  readonly expiresAt: string;
  readonly version: string;
}

export interface StorefrontPaymentCapabilityV1 {
  readonly capabilityId: string;
  readonly providerCapability: string;
  readonly kind: string;
  readonly label: string;
  readonly requiresAction: boolean;
  readonly expiresAt: string | null;
  readonly version: string;
}

export type StorefrontCheckoutCapabilityStateV1 =
  | "ready"
  | "changed"
  | "unavailable";

export type StorefrontCheckoutChangeReasonV1 =
  | "quote"
  | "price_tax"
  | "inventory"
  | "country_policy"
  | "shipping"
  | "payment";

export interface StorefrontCheckoutCapabilityAuthorityV1 {
  readonly quoteAuthorityToken: string;
  readonly countryPolicyRevision: string;
  readonly shippingRevision: string;
  readonly paymentRevision: string;
}

export interface StorefrontCheckoutCapabilityEnvelopeV1 {
  readonly contractVersion: "storefront-checkout-capability-envelope.v1";
  readonly context: StorefrontHostContextV1;
  readonly quoteId: string;
  readonly quoteRevision: string;
  readonly quoteExpiresAt: string;
  readonly state: StorefrontCheckoutCapabilityStateV1;
  readonly shippingOptions: readonly StorefrontShippingOptionV1[];
  readonly paymentCapabilities: readonly StorefrontPaymentCapabilityV1[];
  readonly authority: StorefrontCheckoutCapabilityAuthorityV1;
  readonly changedReasons: readonly StorefrontCheckoutChangeReasonV1[];
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
  "destination",
  "shippingOptionId",
  "paymentCapabilityId",
]);
const DESTINATION_KEYS = new Set([
  "countryCode",
  "regionCode",
  "postalCode",
  "city",
]);
const ENVELOPE_KEYS = new Set([
  "contractVersion",
  "context",
  "quoteId",
  "quoteRevision",
  "quoteExpiresAt",
  "state",
  "shippingOptions",
  "paymentCapabilities",
  "authority",
  "changedReasons",
]);
const SHIPPING_KEYS = new Set([
  "optionId",
  "method",
  "label",
  "amount",
  "expiresAt",
  "version",
]);
const PAYMENT_KEYS = new Set([
  "capabilityId",
  "providerCapability",
  "kind",
  "label",
  "requiresAction",
  "expiresAt",
  "version",
]);
const AUTHORITY_KEYS = new Set([
  "quoteAuthorityToken",
  "countryPolicyRevision",
  "shippingRevision",
  "paymentRevision",
]);
const SHIPPING_METHODS: readonly StorefrontShippingMethodV1[] = [
  "pickup",
  "local_delivery",
  "ship_from_store",
];
const STATES: readonly StorefrontCheckoutCapabilityStateV1[] = [
  "ready",
  "changed",
  "unavailable",
];
const CHANGE_REASONS: readonly StorefrontCheckoutChangeReasonV1[] = [
  "quote",
  "price_tax",
  "inventory",
  "country_policy",
  "shipping",
  "payment",
];

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

function optionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return boundedText(value, label, maximum);
}

function token(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 200);
  if (!TOKEN_PATTERN.test(normalized)) {
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

function instant(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 80);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new StorefrontContractError(`${label} must be an ISO timestamp.`);
  }
  return new Date(parsed).toISOString();
}

function optionalInstant(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return instant(value, label);
}

function parseDestination(value: unknown): StorefrontCheckoutDestinationV1 | null {
  if (value === null || value === undefined) return null;
  const source = asRecord(value, "checkoutCapabilityRequest.destination");
  strictKeys(source, DESTINATION_KEYS, "checkoutCapabilityRequest.destination");
  const countryCode = boundedText(
    source.countryCode,
    "checkoutCapabilityRequest.destination.countryCode",
    2,
  ).toUpperCase();
  if (!COUNTRY_PATTERN.test(countryCode)) {
    throw new StorefrontContractError(
      "checkoutCapabilityRequest.destination.countryCode must be an ISO-style alpha-2 code.",
    );
  }
  const region = optionalText(
    source.regionCode,
    "checkoutCapabilityRequest.destination.regionCode",
    32,
  );
  const regionCode = region === null ? null : region.toUpperCase();
  if (regionCode !== null && !REGION_PATTERN.test(regionCode)) {
    throw new StorefrontContractError(
      "checkoutCapabilityRequest.destination.regionCode is invalid.",
    );
  }
  return Object.freeze({
    countryCode,
    regionCode,
    postalCode: optionalText(
      source.postalCode,
      "checkoutCapabilityRequest.destination.postalCode",
      40,
    ),
    city: optionalText(
      source.city,
      "checkoutCapabilityRequest.destination.city",
      120,
    ),
  });
}

export function parseStorefrontCheckoutCapabilityRequestV1(
  value: unknown,
): StorefrontCheckoutCapabilityRequestV1 {
  const source = asRecord(value, "checkoutCapabilityRequest");
  strictKeys(source, REQUEST_KEYS, "checkoutCapabilityRequest");
  if (source.contractVersion !== "storefront-checkout-capability-request.v1") {
    throw new StorefrontContractError(
      "Unsupported storefront checkout capability request contract.",
    );
  }
  return Object.freeze({
    contractVersion: "storefront-checkout-capability-request.v1",
    quoteId: uuid(source.quoteId, "checkoutCapabilityRequest.quoteId"),
    quoteRevision: revision(
      source.quoteRevision,
      "checkoutCapabilityRequest.quoteRevision",
    ),
    cartRevision: revision(
      source.cartRevision,
      "checkoutCapabilityRequest.cartRevision",
    ),
    destination: parseDestination(source.destination),
    shippingOptionId: optionalToken(
      source.shippingOptionId,
      "checkoutCapabilityRequest.shippingOptionId",
    ),
    paymentCapabilityId: optionalToken(
      source.paymentCapabilityId,
      "checkoutCapabilityRequest.paymentCapabilityId",
    ),
  });
}

function nonNegativeMoney(
  value: unknown,
  context: StorefrontHostContextV1,
  expectedScale: number | undefined,
  label: string,
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
      `${label} scale must match other checkout amounts.`,
    );
  }
  return money;
}

function parseShippingOption(
  value: unknown,
  context: StorefrontHostContextV1,
  expectedScale: number | undefined,
): StorefrontShippingOptionV1 {
  const source = asRecord(value, "checkoutCapability.shippingOption");
  strictKeys(source, SHIPPING_KEYS, "checkoutCapability.shippingOption");
  if (
    typeof source.method !== "string" ||
    !SHIPPING_METHODS.includes(source.method as StorefrontShippingMethodV1)
  ) {
    throw new StorefrontContractError(
      "checkoutCapability.shippingOption.method is unsupported.",
    );
  }
  return Object.freeze({
    optionId: token(source.optionId, "checkoutCapability.shippingOption.optionId"),
    method: source.method as StorefrontShippingMethodV1,
    label: boundedText(source.label, "checkoutCapability.shippingOption.label", 160),
    amount: nonNegativeMoney(
      source.amount,
      context,
      expectedScale,
      "checkoutCapability.shippingOption.amount",
    ),
    expiresAt: instant(
      source.expiresAt,
      "checkoutCapability.shippingOption.expiresAt",
    ),
    version: token(source.version, "checkoutCapability.shippingOption.version"),
  });
}

function parsePaymentCapability(value: unknown): StorefrontPaymentCapabilityV1 {
  const source = asRecord(value, "checkoutCapability.paymentCapability");
  strictKeys(source, PAYMENT_KEYS, "checkoutCapability.paymentCapability");
  if (typeof source.requiresAction !== "boolean") {
    throw new StorefrontContractError(
      "checkoutCapability.paymentCapability.requiresAction must be boolean.",
    );
  }
  return Object.freeze({
    capabilityId: token(
      source.capabilityId,
      "checkoutCapability.paymentCapability.capabilityId",
    ),
    providerCapability: token(
      source.providerCapability,
      "checkoutCapability.paymentCapability.providerCapability",
    ),
    kind: token(source.kind, "checkoutCapability.paymentCapability.kind"),
    label: boundedText(
      source.label,
      "checkoutCapability.paymentCapability.label",
      160,
    ),
    requiresAction: source.requiresAction,
    expiresAt: optionalInstant(
      source.expiresAt,
      "checkoutCapability.paymentCapability.expiresAt",
    ),
    version: token(
      source.version,
      "checkoutCapability.paymentCapability.version",
    ),
  });
}

function uniqueBy<T>(
  values: readonly T[],
  key: (value: T) => string,
  label: string,
): void {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length) {
    throw new StorefrontContractError(`${label} must contain unique identifiers.`);
  }
}

function parseAuthority(value: unknown): StorefrontCheckoutCapabilityAuthorityV1 {
  const source = asRecord(value, "checkoutCapability.authority");
  strictKeys(source, AUTHORITY_KEYS, "checkoutCapability.authority");
  return Object.freeze({
    quoteAuthorityToken: token(
      source.quoteAuthorityToken,
      "checkoutCapability.authority.quoteAuthorityToken",
    ),
    countryPolicyRevision: token(
      source.countryPolicyRevision,
      "checkoutCapability.authority.countryPolicyRevision",
    ),
    shippingRevision: token(
      source.shippingRevision,
      "checkoutCapability.authority.shippingRevision",
    ),
    paymentRevision: token(
      source.paymentRevision,
      "checkoutCapability.authority.paymentRevision",
    ),
  });
}

function parseChangedReasons(
  value: unknown,
  state: StorefrontCheckoutCapabilityStateV1,
): readonly StorefrontCheckoutChangeReasonV1[] {
  if (!Array.isArray(value) || value.length > CHANGE_REASONS.length) {
    throw new StorefrontContractError(
      "checkoutCapability.changedReasons must be a bounded array.",
    );
  }
  const reasons = value.map((entry) => {
    if (
      typeof entry !== "string" ||
      !CHANGE_REASONS.includes(entry as StorefrontCheckoutChangeReasonV1)
    ) {
      throw new StorefrontContractError(
        "checkoutCapability.changedReasons contains an unsupported reason.",
      );
    }
    return entry as StorefrontCheckoutChangeReasonV1;
  });
  if (new Set(reasons).size !== reasons.length) {
    throw new StorefrontContractError(
      "checkoutCapability.changedReasons cannot contain duplicates.",
    );
  }
  if (state === "ready" && reasons.length !== 0) {
    throw new StorefrontContractError(
      "Ready checkout capabilities cannot contain changed reasons.",
    );
  }
  if (state !== "ready" && reasons.length === 0) {
    throw new StorefrontContractError(
      "Changed or unavailable checkout capabilities require a reason.",
    );
  }
  return Object.freeze(reasons);
}

export function parseStorefrontCheckoutCapabilityEnvelopeV1(
  value: unknown,
): StorefrontCheckoutCapabilityEnvelopeV1 {
  const source = asRecord(value, "checkoutCapability");
  strictKeys(source, ENVELOPE_KEYS, "checkoutCapability");
  if (source.contractVersion !== "storefront-checkout-capability-envelope.v1") {
    throw new StorefrontContractError(
      "Unsupported storefront checkout capability envelope contract.",
    );
  }
  if (
    typeof source.state !== "string" ||
    !STATES.includes(source.state as StorefrontCheckoutCapabilityStateV1)
  ) {
    throw new StorefrontContractError("checkoutCapability.state is unsupported.");
  }
  const state = source.state as StorefrontCheckoutCapabilityStateV1;
  const context = parseStorefrontHostContextV1(source.context);
  if (!Array.isArray(source.shippingOptions) || source.shippingOptions.length > 20) {
    throw new StorefrontContractError(
      "checkoutCapability.shippingOptions must contain at most 20 entries.",
    );
  }
  let scale: number | undefined;
  const shippingOptions = source.shippingOptions.map((entry) => {
    const option = parseShippingOption(entry, context, scale);
    scale ??= option.amount.scale;
    return option;
  });
  uniqueBy(shippingOptions, (option) => option.optionId, "checkoutCapability.shippingOptions");

  if (
    !Array.isArray(source.paymentCapabilities) ||
    source.paymentCapabilities.length > 20
  ) {
    throw new StorefrontContractError(
      "checkoutCapability.paymentCapabilities must contain at most 20 entries.",
    );
  }
  const paymentCapabilities = source.paymentCapabilities.map(parsePaymentCapability);
  uniqueBy(
    paymentCapabilities,
    (capability) => capability.capabilityId,
    "checkoutCapability.paymentCapabilities",
  );

  return Object.freeze({
    contractVersion: "storefront-checkout-capability-envelope.v1",
    context,
    quoteId: uuid(source.quoteId, "checkoutCapability.quoteId"),
    quoteRevision: revision(source.quoteRevision, "checkoutCapability.quoteRevision"),
    quoteExpiresAt: instant(
      source.quoteExpiresAt,
      "checkoutCapability.quoteExpiresAt",
    ),
    state,
    shippingOptions: Object.freeze(shippingOptions),
    paymentCapabilities: Object.freeze(paymentCapabilities),
    authority: parseAuthority(source.authority),
    changedReasons: parseChangedReasons(source.changedReasons, state),
  });
}
