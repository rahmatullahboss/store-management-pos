import {
  StorefrontContractError,
  parseStorefrontBootstrapV1,
  type StorefrontHostContextV1,
  type StorefrontMoneyV1,
} from "./index.js";

export type StorefrontCustomerKindV1 = "person" | "company";
export type StorefrontCustomerContactTypeV1 = "email" | "phone" | "mobile";
export type StorefrontCustomerAddressTypeV1 =
  | "billing"
  | "shipping"
  | "home"
  | "office"
  | "other";

export interface StorefrontCustomerAccountContactV1 {
  readonly type: StorefrontCustomerContactTypeV1;
  readonly value: string;
  readonly primary: boolean;
  readonly verified: boolean;
}

export interface StorefrontCustomerAccountAddressV1 {
  readonly id: string;
  readonly type: StorefrontCustomerAddressTypeV1;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly region: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string;
  readonly primary: boolean;
}

export interface StorefrontCustomerAccountV1 {
  readonly contractVersion: "storefront-customer-account.v1";
  readonly context: StorefrontHostContextV1;
  readonly customerId: string;
  readonly kind: StorefrontCustomerKindV1;
  readonly displayName: string;
  readonly contacts: readonly StorefrontCustomerAccountContactV1[];
  readonly addresses: readonly StorefrontCustomerAccountAddressV1[];
  readonly profileRevision: string;
  readonly updatedAt: string;
}

export type StorefrontOrderStatusV1 =
  | "draft"
  | "confirmed"
  | "on_hold"
  | "cancelled"
  | "completed";
export type StorefrontOrderPaymentStatusV1 =
  | "unpaid"
  | "partially_paid"
  | "paid"
  | "partially_refunded"
  | "refunded";
export type StorefrontOrderFulfillmentStatusV1 =
  | "unfulfilled"
  | "partially_fulfilled"
  | "fulfilled"
  | "cancelled";
export type StorefrontOrderReturnStatusV1 =
  | "not_returned"
  | "partially_returned"
  | "returned";
export type StorefrontOrderFulfillmentMethodV1 =
  | "pickup"
  | "local_delivery"
  | "ship_from_store"
  | "split";

export interface StorefrontOrderQuantityV1 {
  readonly amount: string;
  readonly unit: string;
  readonly scale: number;
}

export interface StorefrontOrderLineV1 {
  readonly lineId: string;
  readonly productId: string;
  readonly variantId: string;
  readonly sku: string | null;
  readonly displayName: string | null;
  readonly quantity: StorefrontOrderQuantityV1;
  readonly unitPrice: StorefrontMoneyV1;
  readonly discount: StorefrontMoneyV1;
  readonly tax: StorefrontMoneyV1;
  readonly total: StorefrontMoneyV1;
}

export interface StorefrontOrderSummaryV1 {
  readonly orderId: string;
  readonly documentNumber: string;
  readonly orderRevision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly orderStatus: StorefrontOrderStatusV1;
  readonly paymentStatus: StorefrontOrderPaymentStatusV1;
  readonly fulfillmentStatus: StorefrontOrderFulfillmentStatusV1;
  readonly returnStatus: StorefrontOrderReturnStatusV1;
  readonly total: StorefrontMoneyV1;
}

export interface StorefrontOrderHistoryPageV1 {
  readonly contractVersion: "storefront-order-history.v1";
  readonly context: StorefrontHostContextV1;
  readonly items: readonly StorefrontOrderSummaryV1[];
  readonly nextCursor: string | null;
}

export interface StorefrontOrderDetailV1 extends StorefrontOrderSummaryV1 {
  readonly contractVersion: "storefront-order-detail.v1";
  readonly context: StorefrontHostContextV1;
  readonly fulfillmentMethod: StorefrontOrderFulfillmentMethodV1;
  readonly lines: readonly StorefrontOrderLineV1[];
}

export interface StorefrontOrderHistoryRequestV1 {
  readonly contractVersion: "storefront-order-history-request.v1";
  readonly cursor: string | null;
  readonly limit: number;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPAQUE_CURSOR = /^[A-Za-z0-9._~:=-]{1,512}$/u;
const INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const SIGNED_INTEGER = /^-?(?:0|[1-9][0-9]*)$/u;
const CURRENCY = /^[A-Z]{3}$/u;
const COUNTRY = /^[A-Z]{2}$/u;

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

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  return boundedText(value, label, maximum);
}

