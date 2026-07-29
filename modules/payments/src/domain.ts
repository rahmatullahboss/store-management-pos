import { addMoney, money, subtractMoney, type Money } from "../../../packages/foundation/src/money.js";

export type PaymentStatus =
  | "created"
  | "requires_action"
  | "authorized"
  | "captured"
  | "declined"
  | "cancelled"
  | "unknown"
  | "partially_refunded"
  | "refunded"
  | "charged_back";

export type PaymentCommand =
  | "require_action"
  | "authorize"
  | "capture"
  | "void"
  | "decline"
  | "mark_unknown"
  | "refund_partial"
  | "refund_full"
  | "chargeback"
  | "recover_status"
  | "recover_authorized"
  | "recover_captured"
  | "recover_declined"
  | "recover_cancelled";

const TRANSITIONS: Readonly<Partial<Record<PaymentStatus, Readonly<Partial<Record<PaymentCommand, PaymentStatus>>>>>> = {
  created: {
    require_action: "requires_action",
    authorize: "authorized",
    decline: "declined",
    mark_unknown: "unknown",
    recover_status: "created",
  },
  requires_action: {
    authorize: "authorized",
    decline: "declined",
    mark_unknown: "unknown",
    recover_status: "requires_action",
  },
  authorized: {
    capture: "captured",
    void: "cancelled",
    mark_unknown: "unknown",
    recover_status: "authorized",
  },
  captured: {
    refund_partial: "partially_refunded",
    refund_full: "refunded",
    chargeback: "charged_back",
    mark_unknown: "unknown",
    recover_status: "captured",
  },
  partially_refunded: {
    refund_partial: "partially_refunded",
    refund_full: "refunded",
    chargeback: "charged_back",
    mark_unknown: "unknown",
    recover_status: "partially_refunded",
  },
  unknown: {
    recover_status: "unknown",
    recover_authorized: "authorized",
    recover_captured: "captured",
    recover_declined: "declined",
    recover_cancelled: "cancelled",
  },
};

export function assertPaymentCommandAllowed(status: PaymentStatus, command: PaymentCommand): void {
  if (status === "unknown" && !command.startsWith("recover_")) {
    throw new TypeError("Payment is in an unknown state; status recovery is required before another provider command");
  }
  if (TRANSITIONS[status]?.[command] === undefined) {
    throw new TypeError(`Invalid payment transition: ${status} -> ${command}`);
  }
}

export function transitionPayment(status: PaymentStatus, command: PaymentCommand): PaymentStatus {
  assertPaymentCommandAllowed(status, command);
  return TRANSITIONS[status]?.[command] as PaymentStatus;
}

export function availableRefundAmount(captured: Money, refunded: Money): Money {
  if (captured.amountMinor < 0n || refunded.amountMinor < 0n) throw new RangeError("Captured and refunded amounts cannot be negative");
  const available = subtractMoney(captured, refunded);
  if (available.amountMinor < 0n) throw new RangeError("Refunded amount cannot exceed captured amount");
  return available;
}

export interface SettlementAmounts {
  readonly gross: Money;
  readonly fees: Money;
  readonly adjustments: Money;
}

export function calculateSettlementNet(input: SettlementAmounts): Money {
  if (input.gross.amountMinor < 0n || input.fees.amountMinor < 0n) throw new RangeError("Settlement gross and fees cannot be negative");
  return subtractMoney(subtractMoney(input.gross, input.fees), input.adjustments);
}

export function assertRefundRequest(input: { readonly captured: Money; readonly refunded: Money; readonly requested: Money }): void {
  const available = availableRefundAmount(input.captured, input.refunded);
  if (input.requested.amountMinor <= 0n) throw new RangeError("Refund amount must be positive");
  const remaining = subtractMoney(available, input.requested);
  if (remaining.amountMinor < 0n) throw new RangeError("Refund request exceeds the available captured amount");
}

export function zeroMoneyLike(value: Money): Money {
  return money(0n, value.currency, value.scale);
}

export function totalAllocatedAmount(amounts: readonly Money[], currency: string, scale: number): Money {
  return amounts.reduce((total, amount) => addMoney(total, amount), money(0n, currency, scale));
}
