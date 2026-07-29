import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { addMoney, compareMoney, money, subtractMoney, type Money } from "../../../packages/foundation/src/money.js";

export type CashEventType = "opening_float" | "cash_sale" | "cash_refund" | "paid_in" | "paid_out" | "safe_drop";

export interface CashEvent {
  readonly eventId: string;
  readonly shiftId: string;
  readonly registerId: string;
  readonly type: CashEventType;
  readonly amount: Money;
  readonly occurredAt: string;
  readonly sourceReference: string;
}

export interface CashReconciliation {
  readonly expected: Money;
  readonly counted: Money;
  readonly variance: Money;
  readonly balanced: boolean;
}

function isIncrease(type: CashEventType): boolean {
  return type === "opening_float" || type === "cash_sale" || type === "paid_in";
}

export function appendCashEvent(events: readonly CashEvent[], event: CashEvent): readonly CashEvent[] {
  const duplicate = events.find((existing) => existing.eventId === event.eventId);
  if (duplicate) {
    throw new PlatformError("IDEMPOTENCY_CONFLICT", "Cash event ID already exists", 409, { eventId: event.eventId });
  }
  if (event.amount.amountMinor <= 0n) {
    throw new PlatformError("VALIDATION_FAILED", "Cash event amount must be positive", 400);
  }
  const differentShift = events.find((existing) => existing.shiftId !== event.shiftId || existing.registerId !== event.registerId);
  if (differentShift) {
    throw new PlatformError("CONFLICT", "Cash ledger reconstruction cannot mix shifts or registers", 409);
  }
  return Object.freeze([...events, Object.freeze(event)]);
}

export function reconstructExpectedCash(events: readonly CashEvent[], currency: string, scale = 2): Money {
  let expected = money(0n, currency, scale);
  for (const event of events) {
    if (event.amount.amountMinor <= 0n) {
      throw new PlatformError("VALIDATION_FAILED", "Cash event amount must be positive", 400, { eventId: event.eventId });
    }
    expected = isIncrease(event.type) ? addMoney(expected, event.amount) : subtractMoney(expected, event.amount);
  }
  return expected;
}

export function reconcileCash(expected: Money, counted: Money): CashReconciliation {
  const variance = subtractMoney(counted, expected);
  return Object.freeze({ expected, counted, variance, balanced: compareMoney(variance, money(0n, variance.currency, variance.scale)) === 0 });
}