function uuid(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 36).toLowerCase();
  if (!UUID.test(normalized)) {
    throw new StorefrontContractError(`${label} must be a UUID.`);
  }
  return normalized;
}

function opaqueCursor(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 512);
  if (!OPAQUE_CURSOR.test(normalized)) {
    throw new StorefrontContractError(
      `${label} must be a bounded URL-safe opaque token.`,
    );
  }
  return normalized;
}

function revision(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 120);
  if (!INTEGER.test(normalized)) {
    throw new StorefrontContractError(`${label} must be a non-negative integer string.`);
  }
  return normalized;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new StorefrontContractError(`${label} must be a boolean.`);
  }
  return value;
}

function dateTime(value: unknown, label: string): string {
  const normalized = boundedText(value, label, 64);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new StorefrontContractError(`${label} must be an ISO date-time.`);
  }
  return new Date(parsed).toISOString();
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

function hostContext(value: unknown): StorefrontHostContextV1 {
  return parseStorefrontBootstrapV1({
    contractVersion: "storefront-bootstrap.v1",
    context: value,
    themeRevision: "account",
    layoutRevision: "account",
    capabilities: [],
  }).context;
}

function money(value: unknown, label: string): StorefrontMoneyV1 {
  const source = asRecord(value, label);
  strictKeys(source, new Set(["currency", "minor", "scale"]), label);
  const currency = boundedText(source.currency, `${label}.currency`, 3).toUpperCase();
  if (!CURRENCY.test(currency)) {
    throw new StorefrontContractError(`${label}.currency is invalid.`);
  }
  const minor = boundedText(source.minor, `${label}.minor`, 80);
  if (!SIGNED_INTEGER.test(minor)) {
    throw new StorefrontContractError(`${label}.minor must be an integer string.`);
  }
  if (!Number.isInteger(source.scale) || (source.scale as number) < 0 || (source.scale as number) > 6) {
    throw new StorefrontContractError(`${label}.scale must be an integer between 0 and 6.`);
  }
  return Object.freeze({ currency, minor, scale: source.scale as number });
}

function contact(value: unknown, index: number): StorefrontCustomerAccountContactV1 {
  const label = `customerAccount.contacts[${index}]`;
  const source = asRecord(value, label);
  strictKeys(source, new Set(["type", "value", "primary", "verified"]), label);
  return Object.freeze({
    type: enumValue(source.type, ["email", "phone", "mobile"] as const, `${label}.type`),
    value: boundedText(source.value, `${label}.value`, 320),
    primary: booleanValue(source.primary, `${label}.primary`),
    verified: booleanValue(source.verified, `${label}.verified`),
  });
}

function address(value: unknown, index: number): StorefrontCustomerAccountAddressV1 {
  const label = `customerAccount.addresses[${index}]`;
  const source = asRecord(value, label);
  strictKeys(
    source,
    new Set(["id", "type", "line1", "line2", "city", "region", "postalCode", "countryCode", "primary"]),
    label,
  );
  const countryCode = boundedText(source.countryCode, `${label}.countryCode`, 2).toUpperCase();
  if (!COUNTRY.test(countryCode)) {
    throw new StorefrontContractError(`${label}.countryCode is invalid.`);
  }
  return Object.freeze({
    id: uuid(source.id, `${label}.id`),
    type: enumValue(
      source.type,
      ["billing", "shipping", "home", "office", "other"] as const,
      `${label}.type`,
    ),
    line1: boundedText(source.line1, `${label}.line1`, 200),
    line2: optionalText(source.line2, `${label}.line2`, 200),
    city: boundedText(source.city, `${label}.city`, 120),
    region: optionalText(source.region, `${label}.region`, 120),
    postalCode: optionalText(source.postalCode, `${label}.postalCode`, 40),
    countryCode,
    primary: booleanValue(source.primary, `${label}.primary`),
  });
}

