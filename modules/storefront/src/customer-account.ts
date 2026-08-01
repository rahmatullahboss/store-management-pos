import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { MoneyV1 } from "../../../packages/contracts/src/v1/common.js";
import type { CustomerRecord, CustomerService } from "../../customer/src/index.js";
import type { SalesOrder } from "../../sales/src/index.js";
import {
  StorefrontContractError,
  type StorefrontHostContextV1,
  type StorefrontMoneyV1,
} from "../../../packages/storefront-contracts/src/index.js";
import type {
  StorefrontCustomerAccountV1,
  StorefrontOrderDetailV1,
  StorefrontOrderHistoryPageV1,
  StorefrontOrderHistoryRequestV1,
  StorefrontOrderLineV1,
  StorefrontOrderSummaryV1,
} from "../../../packages/storefront-contracts/src/customer-account.js";

export interface StorefrontAccountPrincipalV1 {
  readonly principalVersion: "storefront-account-principal.v1";
  readonly source: "authenticated-session";
  readonly customerId: string;
  readonly requestContext: RequestContext;
}

export interface StorefrontCustomerOrderRecordV1 {
  readonly order: SalesOrder;
  readonly storefrontId: string;
  readonly salesChannelId: string;
}

export interface StorefrontCustomerOrderReadPort {
  listForCustomer(input: {
    readonly requestContext: RequestContext;
    readonly customerId: string;
    readonly storefrontId: string;
    readonly salesChannelId: string;
    readonly cursor: string | null;
    readonly limit: number;
  }): Promise<{
    readonly records: readonly StorefrontCustomerOrderRecordV1[];
    readonly nextCursor: string | null;
  }>;
  getForCustomer(input: {
    readonly requestContext: RequestContext;
    readonly customerId: string;
    readonly storefrontId: string;
    readonly salesChannelId: string;
    readonly orderId: string;
  }): Promise<StorefrontCustomerOrderRecordV1 | null>;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INTEGER = /^-?(?:0|[1-9][0-9]*)$/u;

function uuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID.test(normalized)) {
    throw new StorefrontContractError(`${label} must be a UUID.`);
  }
  return normalized;
}

function bounded(value: string, label: string, maximum: number): string {
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

function dateTime(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new StorefrontContractError(`${label} is invalid.`);
  }
  return new Date(parsed).toISOString();
}

function assertPrincipal(
  principal: StorefrontAccountPrincipalV1,
  context: StorefrontHostContextV1,
  options: { readonly orders?: boolean } = {},
): RequestContext {
  if (
    principal.principalVersion !== "storefront-account-principal.v1" ||
    principal.source !== "authenticated-session"
  ) {
    throw new StorefrontContractError(
      "Storefront customer account requires a trusted authenticated-session principal.",
    );
  }
  uuid(principal.customerId, "Storefront account customerId");
  const requestContext = principal.requestContext;
  if (
    requestContext.tenantId !== context.tenantId ||
    requestContext.locale !== context.locale ||
    !requestContext.legalEntityId ||
    !requestContext.storeId
  ) {
    throw new StorefrontContractError(
      "Authenticated storefront account context does not match storefront scope.",
    );
  }
  if (!requestContext.permissions.has("customer.profile.read")) {
    throw new StorefrontContractError(
      "Authenticated storefront account lacks customer profile read permission.",
    );
  }
  if (options.orders === true && !requestContext.permissions.has("sales.order.read")) {
    throw new StorefrontContractError(
      "Authenticated storefront account lacks order read permission.",
    );
  }
  return requestContext;
}

function assertCustomer(
  customer: CustomerRecord,
  principal: StorefrontAccountPrincipalV1,
  context: StorefrontHostContextV1,
): void {
  if (
    customer.id !== principal.customerId ||
    customer.tenantId !== context.tenantId ||
    customer.status !== "active" ||
    customer.mergedIntoId
  ) {
    throw new StorefrontContractError(
      "Authenticated storefront account resolved an invalid canonical customer.",
    );
  }
  if (
    customer.legalEntityId &&
    customer.legalEntityId !== principal.requestContext.legalEntityId
  ) {
    throw new StorefrontContractError(
      "Authenticated storefront account customer legal-entity scope mismatch.",
    );
  }
}

