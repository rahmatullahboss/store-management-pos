import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { TransactionClient } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";

const EXACT_INTEGER = /^(?:0|[1-9]\d*)$/u;

function exactInteger(value: string, field: string, allowZero = true): bigint {
  if (!EXACT_INTEGER.test(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be an exact non-negative integer string`, 400);
  const parsed = BigInt(value);
  if (!allowZero && parsed === 0n) throw new PlatformError("VALIDATION_FAILED", `${field} must be positive`, 400);
  return parsed;
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

type ShiftRow = Record<string, unknown> & {
  readonly id: string;
  readonly store_id: string;
  readonly register_id: string;
  readonly pos_session_id: string;
  readonly business_date: string;
  readonly currency: string;
  readonly scale: number;
  readonly status: string;
  readonly version: string;
};

type EventRow = Record<string, unknown> & {
  readonly id: string;
  readonly event_type: string;
  readonly currency: string;
  readonly scale: number;
  readonly amount_minor: string;
  readonly source_type: string;
  readonly source_id: string;
  readonly reversal_of_event_id: string | null;
  readonly idempotency_key: string;
  readonly request_hash: string;
};

export class CashSqlRepository {
  async openShift(client: TransactionClient, context: RequestContext, input: OpenCashShiftInput): Promise<Record<string, unknown>> {
    const openingFloat = exactInteger(input.openingFloatMinor, "openingFloatMinor");
    const replay = await client.query<ShiftRow>(
      `SELECT id::text,store_id::text,register_id::text,pos_session_id::text,business_date::text,
              currency,scale,status,version::text
       FROM cash.shifts
       WHERE tenant_id=$1::uuid AND pos_session_id=$2::uuid
       FOR UPDATE`,
      [context.tenantId, input.posSessionId],
    );
    const existing = replay.rows[0];
    if (existing) {
      if (existing.store_id !== input.storeId
        || existing.register_id !== input.registerId
        || existing.currency !== input.currency
        || existing.scale !== input.scale) {
        throw new PlatformError("IDEMPOTENCY_CONFLICT", "Cash shift session was replayed with a different scope or currency", 409);
      }
      const openingEventResult = await client.query<EventRow>(
        `SELECT id::text,event_type,currency,scale,amount_minor::text,source_type,source_id,
                reversal_of_event_id::text,idempotency_key,request_hash
         FROM cash.cash_events
         WHERE tenant_id=$1::uuid AND shift_id=$2::uuid AND event_type='opening_float'
         ORDER BY sequence
         LIMIT 1
         FOR SHARE`,
        [context.tenantId, existing.id],
      );
      const openingEvent = openingEventResult.rows[0];
      const sameOpening = openingFloat === 0n
        ? openingEvent === undefined
        : openingEvent !== undefined
          && openingEvent.currency === input.currency
          && openingEvent.scale === input.scale
          && openingEvent.amount_minor === input.openingFloatMinor
          && openingEvent.idempotency_key === input.idempotencyKey
          && openingEvent.request_hash === input.requestHash;
      if (!sameOpening) throw new PlatformError("IDEMPOTENCY_CONFLICT", "Cash shift was replayed with a different opening float", 409);
      return existing;
    }

    const session = await client.query<Record<string, unknown> & {
      readonly store_id: string;
      readonly register_id: string;
      readonly status: string;
    }>(
      `SELECT store_id::text,register_id::text,status
       FROM pos.register_sessions
       WHERE tenant_id=$1::uuid AND id=$2::uuid
       FOR SHARE`,
      [context.tenantId, input.posSessionId],
    );
    const activeSession = session.rows[0];
    if (!activeSession || activeSession.status !== "open") throw new PlatformError("CONFLICT", "POS session must be open before opening cash", 409);
    if (activeSession.store_id !== input.storeId || activeSession.register_id !== input.registerId) {
      throw new PlatformError("PERMISSION_DENIED", "Cash shift is outside the POS session scope", 403);
    }

    const shiftId = input.id ?? uuidV7();
    const created = await client.query<ShiftRow>(
      `INSERT INTO cash.shifts(
         id,tenant_id,store_id,register_id,pos_session_id,business_date,currency,scale,opened_by
       ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::date,$7,$8,$9::uuid)
       RETURNING id::text,store_id::text,register_id::text,pos_session_id::text,business_date::text,
                 currency,scale,status,version::text`,
      [shiftId, context.tenantId, input.storeId, input.registerId, input.posSessionId, context.businessDate, input.currency, input.scale, context.actorId],
    );

    if (openingFloat > 0n) {
      await client.query(
        `INSERT INTO cash.cash_events(
           id,tenant_id,shift_id,event_type,currency,scale,amount_minor,source_type,source_id,
           idempotency_key,request_hash,reason,occurred_at,business_date,actor_id,request_id,trace_id
         ) VALUES(
           $1::uuid,$2::uuid,$3::uuid,'opening_float',$4,$5,$6::bigint,'cash_shift',$3::text,
           $7,$8,'Opening float',$9::timestamptz,$10::date,$11::uuid,$12,$13
         )`,
        [input.openingEventId ?? uuidV7(), context.tenantId, shiftId, input.currency, input.scale, input.openingFloatMinor, input.idempotencyKey, input.requestHash, input.occurredAt, context.businessDate, context.actorId, context.requestId, context.traceId],
      );
    }

    return created.rows[0]!;
  }

  async appendEvent(client: TransactionClient, context: RequestContext, input: AppendCashEventInput): Promise<Record<string, unknown>> {
    exactInteger(input.amountMinor, "amountMinor", false);
    const replay = await client.query<EventRow>(
      `SELECT id::text,event_type,currency,scale,amount_minor::text,source_type,source_id,
              reversal_of_event_id::text,idempotency_key,request_hash
       FROM cash.cash_events
       WHERE tenant_id=$1::uuid AND shift_id=$2::uuid AND idempotency_key=$3
       FOR UPDATE`,
      [context.tenantId, input.shiftId, input.idempotencyKey],
    );
    const existing = replay.rows[0];
    if (existing) {
      const same = existing.event_type === input.eventType
        && existing.currency === input.currency
        && existing.scale === input.scale
        && existing.amount_minor === input.amountMinor
        && existing.source_type === input.sourceType
        && existing.source_id === input.sourceId
        && existing.reversal_of_event_id === (input.reversalOfEventId ?? null)
        && existing.request_hash === input.requestHash;
      if (!same) throw new PlatformError("IDEMPOTENCY_CONFLICT", "Cash event was replayed with different content", 409);
      return existing;
    }

    if (input.eventType === "adjustment_in" || input.eventType === "adjustment_out") {
      if (!input.approvalRequestId) throw new PlatformError("CONFLICT", "Approved cash adjustment is required", 409);
      await this.requireApproval(client, context, input.approvalRequestId, "cash.adjustment", input.shiftId);
    }

    const result = await client.query<EventRow>(
      `INSERT INTO cash.cash_events(
         id,tenant_id,shift_id,event_type,currency,scale,amount_minor,source_type,source_id,
         reversal_of_event_id,idempotency_key,request_hash,reason,occurred_at,business_date,
         actor_id,request_id,trace_id
       ) VALUES(
         $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::bigint,$8,$9,$10::uuid,$11,$12,$13,
         $14::timestamptz,$15::date,$16::uuid,$17,$18
       )
       RETURNING id::text,event_type,currency,scale,amount_minor::text,source_type,source_id,
                 reversal_of_event_id::text,idempotency_key,request_hash`,
      [
        input.id ?? uuidV7(), context.tenantId, input.shiftId, input.eventType, input.currency,
        input.scale, input.amountMinor, input.sourceType, input.sourceId, input.reversalOfEventId ?? null,
        input.idempotencyKey, input.requestHash, input.reason ?? null, input.occurredAt,
        context.businessDate, context.actorId, context.requestId, context.traceId,
      ],
    );
    return result.rows[0]!;
  }

  async closeShift(client: TransactionClient, context: RequestContext, input: CloseCashShiftInput): Promise<Record<string, unknown>> {
    const counted = exactInteger(input.countedMinor, "countedMinor");
    const replay = await client.query<Record<string, unknown>>(
      `SELECT closure.id::text,closure.shift_id::text,closure.expected_minor::text,
              closure.counted_minor::text,closure.variance_minor::text,closure.closed_at::text
       FROM cash.shift_closures closure
       WHERE closure.tenant_id=$1::uuid AND closure.shift_id=$2::uuid`,
      [context.tenantId, input.shiftId],
    );
    if (replay.rows[0]) return replay.rows[0];

    const shiftResult = await client.query<ShiftRow>(
      `SELECT id::text,store_id::text,register_id::text,pos_session_id::text,business_date::text,
              currency,scale,status,version::text
       FROM cash.shifts
       WHERE tenant_id=$1::uuid AND id=$2::uuid
       FOR UPDATE`,
      [context.tenantId, input.shiftId],
    );
    const shift = shiftResult.rows[0];
    if (!shift) throw new PlatformError("NOT_FOUND", "Cash shift not found", 404);
    if (!["open", "reopened"].includes(shift.status)) throw new PlatformError("CONFLICT", "Cash shift is not open", 409);
    if (shift.currency !== input.currency || shift.scale !== input.scale) throw new PlatformError("VALIDATION_FAILED", "Cash count currency and scale must match the shift", 400);

    const expectedResult = await client.query<Record<string, unknown> & { readonly expected_minor: string }>(
      `SELECT expected_minor::text
       FROM cash.shift_expected_cash
       WHERE tenant_id=$1::uuid AND shift_id=$2::uuid`,
      [context.tenantId, input.shiftId],
    );
    const expected = BigInt(expectedResult.rows[0]?.expected_minor ?? "0");
    const variance = counted - expected;
    if (variance !== 0n) {
      if (!input.approvalRequestId) throw new PlatformError("CONFLICT", "Approved cash variance is required", 409);
      await this.requireApproval(client, context, input.approvalRequestId, "cash.variance", input.shiftId);
    }

    const countId = input.cashCountId ?? uuidV7();
    const closureId = input.closureId ?? uuidV7();
    await client.query(
      `INSERT INTO cash.cash_counts(
         id,tenant_id,shift_id,count_type,currency,scale,counted_minor,denomination_breakdown,
         counted_by,counted_at,request_id,trace_id
       ) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::bigint,$8::jsonb,$9::uuid,$10::timestamptz,$11,$12)`,
      [countId, context.tenantId, input.shiftId, input.countType, input.currency, input.scale, input.countedMinor, JSON.stringify(input.denominationBreakdown), context.actorId, input.closedAt, context.requestId, context.traceId],
    );
    const closure = await client.query<Record<string, unknown>>(
      `INSERT INTO cash.shift_closures(
         id,tenant_id,shift_id,cash_count_id,currency,scale,expected_minor,counted_minor,
         variance_minor,approval_request_id,closed_by,closed_at,request_id,trace_id
       ) VALUES(
         $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::bigint,$8::bigint,
         $9::bigint,$10::uuid,$11::uuid,$12::timestamptz,$13,$14
       )
       RETURNING id::text,shift_id::text,expected_minor::text,counted_minor::text,
                 variance_minor::text,closed_at::text`,
      [closureId, context.tenantId, input.shiftId, countId, input.currency, input.scale, expected.toString(), input.countedMinor, variance.toString(), input.approvalRequestId ?? null, context.actorId, input.closedAt, context.requestId, context.traceId],
    );
    await client.query(
      `UPDATE cash.shifts
       SET status='closed',closed_by=$3::uuid,closed_at=$4::timestamptz,
           approval_request_id=$5::uuid,version=version+1
       WHERE tenant_id=$1::uuid AND id=$2::uuid`,
      [context.tenantId, input.shiftId, context.actorId, input.closedAt, input.approvalRequestId ?? null],
    );
    return closure.rows[0]!;
  }

  async listShiftEvents(client: TransactionClient, context: RequestContext, shiftId: string, limit = 100): Promise<readonly Record<string, unknown>[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new PlatformError("VALIDATION_FAILED", "limit must be between 1 and 500", 400);
    const result = await client.query(
      `SELECT id::text,event_type,currency,scale,amount_minor::text,source_type,source_id,
              reversal_of_event_id::text,idempotency_key,reason,occurred_at::text,business_date::text,sequence::text
       FROM cash.cash_events
       WHERE tenant_id=$1::uuid AND shift_id=$2::uuid
       ORDER BY sequence,id
       LIMIT $3`,
      [context.tenantId, shiftId, limit],
    );
    return result.rows;
  }

  private async requireApproval(client: TransactionClient, context: RequestContext, approvalRequestId: string, targetType: string, targetId: string): Promise<void> {
    const approval = await client.query(
      `SELECT id
       FROM platform.approval_requests
       WHERE tenant_id=$1::uuid AND id=$2::uuid AND status='approved'
         AND target_type=$3 AND target_id=$4
         AND (expires_at IS NULL OR expires_at > now())
       FOR SHARE`,
      [context.tenantId, approvalRequestId, targetType, targetId],
    );
    if (approval.rowCount !== 1) throw new PlatformError("CONFLICT", "Valid approved cash authorization is required", 409);
  }
}