function quantity(value: unknown, label: string): StorefrontOrderQuantityV1 {
  const source = asRecord(value, label);
  strictKeys(source, new Set(["amount", "unit", "scale"]), label);
  const amount = boundedText(source.amount, `${label}.amount`, 80);
  if (!INTEGER.test(amount) || BigInt(amount) <= 0n) {
    throw new StorefrontContractError(`${label}.amount must be a positive integer string.`);
  }
  if (!Number.isInteger(source.scale) || (source.scale as number) < 0 || (source.scale as number) > 6) {
    throw new StorefrontContractError(`${label}.scale must be an integer between 0 and 6.`);
  }
  return Object.freeze({
    amount,
    unit: boundedText(source.unit, `${label}.unit`, 40),
    scale: source.scale as number,
  });
}

function orderLine(value: unknown, index: number): StorefrontOrderLineV1 {
  const label = `orderDetail.lines[${index}]`;
  const source = asRecord(value, label);
  strictKeys(
    source,
    new Set(["lineId", "productId", "variantId", "sku", "displayName", "quantity", "unitPrice", "discount", "tax", "total"]),
    label,
  );
  const total = money(source.total, `${label}.total`);
  const unitPrice = money(source.unitPrice, `${label}.unitPrice`);
  const discount = money(source.discount, `${label}.discount`);
  const tax = money(source.tax, `${label}.tax`);
  for (const candidate of [unitPrice, discount, tax]) {
    if (candidate.currency !== total.currency || candidate.scale !== total.scale) {
      throw new StorefrontContractError(`${label} money values must use one currency and scale.`);
    }
  }
  return Object.freeze({
    lineId: uuid(source.lineId, `${label}.lineId`),
    productId: uuid(source.productId, `${label}.productId`),
    variantId: uuid(source.variantId, `${label}.variantId`),
    sku: optionalText(source.sku, `${label}.sku`, 120),
    displayName: optionalText(source.displayName, `${label}.displayName`, 240),
    quantity: quantity(source.quantity, `${label}.quantity`),
    unitPrice,
    discount,
    tax,
    total,
  });
}

const ORDER_SUMMARY_KEYS = new Set([
  "orderId",
  "documentNumber",
  "orderRevision",
  "createdAt",
  "updatedAt",
  "orderStatus",
  "paymentStatus",
  "fulfillmentStatus",
  "returnStatus",
  "total",
]);

function orderSummary(value: unknown, label: string): StorefrontOrderSummaryV1 {
  const source = asRecord(value, label);
  strictKeys(source, ORDER_SUMMARY_KEYS, label);
  return Object.freeze({
    orderId: uuid(source.orderId, `${label}.orderId`),
    documentNumber: boundedText(source.documentNumber, `${label}.documentNumber`, 120),
    orderRevision: revision(source.orderRevision, `${label}.orderRevision`),
    createdAt: dateTime(source.createdAt, `${label}.createdAt`),
    updatedAt: dateTime(source.updatedAt, `${label}.updatedAt`),
    orderStatus: enumValue(
      source.orderStatus,
      ["draft", "confirmed", "on_hold", "cancelled", "completed"] as const,
      `${label}.orderStatus`,
    ),
    paymentStatus: enumValue(
      source.paymentStatus,
      ["unpaid", "partially_paid", "paid", "partially_refunded", "refunded"] as const,
      `${label}.paymentStatus`,
    ),
    fulfillmentStatus: enumValue(
      source.fulfillmentStatus,
      ["unfulfilled", "partially_fulfilled", "fulfilled", "cancelled"] as const,
      `${label}.fulfillmentStatus`,
    ),
    returnStatus: enumValue(
      source.returnStatus,
      ["not_returned", "partially_returned", "returned"] as const,
      `${label}.returnStatus`,
    ),
    total: money(source.total, `${label}.total`),
  });
}

