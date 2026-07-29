import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { TransactionClient } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";

const EXACT_INTEGER = /^(?:0|[1-9]\d*)$/u;
const EXACT_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;

function exactInteger(value: string, field: string, allowZero = true): bigint {
  if (!EXACT_INTEGER.test(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be an exact non-negative integer string`, 400);
  const parsed = BigInt(value);
  if (!allowZero && parsed === 0n) throw new PlatformError("VALIDATION_FAILED", `${field} must be positive`, 400);
  return parsed;
}

function exactDecimal(value: string, field: string): string {
  if (!EXACT_DECIMAL.test(value) || !/[1-9]/u.test(value)) {
    throw new PlatformError("VALIDATION_FAILED", `${field} must be an exact positive decimal string`, 400);
  }
  return value;
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new PlatformError("VALIDATION_FAILED", `${field} must be a valid timestamp`, 400);
  return parsed;
}

export interface PosDeviceEnrollmentInput {
  readonly id?: string;
  readonly storeId: string;
  readonly registerId?: string;
  readonly deviceKey: string;
  readonly displayName: string;
  readonly capabilities: Readonly<Record<string, unknown>>;
}

export interface PosSessionInput {
  readonly id?: string;
  readonly storeId: string;
  readonly registerId: string;
  readonly deviceId: string;
}

export interface PosCartLineInput {
  readonly id?: string;
  readonly lineNumber: number;
  readonly variantReference: string;
  readonly quantity: string;
  readonly unitPriceMinor: string;
  readonly discountMinor: string;
  readonly taxMinor: string;
  readonly priceSnapshot: Readonly<Record<string, unknown>>;
  readonly taxSnapshot: Readonly<Record<string, unknown>>;
}

export interface PosCartInput {
  readonly id?: string;
  readonly sessionId: string;
  readonly customerReference?: string;
  readonly currency: string;
  readonly scale: number;
  readonly lines: readonly PosCartLineInput[];
}

export interface PosCheckoutInput {
  readonly id?: string;
  readonly storeId: string;
  readonly registerId: string;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly cartId: string;
  readonly operationId: string;
  readonly requestHash: string;
  readonly mode: "online" | "offline";
  readonly currency: string;
  readonly scale: number;
  readonly subtotalMinor: string;
  readonly discountMinor: string;
  readonly taxMinor: string;
  readonly totalMinor: string;
  readonly paymentState: "not_required" | "accepted" | "captured" | "unknown" | "declined";
  readonly cartSnapshot: Readonly<Record<string, unknown>>;
  readonly tenderSnapshot: readonly Readonly<Record<string, unknown>>[];
  readonly occurredAt: string;
  readonly committedAt: string;
}

export interface OfflineOperationUploadInput {
  readonly id?: string;
  readonly deviceId: string;
  readonly registerId: string;
  readonly authorizationId: string;
  readonly operationId: string;
  readonly deviceSequence: string;
  readonly operationType: "checkout" | "cash_event" | "shift_open" | "shift_close" | "receipt_delivery" | "device_health";
  readonly aggregateId: string;
  readonly aggregateVersion: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadHash: string;
  readonly recordedAt: string;
  readonly localSchemaVersion: string;
  readonly appVersion: string;
}

type CheckoutRow = Record<string, unknown> & {
  readonly id: string;
  readonly operation_id: string;
  readonly request_hash: string;
  readonly payment_state: string;
  readonly status: string;
  readonly version: string;
};

type OfflineReplayRow = Record<string, unknown> & {
  readonly id: string;
  readonly register_id: string;
  readonly authorization_id: string;
  readonly device_sequence: string;
  readonly operation_type: string;
  readonly aggregate_id: string;
  readonly aggregate_version: string;
  readonly payload_hash: string;
  readonly recorded_at: string;
  readonly local_schema_version: string;
  readonly app_version: string;
};

function sameOfflineEnvelope(existing: OfflineReplayRow, operation: OfflineOperationUploadInput): boolean {
  return existing.register_id === operation.registerId
    && existing.authorization_id === operation.authorizationId
    && existing.device_sequence === operation.deviceSequence
    && existing.operation_type === operation.operationType
    && existing.aggregate_id === operation.aggregateId
    && existing.aggregate_version === operation.aggregateVersion
    && existing.payload_hash === operation.payloadHash
    && timestamp(existing.recorded_at, "existing.recordedAt") === timestamp(operation.recordedAt, "recordedAt")
    && existing.local_schema_version === operation.localSchemaVersion
    && existing.app_version === operation.appVersion;
}

export class PosSqlRepository {
  async enrollDevice(client: TransactionClient, _context: RequestContext, input: PosDeviceEnrollmentInput): Promise<Record<string, unknown>> {
    const result = await client.query(
      `SELECT id::text,store_id::text,register_id::text,device_key,status,version::text,replayed
       FROM pos.enroll_device_v1($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::jsonb)`,
      [input.id ?? uuidV7(), input.storeId, input.registerId ?? null, input.deviceKey, input.displayName, JSON.stringify(input.capabilities)],
    );
    return result.rows[0]!;
  }

  async openSession(client: TransactionClient, _context: RequestContext, input: PosSessionInput): Promise<Record<string, unknown>> {
    const result = await client.query(
      `SELECT id::text,store_id::text,register_id::text,device_id::text,status,business_date::text,version::text,replayed
       FROM pos.open_session_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid)`,
      [input.id ?? uuidV7(), input.storeId, input.registerId, input.deviceId],
    );
    return result.rows[0]!;
  }

  async createCart(client: TransactionClient, _context: RequestContext, input: PosCartInput): Promise<Record<string, unknown>> {
    if (input.lines.length === 0 || input.lines.length > 1_000) throw new PlatformError("VALIDATION_FAILED", "POS cart requires 1 to 1000 lines", 400);
    const normalizedLines = input.lines.map((line) => {
      const quantity = exactDecimal(line.quantity, "line.quantity");
      const unitPriceMinor = exactInteger(line.unitPriceMinor, "line.unitPriceMinor");
      const discountMinor = exactInteger(line.discountMinor, "line.discountMinor");
      exactInteger(line.taxMinor, "line.taxMinor");
      if (discountMinor > unitPriceMinor * BigInt(quantity.split(".")[0] ?? "0") && !quantity.includes(".")) {
        throw new PlatformError("VALIDATION_FAILED", "Cart line discount exceeds the exact line gross", 400);
      }
      return {
        id: line.id ?? uuidV7(),
        lineNumber: line.lineNumber,
        variantReference: line.variantReference,
        quantity,
        unitPriceMinor: line.unitPriceMinor,
        discountMinor: line.discountMinor,
        taxMinor: line.taxMinor,
        priceSnapshot: line.priceSnapshot,
        taxSnapshot: line.taxSnapshot,
      };
    });
    const result = await client.query(
      `SELECT id::text,status,version::text,line_count,replayed
       FROM pos.create_cart_v1($1::uuid,$2::uuid,$3,$4::char(3),$5::smallint,$6::jsonb)`,
      [input.id ?? uuidV7(), input.sessionId, input.customerReference ?? null, input.currency, input.scale, JSON.stringify(normalizedLines)],
    );
    return result.rows[0]!;
  }

  async recordCheckout(client: TransactionClient, context: RequestContext, input: PosCheckoutInput): Promise<Record<string, unknown>> {
    const subtotal = exactInteger(input.subtotalMinor, "subtotalMinor");
    const discount = exactInteger(input.discountMinor, "discountMinor");
    const tax = exactInteger(input.taxMinor, "taxMinor");
    const total = exactInteger(input.totalMinor, "totalMinor");
    if (discount > subtotal || total !== subtotal - discount + tax) {
      throw new PlatformError("VALIDATION_FAILED", "Checkout exact totals are inconsistent", 400);
    }
    if (total > 0n && input.paymentState === "not_required") {
      throw new PlatformError("VALIDATION_FAILED", "Positive checkout total requires a payment state", 400);
    }
    const occurredAt = timestamp(input.occurredAt, "occurredAt");
    const committedAt = timestamp(input.committedAt, "committedAt");
    if (committedAt < occurredAt) throw new PlatformError("VALIDATION_FAILED", "Durable commit time cannot precede operation time", 400);

    const replay = await client.query<CheckoutRow>(
      `SELECT id::text,operation_id,request_hash,payment_state,status,version::text
       FROM pos.checkout_operations
       WHERE tenant_id=$1::uuid AND device_id=$2::uuid AND operation_id=$3`,
      [context.tenantId, input.deviceId, input.operationId],
    );
    const existing = replay.rows[0];
    if (existing) {
      if (existing.request_hash !== input.requestHash) throw new PlatformError("IDEMPOTENCY_CONFLICT", "Checkout operation was replayed with different content", 409);
      return existing;
    }

    const result = await client.query(
      `SELECT id::text,operation_id,request_hash,payment_state,status,version::text,replayed
       FROM pos.record_checkout_v1(
         $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10::char(3),
         $11::smallint,$12::bigint,$13::bigint,$14::bigint,$15::bigint,$16,$17::jsonb,$18::jsonb,
         $19::timestamptz,$20::timestamptz
       )`,
      [
        input.id ?? uuidV7(), input.storeId, input.registerId, input.deviceId, input.sessionId,
        input.cartId, input.operationId, input.requestHash, input.mode, input.currency, input.scale,
        input.subtotalMinor, input.discountMinor, input.taxMinor, input.totalMinor, input.paymentState,
        JSON.stringify(input.cartSnapshot), JSON.stringify(input.tenderSnapshot), input.occurredAt, input.committedAt,
      ],
    );
    return result.rows[0]!;
  }

  async uploadOfflineOperations(
    client: TransactionClient,
    context: RequestContext,
    operations: readonly OfflineOperationUploadInput[],
  ): Promise<readonly Record<string, unknown>[]> {
    if (operations.length === 0 || operations.length > 500) throw new PlatformError("VALIDATION_FAILED", "Offline sync batch must contain 1 to 500 operations", 400);
    const outcomes: Record<string, unknown>[] = [];

    for (const operation of operations) {
      exactInteger(operation.deviceSequence, "deviceSequence", false);
      exactInteger(operation.aggregateVersion, "aggregateVersion");
      timestamp(operation.recordedAt, "recordedAt");
      const replay = await client.query<OfflineReplayRow>(
        `SELECT id::text,register_id::text,authorization_id::text,device_sequence::text,
                operation_type,aggregate_id,aggregate_version::text,payload_hash,
                recorded_at::text,local_schema_version,app_version
         FROM pos.offline_operations
         WHERE tenant_id=$1::uuid AND device_id=$2::uuid AND operation_id=$3`,
        [context.tenantId, operation.deviceId, operation.operationId],
      );
      const existing = replay.rows[0];
      if (existing) {
        if (!sameOfflineEnvelope(existing, operation)) {
          throw new PlatformError("IDEMPOTENCY_CONFLICT", "Offline operation was replayed with different envelope content", 409);
        }
        outcomes.push({ operationId: operation.operationId, status: "duplicate", offlineOperationId: existing.id });
        continue;
      }

      const result = await client.query<Record<string, unknown> & {
        readonly status: string;
        readonly offline_operation_id: string | null;
        readonly reason_code: string | null;
        readonly replayed: boolean;
      }>(
        `SELECT status,offline_operation_id::text,reason_code,replayed
         FROM pos.register_offline_operation_v1(
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::bigint,$7,$8,$9::bigint,
           $10::jsonb,$11,$12::timestamptz,$13,$14
         )`,
        [
          operation.id ?? uuidV7(), operation.deviceId, operation.registerId, operation.authorizationId,
          operation.operationId, operation.deviceSequence, operation.operationType, operation.aggregateId,
          operation.aggregateVersion, JSON.stringify(operation.payload), operation.payloadHash,
          operation.recordedAt, operation.localSchemaVersion, operation.appVersion,
        ],
      );
      const outcome = result.rows[0]!;
      outcomes.push({
        operationId: operation.operationId,
        status: outcome.status,
        ...(outcome.offline_operation_id ? { offlineOperationId: outcome.offline_operation_id } : {}),
        ...(outcome.reason_code ? { reasonCode: outcome.reason_code } : {}),
      });
    }
    return outcomes;
  }

  async listReconciliation(client: TransactionClient, context: RequestContext, limit = 100): Promise<readonly Record<string, unknown>[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new PlatformError("VALIDATION_FAILED", "limit must be between 1 and 500", 400);
    const result = await client.query(
      `SELECT o.id::text AS offline_operation_id,o.operation_id,o.device_sequence::text,o.operation_type,
              outcome.status,outcome.business_effect_ids,outcome.reason_code,outcome.reason_message,
              outcome.observed_at::text
       FROM pos.offline_operations o
       LEFT JOIN pos.offline_operation_outcomes outcome
         ON outcome.tenant_id=o.tenant_id AND outcome.offline_operation_id=o.id
       WHERE o.tenant_id=$1::uuid
         AND (outcome.id IS NULL OR outcome.status IN ('rejected','review_required','deferred'))
       ORDER BY o.device_sequence,o.id
       LIMIT $2`,
      [context.tenantId, limit],
    );
    return result.rows;
  }
}
