import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { TransactionClient } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";

const EXACT_INTEGER = /^(?:0|[1-9]\d*)$/u;

function exactInteger(value: string, field: string, allowZero = true): bigint {
  if (!EXACT_INTEGER.test(value)) {
    throw new PlatformError("VALIDATION_FAILED", `${field} must be an exact non-negative integer string`, 400);
  }
  const parsed = BigInt(value);
  if (!allowZero && parsed === 0n) {
    throw new PlatformError("VALIDATION_FAILED", `${field} must be positive`, 400);
  }
  return parsed;
}

function timestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new PlatformError("VALIDATION_FAILED", `${field} must be a valid timestamp`, 400);
  }
}

export type CashLedgerEventType =
  | "cash_sale"
  | "cash_refund"
  | "paid_in"
  | "paid_out"
  | "safe_drop"
  | "adjustment_in"
  | "adjustment_out";

export interface OpenCashShiftInput {
  readonly id?: string;
  readonly storeId: string;
  readonly registerId: string;
  readonly posSessionId: string;
  readonly currency: string;
  readonly scale: number;
  readonly openingFloatMinor: string;
  readonly openingEventId?: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly occurredAt: string;
}

export interface AppendCashEventInput {
  readonly id?: string;
  readonly shiftId: string;
  readonly eventType: CashLedgerEventType;
  readonly currency: string;
  readonly scale: number;
  readonly amountMinor: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly reversalOfEventId?: string;
  readonly approvalRequestId?: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly reason?: string;
  readonly occurredAt: string;
}

export interface CloseCashShiftInput {
  readonly shiftId: string;
  readonly cashCountId?: string;
  readonly closureId?: string;
  readonly countType: "blind_close" | "recount" | "audit";
  readonly currency: string;
  readonly scale: number;
  readonly countedMinor: string;
  readonly denominationBreakdown: Readonly<Record<string, unknown>>;
  readonly approvalRequestId?: string;
  readonly closedAt: string;
}

export class CashSqlRepository {
  async openShift(
    client: TransactionClient,
    _context: RequestContext,
    input: OpenCashShiftInput,
  ): Promise<Record<string, unknown>> {
    const openingFloat = exactInteger(input.openingFloatMinor, "openingFloatMinor");
    timestamp(input.occurredAt, "occurredAt");
    const openingEventId = openingFloat > 0n ? (input.openingEventId ?? uuidV7()) : null;
    const result = await client.query(
      `SELECT id::text,store_id::text,register_id::text,pos_session_id::text,
              business_date::text,currency,scale,status,version::text,replayed
       FROM cash.open_shift_v1(
         $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::char(3),$6::smallint,
         $7::bigint,$8::uuid,$9,$10,$11::timestamptz
       )`,
      [
        input.id ?? uuidV7(),
        input.storeId,
        input.registerId,
        input.posSessionId,
        input.currency,
        input.scale,
        input.openingFloatMinor,
        openingEventId,
        input.idempotencyKey,
        input.requestHash,
        input.occurredAt,
      ],
    );
    return result.rows[0]!;
  }

  async appendEvent(
    client: TransactionClient,
    _context: RequestContext,
    input: AppendCashEventInput,
  ): Promise<Record<string, unknown>> {
    exactInteger(input.amountMinor, "amountMinor", false);
    timestamp(input.occurredAt, "occurredAt");
    const result = await client.query(
      `SELECT id::text,event_type,currency,scale,amount_minor::text,source_type,
              source_id,reversal_of_event_id::text,idempotency_key,request_hash,replayed
       FROM cash.append_event_v1(
         $1::uuid,$2::uuid,$3,$4::char(3),$5::smallint,$6::bigint,$7,$8,
         $9::uuid,$10::uuid,$11,$12,$13,$14::timestamptz
       )`,
      [
        input.id ?? uuidV7(),
        input.shiftId,
        input.eventType,
        input.currency,
        input.scale,
        input.amountMinor,
        input.sourceType,
        input.sourceId,
        input.reversalOfEventId ?? null,
        input.approvalRequestId ?? null,
        input.idempotencyKey,
        input.requestHash,
        input.reason ?? null,
        input.occurredAt,
      ],
    );
    return result.rows[0]!;
  }

  async closeShift(
    client: TransactionClient,
    _context: RequestContext,
    input: CloseCashShiftInput,
  ): Promise<Record<string, unknown>> {
    exactInteger(input.countedMinor, "countedMinor");
    timestamp(input.closedAt, "closedAt");
    const result = await client.query(
      `SELECT id::text,shift_id::text,expected_minor::text,counted_minor::text,
              variance_minor::text,closed_at::text,replayed
       FROM cash.close_shift_v1(
         $1::uuid,$2::uuid,$3::uuid,$4,$5::char(3),$6::smallint,
         $7::bigint,$8::jsonb,$9::uuid,$10::timestamptz
       )`,
      [
        input.cashCountId ?? uuidV7(),
        input.closureId ?? uuidV7(),
        input.shiftId,
        input.countType,
        input.currency,
        input.scale,
        input.countedMinor,
        JSON.stringify(input.denominationBreakdown),
        input.approvalRequestId ?? null,
        input.closedAt,
      ],
    );
    return result.rows[0]!;
  }

  async listShiftEvents(
    client: TransactionClient,
    context: RequestContext,
    shiftId: string,
    limit = 100,
  ): Promise<readonly Record<string, unknown>[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new PlatformError("VALIDATION_FAILED", "limit must be between 1 and 500", 400);
    }
    const result = await client.query(
      `SELECT id::text,event_type,currency,scale,amount_minor::text,source_type,source_id,
              reversal_of_event_id::text,idempotency_key,reason,occurred_at::text,
              business_date::text,sequence::text
       FROM cash.cash_events
       WHERE tenant_id=$1::uuid AND shift_id=$2::uuid
       ORDER BY sequence,id
       LIMIT $3`,
      [context.tenantId, shiftId, limit],
    );
    return result.rows;
  }
}