export function parseStorefrontCustomerAccountV1(value: unknown): StorefrontCustomerAccountV1 {
  const source = asRecord(value, "customerAccount");
  strictKeys(
    source,
    new Set(["contractVersion", "context", "customerId", "kind", "displayName", "contacts", "addresses", "profileRevision", "updatedAt"]),
    "customerAccount",
  );
  if (source.contractVersion !== "storefront-customer-account.v1") {
    throw new StorefrontContractError("Unsupported storefront customer account contract.");
  }
  if (!Array.isArray(source.contacts) || source.contacts.length > 32) {
    throw new StorefrontContractError("customerAccount.contacts must contain at most 32 entries.");
  }
  if (!Array.isArray(source.addresses) || source.addresses.length > 32) {
    throw new StorefrontContractError("customerAccount.addresses must contain at most 32 entries.");
  }
  return Object.freeze({
    contractVersion: "storefront-customer-account.v1",
    context: hostContext(source.context),
    customerId: uuid(source.customerId, "customerAccount.customerId"),
    kind: enumValue(source.kind, ["person", "company"] as const, "customerAccount.kind"),
    displayName: boundedText(source.displayName, "customerAccount.displayName", 240),
    contacts: Object.freeze(source.contacts.map(contact)),
    addresses: Object.freeze(source.addresses.map(address)),
    profileRevision: revision(source.profileRevision, "customerAccount.profileRevision"),
    updatedAt: dateTime(source.updatedAt, "customerAccount.updatedAt"),
  });
}

export function parseStorefrontOrderHistoryRequestV1(value: unknown): StorefrontOrderHistoryRequestV1 {
  const source = asRecord(value, "orderHistoryRequest");
  strictKeys(source, new Set(["contractVersion", "cursor", "limit"]), "orderHistoryRequest");
  if (source.contractVersion !== "storefront-order-history-request.v1") {
    throw new StorefrontContractError("Unsupported storefront order history request contract.");
  }
  const limit = source.limit;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50) {
    throw new StorefrontContractError("orderHistoryRequest.limit must be between 1 and 50.");
  }
  return Object.freeze({
    contractVersion: "storefront-order-history-request.v1",
    cursor:
      source.cursor === null || source.cursor === undefined || source.cursor === ""
        ? null
        : opaqueCursor(source.cursor, "orderHistoryRequest.cursor"),
    limit: limit as number,
  });
}

export function parseStorefrontOrderHistoryPageV1(value: unknown): StorefrontOrderHistoryPageV1 {
  const source = asRecord(value, "orderHistory");
  strictKeys(source, new Set(["contractVersion", "context", "items", "nextCursor"]), "orderHistory");
  if (source.contractVersion !== "storefront-order-history.v1") {
    throw new StorefrontContractError("Unsupported storefront order history contract.");
  }
  if (!Array.isArray(source.items) || source.items.length > 50) {
    throw new StorefrontContractError("orderHistory.items must contain at most 50 entries.");
  }
  return Object.freeze({
    contractVersion: "storefront-order-history.v1",
    context: hostContext(source.context),
    items: Object.freeze(
      source.items.map((item, index) => orderSummary(item, `orderHistory.items[${index}]`)),
    ),
    nextCursor:
      source.nextCursor === null || source.nextCursor === undefined || source.nextCursor === ""
        ? null
        : opaqueCursor(source.nextCursor, "orderHistory.nextCursor"),
  });
}

export function parseStorefrontOrderDetailV1(value: unknown): StorefrontOrderDetailV1 {
  const source = asRecord(value, "orderDetail");
  strictKeys(
    source,
    new Set([...ORDER_SUMMARY_KEYS, "contractVersion", "context", "fulfillmentMethod", "lines"]),
    "orderDetail",
  );
  if (source.contractVersion !== "storefront-order-detail.v1") {
    throw new StorefrontContractError("Unsupported storefront order detail contract.");
  }
  if (!Array.isArray(source.lines) || source.lines.length > 500) {
    throw new StorefrontContractError("orderDetail.lines must contain at most 500 entries.");
  }
  const summarySource = Object.fromEntries(
    [...ORDER_SUMMARY_KEYS].map((key) => [key, source[key]]),
  );
  const summary = orderSummary(summarySource, "orderDetail");
  const lines = Object.freeze(source.lines.map(orderLine));
  for (const line of lines) {
    if (line.total.currency !== summary.total.currency || line.total.scale !== summary.total.scale) {
      throw new StorefrontContractError("orderDetail line money must match order total currency and scale.");
    }
  }
  return Object.freeze({
    contractVersion: "storefront-order-detail.v1",
    context: hostContext(source.context),
    ...summary,
    fulfillmentMethod: enumValue(
      source.fulfillmentMethod,
      ["pickup", "local_delivery", "ship_from_store", "split"] as const,
      "orderDetail.fulfillmentMethod",
    ),
    lines,
  });
}