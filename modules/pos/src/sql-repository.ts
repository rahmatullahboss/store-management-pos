import type { RequestContext } from "../../packages/foundation/src/context.js";
import type { TransactionClient } from "../../packages/foundation/src/db.js";
import { PlatformError } from "../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../packages/foundation/src/ids.js";

const EXACT_INTEGER = /^(?:0|[1-9]\d*)$/u;
const EXACT_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;

function exactInteger(value: string, field: string, allowZero = true): bigint {
  if (!EXACT_INTEGER.test(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be an exact non-negative integer string`, 400);
  const parsed = BigInt(value);
  if (!allowZero && parsed === 0n) throw new PlatformError("VALIDATION_FAILED", `${field} must be positive`, 400);
  return parsed;
}

function exactDecimal(value: string, field: string): string {
  if (!EXACT_DECIMAL.test(value) || Number(value) <= 0) throw new PlatformError("VALIDATION_FAILED", `${field} must be an exact positive decimal string`, 400);
  return value;
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

type DeviceRow = Record<string, unknown> & {
  readonly id: string;
  readonly store_id: string;
  readonly register_id: string | null;
  readonly device_key: string;
  readonly status: string;
  readonly version: string;
};

type SessionRow = Record<string, unknown> & {
  readonly id: string;
  readonly store_id: string;
  readonly register_id: string;
  readonly device_id: string;
  readonly status: string;
  readonly business_date: string;
  readonly version: string;
};

type CheckoutRow = Record<string, unknown> & {
  readonly id: string;
  readonly operation_id: string;
  readonly request_hash: string;
  readonly payment_state: string;
  readonly status: string;
  readonly version: string;
};

export class PosSqlRepository {
  async enrollDevice(client: TransactionClient, context: RequestContext, input: PosDeviceEnrollmentInput): Promise<Record<string, unknown>> {
    const replay = await client.query<DeviceRow>(
      `SELECT id::text,store_id::text,register_id::text,device_key,status,version::text
       FROM pos.devices
       WHERE tenant_id=$1::uuid AND device_key=$2
       FOR UPDATE`,
      [context.tenantId, input.deviceKey],
    );
    const existing = replay.rows[0];
    if (existing) {
      if (existing.store_id !== input.storeId || existing.register_id !== (input.registerId ?? null)) {
        throw new PlatformError("CONFLICT", "Device key is already enrolled in another register scope", 409);
      }
      return existing;
    }

    const id = input.id ?? uuidV7();
    const result = await client.query<DeviceRow>(
      `INSERT INTO pos.devices(
         id,tenant_id,store_id,register_id,device_key,display_name,capabilities,enrolled_by
       ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::jsonb,$8::uuid)
       RETURNING id::text,store_id::text,register_id::text,device_key,status,version::text`,
      [id, context.tenantId, input.storeId, input.registerId ?? null, input.deviceKey, input.displayName, JSON.stringify(input.capabilities), context.actorId],
    );
    return result.rows[0]!;
  }

  async openSession(client: TransactionClient, context: RequestContext, input: PosSessionInput): Promise<Record<string, unknown>> {
    const device = await client.query<DeviceRow>(
      `SELECT id::text,store_id::text,register_id::text,device_key,status,version::text
       FROM pos.devices
       WHERE tenant_id=$1::uuid AND id=$2::uuid
       FOR UPDATE`,
      [context.tenantId, input.deviceId],
    );
    const enrolled = device.rows[0];
    if (!enrolled || enrolled.status !== "active") throw new PlatformError("CONFLICT", "POS device is not active", 409);
    if (enrolled.store_id !== input.storeId || enrolled.register_id !== input.registerId) {
      throw new PlatformError("PERMISSION_DENIED", "POS device is outside the requested register scope", 403);
    }

    const open = await client.query<SessionRow>(
      `SELECT id::text,store_id::text,register_id::text,device_id::text,status,business_date::text,version::text
       FROM pos.register_sessions
       WHERE tenant_id=$1::uuid AND register_id=$2::uuid AND status IN ('open','suspended')
       FOR UPDATE`,
      [context.tenantId, input.registerId],
    );
    const existing = open.rows[0];
    if (existing) {
      if (existing.device_id !== input.deviceId) throw new PlatformError("CONFLICT", "Register already has an open session on another device", 409);
      return existing;
    }

    const id = input.id ?? uuidV7();
    const result = await client.query<SessionRow>(
      `INSERT INTO pos.register_sessions(
         id,tenant_id,store_id,register_id,device_id,business_date,opened_by
       ) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::date,$7::uuid)
       RETURNING id::text,store_id::text,register_id::text,device_id::text,status,business_date::text,version::text`,
      [id, context.tenantId, input.storeId, input.registerId, input.deviceId, context.businessDate, context.actorId],
    );
    return result.rows[0]!;
  }

  async createCart(client: TransactionClient, context: RequestContext, input: PosCartInput): Promise<Record<string, unknown>> {
    if (input.lines.length === 0) throw new PlatformError("VALIDATION_FAILED", "POS cart requires at least one line", 400);
    const session = await client.query<SessionRow>(
      `SELECT id::text,store_id::text,register_id::text,device_id::text,status,business_date::text,version::text
       FROM pos.register_sessions
       WHERE tenant_id=$1::uuid AND id=$2::uuid
       FOR UPDATE`,
      [context.tenantId, input.sessionId],
    );
    if (!session.rows[0] || session.rows[0].status !== "open") throw new PlatformError("CONFLICT", "POS session must be open", 409);

    const cartId = input.id ?? uuidV7();
    const replay = await client.query<Record<string, unknown> & { readonly id: string; readonly status: string; readonly version: string }>(
      `SELECT id::text,status,version::text FROM pos.carts WHERE tenant_id=$1::uuid AND id=$2::uuid`,
      [context.tenantId, cartId],
    );
    if (replay.rows[0]) return replay.rows[0];

    await client.query(
      `INSERT INTO pos.carts(id,tenant_id,session_id,customer_reference,currency,scale,created_by)
       VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::uuid)`,
      [cartId, context.tenantId, input.sessionId, input.customerReference ?? null, input.currency, input.scale, context.actorId],
    );

    for (const line of input.lines) {
      const quantity = exactDecimal(line.quantity, "line.quantity");
      exactInteger(line.unitPriceMinor, "line.unitPriceMinor");
      exactInteger(line.discountMinor, "line.discountMinor");
      exactInteger(line.taxMinor, "line.taxMinor");
      await client.query(
        `INSERT INTO pos.cart_lines(
           id,tenant_id,cart_id,line_number,variant_reference,quantity,
           unit_price_minor,discount_minor,tax_minor,price_snapshot,tax_snapshot
         ) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::numeric,$7::bigint,$8::bigint,$9::bigint,$10::jsonb,$11::jsonb)`,
        [
          line.id ?? uuidV7(), context.tenantId, cartId, line.lineNumber, line.variantReference, quantity,
          line.unitPriceMinor, line.discountMinor, line.taxMinor, JSON.stringify(line.priceSnapshot), JSON.stringify(line.taxSnapshot),
        ],
      );
    }
    return { id: cartId, status: "open", version: "1", lineCount: input.lines.length };
  }

  async recordCheckout(client: TransactionClient, context: RequestContext, input: PosCheckoutInput): Promise<Record<string, unknown>> {
    const subtotal = exactInteger(input.subtotalMinor, "subtotalMinor");
    const discount = exactInteger(input.discountMinor, "discountMinor");
    const tax = exactInteger(input.taxMinor, "taxMinor");
    const total = exactInteger(input.totalMinor, "totalMinor");
    if (discount > subtotal || total !== subtotal - discount + tax) {
      throw new PlatformError("VALIDATION_FAILED", "Checkout exact totals are inconsistent", 400);
    }

    const replay = await client.query<CheckoutRow>(
      `SELECT id::text,operation_id,request_hash,payment_state,status,version::text
       FROM pos.checkout_operations
       WHERE tenant_id=$1::uuid AND device_id=$2::uuid AND operation_id=$3
       FOR UPDATE`,
      [context.tenantId, input.deviceId, input.operationId],
    );
    const existing = replay.rows[0];
    if (existing) {
      if (existing.request_hash !== input.requestHash) throw new PlatformError("IDEMPOTENCY_CONFLICT", "Checkout operation was replayed with different content", 409);
      return existing;
    }

    const session = await client.query<SessionRow>(
      `SELECT id::text,store_id::text,register_id::text,device_id::text,status,business_date::text,version::text
       FROM pos.register_sessions
       WHERE tenant_id=$1::uuid AND id=$2::uuid
       FOR UPDATE`,
      [context.tenantId, input.sessionId],
    );
    const active = session.rows[0];
    if (!active || active.status !== "open") throw new PlatformError("CONFLICT", "POS session must be open", 409);
    if (active.store_id !== input.storeId || active.register_id !== input.registerId || active.device_id !== input.deviceId) {
      throw new PlatformError("PERMISSION_DENIED", "Checkout is outside the active POS session scope", 403);
    }
    const cart = await client.query<Record<string, unknown> & { readonly status: string }>(
      `SELECT status FROM pos.carts WHERE tenant_id=$1::uuid AND id=$2::uuid AND session_id=$3::uuid FOR UPDATE`,
      [context.tenantId, input.cartId, input.sessionId],
    );
    if (!cart.rows[0] || !["open", "checkout_pending"].includes(cart.rows[0].status)) {
      throw new PlatformError("CONFLICT", "POS cart cannot be submitted", 409);
    }

    const id = input.id ?? uuidV7();
    const status = input.paymentState === "unknown" ? "unknown" : input.paymentState === "declined" ? "rejected" : "pending";
    const result = await client.query<CheckoutRow>(
      `INSERT INTO pos.checkout_operations(
         id,tenant_id,store_id,register_id,device_id,session_id,cart_id,
         operation_id,request_hash,mode,currency,scale,subtotal_minor,discount_minor,
         tax_minor,total_minor,payment_state,status,cart_snapshot,tender_snapshot,
         rejection_code,occurred_at,committed_at
       ) VALUES(
         $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
         $8,$9,$10,$11,$12,$13::bigint,$14::bigint,$15::bigint,$16::bigint,
         $17,$18,$19::jsonb,$20::jsonb,$21,$22::timestamptz,$23::timestamptz
       )
       RETURNING id::text,operation_id,request_hash,payment_state,status,version::text`,
      [
        id, context.tenantId, input.storeId, input.registerId, input.deviceId, input.sessionId, input.cartId,
        input.operationId, input.requestHash, input.mode, input.currency, input.scale,
        input.subtotalMinor, input.discountMinor, input.taxMinor, input.totalMinor,
        input.paymentState, status, JSON.stringify(input.cartSnapshot), JSON.stringify(input.tenderSnapshot),
        input.paymentState === "declined" ? "PAYMENT_DECLINED" : null, input.occurredAt, input.committedAt,
      ],
    );
    await client.query(
      `UPDATE pos.carts SET status='checkout_pending',updated_at=now(),version=version+1
       WHERE tenant_id=$1::uuid AND id=$2::uuid`,
      [context.tenantId, input.cartId],
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
      const sequence = exactInteger(operation.deviceSequence, "deviceSequence", false);
      const aggregateVersion = exactInteger(operation.aggregateVersion, "aggregateVersion");
      const replay = await client.query<Record<string, unknown> & { readonly id: string; readonly payload_hash: string }>(
        `SELECT id::text,payload_hash
         FROM pos.offline_operations
         WHERE tenant_id=$1::uuid AND device_id=$2::uuid AND operation_id=$3`,
        [context.tenantId, operation.deviceId, operation.operationId],
      );
      const existing = replay.rows[0];
      if (existing) {
        if (existing.payload_hash !== operation.payloadHash) throw new PlatformError("IDEMPOTENCY_CONFLICT", "Offline operation was replayed with different content", 409);
        outcomes.push({ operationId: operation.operationId, status: "duplicate", offlineOperationId: existing.id });
        continue;
      }

      const authorization = await client.query<Record<string, unknown> & { readonly id: string }>(
        `SELECT id::text
         FROM pos.offline_authorizations
         WHERE tenant_id=$1::uuid AND id=$2::uuid
           AND device_id=$3::uuid AND register_id=$4::uuid
           AND revoked_at IS NULL AND expires_at > now()
         FOR SHARE`,
        [context.tenantId, operation.authorizationId, operation.deviceId, operation.registerId],
      );
      if (!authorization.rows[0]) {
        outcomes.push({ operationId: operation.operationId, status: "rejected", reasonCode: "OFFLINE_AUTHORIZATION_INVALID" });
        continue;
      }

      const id = operation.id ?? uuidV7();
      await client.query(
        `INSERT INTO pos.offline_operations(
           id,tenant_id,device_id,register_id,authorization_id,operation_id,
           device_sequence,operation_type,aggregate_id,aggregate_version,payload,
           payload_hash,recorded_at,local_schema_version,app_version
         ) VALUES(
           $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,
           $7::bigint,$8,$9,$10::bigint,$11::jsonb,$12,$13::timestamptz,$14,$15
         )`,
        [
          id, context.tenantId, operation.deviceId, operation.registerId, operation.authorizationId,
          operation.operationId, sequence.toString(), operation.operationType, operation.aggregateId,
          aggregateVersion.toString(), JSON.stringify(operation.payload), operation.payloadHash,
          operation.recordedAt, operation.localSchemaVersion, operation.appVersion,
        ],
      );
      outcomes.push({ operationId: operation.operationId, status: "deferred", offlineOperationId: id });
    }
    return outcomes;
  }

  async listReconciliation(client: TransactionClient, context: RequestContext, limit = 100): Promise<readonly Record<string, unknown>[]> {
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