function projectCustomer(
  customer: CustomerRecord,
  context: StorefrontHostContextV1,
): StorefrontCustomerAccountV1 {
  const contacts = customer.contacts
    .filter((contact) =>
      contact.type === "email" || contact.type === "phone" || contact.type === "mobile",
    )
    .map((contact) =>
      Object.freeze({
        type: contact.type,
        value: bounded(contact.value, "Customer contact", 320),
        primary: contact.primary,
        verified: contact.verifiedAt !== undefined,
      }),
    );
  const addresses = customer.addresses.map((address) =>
    Object.freeze({
      id: uuid(address.id, "Customer address id"),
      type: address.type,
      line1: bounded(address.line1, "Customer address line1", 200),
      line2: address.line2 ? bounded(address.line2, "Customer address line2", 200) : null,
      city: bounded(address.city, "Customer address city", 120),
      region: address.region ? bounded(address.region, "Customer address region", 120) : null,
      postalCode: address.postalCode
        ? bounded(address.postalCode, "Customer address postalCode", 40)
        : null,
      countryCode: bounded(address.countryCode, "Customer address countryCode", 2).toUpperCase(),
      primary: address.primary,
    }),
  );
  return Object.freeze({
    contractVersion: "storefront-customer-account.v1",
    context,
    customerId: uuid(customer.id, "Customer id"),
    kind: customer.kind,
    displayName: bounded(customer.displayName, "Customer displayName", 240),
    contacts: Object.freeze(contacts),
    addresses: Object.freeze(addresses),
    profileRevision: customer.version.toString(),
    updatedAt: dateTime(customer.updatedAt, "Customer updatedAt"),
  });
}

function storefrontMoney(
  value: MoneyV1,
  expectedCurrency: string,
  expectedScale: number,
  label: string,
): StorefrontMoneyV1 {
  const currency = value.currency.trim().toUpperCase();
  if (
    currency !== expectedCurrency ||
    value.scale !== expectedScale ||
    !INTEGER.test(value.amountMinor)
  ) {
    throw new StorefrontContractError(`${label} does not match canonical order money scope.`);
  }
  return Object.freeze({
    currency,
    minor: value.amountMinor,
    scale: value.scale,
  });
}

function orderTotal(order: SalesOrder): StorefrontMoneyV1 {
  if (
    !Number.isInteger(order.total.scale) ||
    order.total.scale < 0 ||
    order.total.scale > 6 ||
    order.total.grossMinor < 0n
  ) {
    throw new StorefrontContractError("Canonical order total is invalid.");
  }
  return Object.freeze({
    currency: bounded(order.currency, "Order currency", 3).toUpperCase(),
    minor: order.total.grossMinor.toString(),
    scale: order.total.scale,
  });
}

function lineTax(
  order: SalesOrder,
  line: SalesOrder["lines"][number],
): StorefrontMoneyV1 {
  let amountMinor = 0n;
  for (const tax of line.priceTaxSnapshot.taxes) {
    const amount = storefrontMoney(
      tax.amount,
      order.currency,
      order.total.scale,
      "Canonical order line tax",
    );
    amountMinor += BigInt(amount.minor);
  }
  return Object.freeze({
    currency: order.currency,
    minor: amountMinor.toString(),
    scale: order.total.scale,
  });
}

function projectLine(
  order: SalesOrder,
  line: SalesOrder["lines"][number],
): StorefrontOrderLineV1 {
  const snapshot = line.priceTaxSnapshot;
  if (
    snapshot.item.itemId !== line.item.itemId ||
    snapshot.item.variantId !== line.item.variantId ||
    snapshot.quantity.amount !== line.quantity.amount ||
    snapshot.quantity.unit !== line.quantity.unit ||
    snapshot.quantity.scale !== line.quantity.scale
  ) {
    throw new StorefrontContractError(
      "Canonical order line price/tax snapshot does not match the persisted line.",
    );
  }
  return Object.freeze({
    lineId: uuid(line.id, "Order line id"),
    productId: uuid(line.item.itemId, "Order line productId"),
    variantId: uuid(line.item.variantId, "Order line variantId"),
    sku: line.item.sku ? bounded(line.item.sku, "Order line sku", 120) : null,
    displayName: line.item.displayNameSnapshot
      ? bounded(line.item.displayNameSnapshot, "Order line displayName", 240)
      : null,
    quantity: Object.freeze({
      amount: bounded(line.quantity.amount, "Order line quantity amount", 80),
      unit: bounded(line.quantity.unit, "Order line quantity unit", 40),
      scale: line.quantity.scale,
    }),
    unitPrice: storefrontMoney(
      snapshot.effectiveUnitPrice,
      order.currency,
      order.total.scale,
      "Canonical order line unit price",
    ),
    discount: storefrontMoney(
      snapshot.discountTotal,
      order.currency,
      order.total.scale,
      "Canonical order line discount",
    ),
    tax: lineTax(order, line),
    total: storefrontMoney(
      snapshot.grossTotal,
      order.currency,
      order.total.scale,
      "Canonical order line total",
    ),
  });
}

