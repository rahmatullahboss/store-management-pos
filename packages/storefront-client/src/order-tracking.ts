import {
  parseStorefrontOrderDetailV1,
  type StorefrontOrderDetailV1,
  type StorefrontOrderFulfillmentMethodV1,
  type StorefrontOrderFulfillmentStatusV1,
  type StorefrontOrderLineV1,
  type StorefrontOrderPaymentStatusV1,
  type StorefrontOrderReturnStatusV1,
  type StorefrontOrderStatusV1,
} from "../../storefront-contracts/src/customer-account.js";
import type { StorefrontMoneyV1 } from "../../storefront-contracts/src/index.js";

export type StorefrontOrderTrackingStateV1 =
  | "pending"
  | "in_progress"
  | "attention"
  | "complete"
  | "cancelled"
  | "returned"
  | "refunded";

export interface StorefrontOrderTrackingLineV1 {
  readonly lineId: string;
  readonly productId: string;
  readonly variantId: string;
  readonly label: string;
  readonly sku: string | null;
  readonly quantityLabel: string;
  readonly totalLabel: string;
}

export interface StorefrontOrderTrackingViewV1 {
  readonly viewVersion: "storefront-order-tracking-view.v1";
  readonly orderId: string;
  readonly documentNumber: string;
  readonly orderRevision: string;
  readonly state: StorefrontOrderTrackingStateV1;
  readonly orderStatus: StorefrontOrderStatusV1;
  readonly paymentStatus: StorefrontOrderPaymentStatusV1;
  readonly fulfillmentStatus: StorefrontOrderFulfillmentStatusV1;
  readonly returnStatus: StorefrontOrderReturnStatusV1;
  readonly fulfillmentMethod: StorefrontOrderFulfillmentMethodV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly totalLabel: string;
  readonly lines: readonly StorefrontOrderTrackingLineV1[];
}

function exactDecimal(integer: string, scale: number): string {
  const negative = integer.startsWith("-");
  const unsigned = negative ? integer.slice(1) : integer;
  const padded = unsigned.padStart(scale + 1, "0");
  const whole = scale === 0 ? padded : padded.slice(0, -scale);
  const fractional = scale === 0 ? "" : padded.slice(-scale);
  return `${negative ? "-" : ""}${whole}${scale === 0 ? "" : `.${fractional}`}`;
}

export function formatStorefrontMoneyExactV1(value: StorefrontMoneyV1): string {
  return `${value.currency} ${exactDecimal(value.minor, value.scale)}`;
}

function formatQuantityExactV1(line: StorefrontOrderLineV1): string {
  return `${exactDecimal(line.quantity.amount, line.quantity.scale)} ${line.quantity.unit}`;
}

function trackingState(detail: StorefrontOrderDetailV1): StorefrontOrderTrackingStateV1 {
  if (detail.orderStatus === "cancelled" || detail.fulfillmentStatus === "cancelled") {
    return "cancelled";
  }
  if (detail.returnStatus === "returned") return "returned";
  if (detail.paymentStatus === "refunded") return "refunded";
  if (
    detail.orderStatus === "on_hold" ||
    detail.returnStatus === "partially_returned" ||
    detail.paymentStatus === "partially_refunded"
  ) {
    return "attention";
  }
  if (detail.orderStatus === "completed" || detail.fulfillmentStatus === "fulfilled") {
    return "complete";
  }
  if (
    detail.orderStatus === "confirmed" ||
    detail.fulfillmentStatus === "partially_fulfilled" ||
    detail.paymentStatus === "paid" ||
    detail.paymentStatus === "partially_paid"
  ) {
    return "in_progress";
  }
  return "pending";
}

export function deriveStorefrontOrderTrackingV1(
  value: unknown,
): StorefrontOrderTrackingViewV1 {
  const detail = parseStorefrontOrderDetailV1(value);
  const lines = detail.lines.map((line) =>
    Object.freeze({
      lineId: line.lineId,
      productId: line.productId,
      variantId: line.variantId,
      label: line.displayName ?? line.sku ?? line.productId,
      sku: line.sku,
      quantityLabel: formatQuantityExactV1(line),
      totalLabel: formatStorefrontMoneyExactV1(line.total),
    }),
  );
  return Object.freeze({
    viewVersion: "storefront-order-tracking-view.v1",
    orderId: detail.orderId,
    documentNumber: detail.documentNumber,
    orderRevision: detail.orderRevision,
    state: trackingState(detail),
    orderStatus: detail.orderStatus,
    paymentStatus: detail.paymentStatus,
    fulfillmentStatus: detail.fulfillmentStatus,
    returnStatus: detail.returnStatus,
    fulfillmentMethod: detail.fulfillmentMethod,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    totalLabel: formatStorefrontMoneyExactV1(detail.total),
    lines: Object.freeze(lines),
  });
}
