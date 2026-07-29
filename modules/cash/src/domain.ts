import { addMoney, money, subtractMoney, type Money } from "../../../packages/foundation/src/money.js";

export type CashEventKind =
  | "opening_float"
  | "cash_sale"
  | "cash_refund"
  | "paid_in"
  | "paid_out"
  | "safe_drop"
  | "adjustment_in"
  | "adjustment_out";

export interface CashEventInput {
  readonly eventId: string;
  readonly shiftId: string;
  readonly kind: CashEventKind;
  readonly amount: Money;
  readonly requestHash: string;
  readonly occurredAt: string;
}

export interface CashEventRecord extends CashEventInput {
  readonly sequence: bigint;
}

export interface AppendCashEventResult {
  readonly event: CashEventRecord;
  readonly replayed: boolean;
}

export interface CashShiftSummary {
  readonly shiftId: string;
  readonly expectedCash: Money;
  readonly countedCash: Money;
  readonly variance: Money;
  readonly closedAt: string;
  readonly approvedBy?: string;
  readonly eventCount: number;
}

const POSITIVE_EVENTS: ReadonlySet<CashEventKind> = new Set<CashEventKind>([
  "opening_float",
  "cash_sale",
  "paid_in",
  "adjustment_in",
]);

function assertRequired(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`${field} is required`);
}

function sameEvent(left: CashEventRecord, right: CashEventInput): boolean {
  return left.eventId === right.eventId
    && left.shiftId === right.shiftId
    && left.kind === right.kind
    && left.amount.amountMinor === right.amount.amountMinor
    && left.amount.currency === right.amount.currency
    && left.amount.scale === right.amount.scale
    && left.requestHash === right.requestHash
    && left.occurredAt === right.occurredAt;
}

export function cashEventEffect(event: CashEventInput): Money {
  if (event.amount.amountMinor <= 0n) throw new RangeError("Cash event amount must be positive");
  return POSITIVE_EVENTS.has(event.kind)
    ? event.amount
    : money(-event.amount.amountMinor, event.amount.currency, event.amount.scale);
}

export class CashShiftLedger {
  readonly #events: CashEventRecord[] = [];
  readonly #byId = new Map<string, CashEventRecord>();
  #summary: CashShiftSummary | undefined;

  constructor(
    readonly shiftId: string,
    readonly currency: string,
    readonly scale = 2,
  ) {
    assertRequired(shiftId, "shiftId");
    money(0n, currency, scale);
  }

  append(input: CashEventInput): AppendCashEventResult {
    assertRequired(input.eventId, "eventId");
    assertRequired(input.requestHash, "requestHash");
    assertRequired(input.occurredAt, "occurredAt");
    if (input.shiftId !== this.shiftId) throw new TypeError("Cash event belongs to another shift");

    const existing = this.#byId.get(input.eventId);
    if (existing) {
      if (!sameEvent(existing, input)) throw new TypeError(`Cash event ${input.eventId} was replayed with different content`);
      return Object.freeze({ event: existing, replayed: true });
    }
    if (this.#summary) throw new TypeError(`Cash shift ${this.shiftId} is closed`);

    addMoney(money(0n, this.currency, this.scale), input.amount);
    cashEventEffect(input);
    const event: CashEventRecord = Object.freeze({
      ...input,
      sequence: BigInt(this.#events.length + 1),
    });
    this.#events.push(event);
    this.#byId.set(event.eventId, event);
    return Object.freeze({ event, replayed: false });
  }

  expectedCash(): Money {
    return this.#events.reduce(
      (total, event) => addMoney(total, cashEventEffect(event)),
      money(0n, this.currency, this.scale),
    );
  }

  close(countedCash: Money, closedAt: string, approvedBy?: string): CashShiftSummary {
    if (this.#summary) {
      if (this.#summary.countedCash.amountMinor !== countedCash.amountMinor
        || this.#summary.countedCash.currency !== countedCash.currency
        || this.#summary.countedCash.scale !== countedCash.scale) {
        throw new TypeError(`Cash shift ${this.shiftId} is already closed with a different count`);
      }
      return this.#summary;
    }
    assertRequired(closedAt, "closedAt");
    const expectedCash = this.expectedCash();
    const variance = subtractMoney(countedCash, expectedCash);
    if (variance.amountMinor !== 0n && !approvedBy) throw new TypeError("Cash variance requires approval");

    this.#summary = Object.freeze({
      shiftId: this.shiftId,
      expectedCash,
      countedCash,
      variance,
      closedAt,
      ...(approvedBy === undefined ? {} : { approvedBy }),
      eventCount: this.#events.length,
    });
    return this.#summary;
  }

  events(): readonly CashEventRecord[] {
    return Object.freeze([...this.#events]);
  }

  summary(): CashShiftSummary | undefined {
    return this.#summary;
  }
}