function assertOrderRecord(
  record: StorefrontCustomerOrderRecordV1,
  principal: StorefrontAccountPrincipalV1,
  context: StorefrontHostContextV1,
): SalesOrder {
  const order = record.order;
  if (
    record.storefrontId !== context.storefrontId ||
    record.salesChannelId !== context.salesChannelId ||
    order.tenantId !== context.tenantId ||
    order.customer.customerId !== principal.customerId ||
    order.legalEntityId !== principal.requestContext.legalEntityId ||
    order.storeId !== principal.requestContext.storeId
  ) {
    throw new StorefrontContractError(
      "Canonical customer order does not belong to this authenticated storefront scope.",
    );
  }
  return order;
}

function projectSummary(order: SalesOrder): StorefrontOrderSummaryV1 {
  return Object.freeze({
    orderId: uuid(order.id, "Order id"),
    documentNumber: bounded(order.documentNumber, "Order documentNumber", 120),
    orderRevision: order.version.toString(),
    createdAt: dateTime(order.createdAt, "Order createdAt"),
    updatedAt: dateTime(order.updatedAt, "Order updatedAt"),
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    returnStatus: order.returnStatus,
    total: orderTotal(order),
  });
}

export async function readStorefrontCustomerAccountV1(
  customerService: Pick<CustomerService, "get">,
  input: {
    readonly principal: StorefrontAccountPrincipalV1;
    readonly context: StorefrontHostContextV1;
  },
): Promise<StorefrontCustomerAccountV1> {
  const requestContext = assertPrincipal(input.principal, input.context);
  const customer = await customerService.get(requestContext, input.principal.customerId);
  assertCustomer(customer, input.principal, input.context);
  return projectCustomer(customer, input.context);
}

export async function listStorefrontCustomerOrdersV1(
  orderRead: StorefrontCustomerOrderReadPort,
  input: {
    readonly principal: StorefrontAccountPrincipalV1;
    readonly context: StorefrontHostContextV1;
    readonly request: StorefrontOrderHistoryRequestV1;
  },
): Promise<StorefrontOrderHistoryPageV1> {
  const requestContext = assertPrincipal(input.principal, input.context, { orders: true });
  if (
    input.request.contractVersion !== "storefront-order-history-request.v1" ||
    !Number.isInteger(input.request.limit) ||
    input.request.limit < 1 ||
    input.request.limit > 50
  ) {
    throw new StorefrontContractError("Storefront order history request is invalid.");
  }
  const result = await orderRead.listForCustomer({
    requestContext,
    customerId: input.principal.customerId,
    storefrontId: input.context.storefrontId,
    salesChannelId: input.context.salesChannelId,
    cursor: input.request.cursor,
    limit: input.request.limit,
  });
  if (result.records.length > input.request.limit || result.records.length > 50) {
    throw new StorefrontContractError("Canonical order history exceeded the requested page bound.");
  }
  const items = result.records.map((record) =>
    projectSummary(assertOrderRecord(record, input.principal, input.context)),
  );
  return Object.freeze({
    contractVersion: "storefront-order-history.v1",
    context: input.context,
    items: Object.freeze(items),
    nextCursor: result.nextCursor ? uuid(result.nextCursor, "Order history nextCursor") : null,
  });
}

export async function readStorefrontCustomerOrderV1(
  orderRead: StorefrontCustomerOrderReadPort,
  input: {
    readonly principal: StorefrontAccountPrincipalV1;
    readonly context: StorefrontHostContextV1;
    readonly orderId: string;
  },
): Promise<StorefrontOrderDetailV1 | null> {
  const requestContext = assertPrincipal(input.principal, input.context, { orders: true });
  const orderId = uuid(input.orderId, "Order id");
  const record = await orderRead.getForCustomer({
    requestContext,
    customerId: input.principal.customerId,
    storefrontId: input.context.storefrontId,
    salesChannelId: input.context.salesChannelId,
    orderId,
  });
  if (!record) return null;
  const order = assertOrderRecord(record, input.principal, input.context);
  return Object.freeze({
    contractVersion: "storefront-order-detail.v1",
    context: input.context,
    ...projectSummary(order),
    fulfillmentMethod: order.fulfillmentMethod,
    lines: Object.freeze(order.lines.map((line) => projectLine(order, line))),
  });
}
