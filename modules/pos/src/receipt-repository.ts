import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { TransactionClient } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ReceiptDeliveryChannel = "print" | "email" | "sms";

export interface ReceiptDeliveryInput {
  readonly id?: string;
  readonly receiptSnapshotId: string;
  readonly channel: ReceiptDeliveryChannel;
  readonly destinationMasked?: string;
  readonly reason: string;
}

export interface ReceiptSnapshotView extends Record<string, unknown> {
  readonly id: string;
  readonly checkoutOperationId: string;
  readonly receiptNumber: string;
  readonly businessDate: string;
  readonly currency: string;
  readonly scale: number;
  readonly totalMinor: string;
  readonly semanticPayload: Readonly<Record<string, unknown>>;
  readonly contentHash: string;
  readonly renderStatus: string;
  readonly createdAt: string;
}

function normalizedReference(value: string): string {
  const reference = value.trim();
  if (reference.length < 1 || reference.length > 200) {
    throw new PlatformError("VALIDATION_FAILED", "Receipt reference must contain 1 to 200 characters", 400);
  }
  return reference;
}

function normalizedDelivery(input: ReceiptDeliveryInput): ReceiptDeliveryInput {
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new PlatformError("VALIDATION_FAILED", "Receipt delivery reason must contain 1 to 500 characters", 400);
  }
  const destinationMasked = input.destinationMasked?.trim();
  if (input.channel === "print" && destinationMasked !== undefined) {
    throw new PlatformError("VALIDATION_FAILED", "Print delivery must not include a destination", 400);
  }
  if (input.channel !== "print" && (destinationMasked === undefined || destinationMasked.length < 3 || destinationMasked.length > 200)) {
    throw new PlatformError("VALIDATION_FAILED", "Email and SMS delivery require a masked destination", 400);
  }
  return {
    ...input,
    reason,
    ...(destinationMasked === undefined ? {} : { destinationMasked }),
  };
}

export class PosReceiptRepository {
  async findReceipt(
    client: TransactionClient,
    context: RequestContext,
    referenceValue: string,
  ): Promise<ReceiptSnapshotView> {
    const reference = normalizedReference(referenceValue);
    const result = await client.query<{
      readonly id: string;
      readonly checkout_operation_id: string;
      readonly receipt_number: string;
      readonly business_date: string;
      readonly currency: string;
      readonly scale: number;
      readonly total_minor: string;
      readonly semantic_payload: Readonly<Record<string, unknown>>;
      readonly content_hash: string;
      readonly render_status: string;
      readonly created_at: string;
    }>(
      UUID.test(reference)
        ? `SELECT id::text,checkout_operation_id::text,receipt_number,business_date::text,currency,
                  scale,total_minor::text,semantic_payload,content_hash,render_status,created_at::text
           FROM pos.receipt_snapshots
           WHERE tenant_id=$1::uuid AND id=$2::uuid`
        : `SELECT id::text,checkout_operation_id::text,receipt_number,business_date::text,currency,
                  scale,total_minor::text,semantic_payload,content_hash,render_status,created_at::text
           FROM pos.receipt_snapshots
           WHERE tenant_id=$1::uuid AND receipt_number=$2`,
      [context.tenantId, reference],
    );
    const row = result.rows[0];
    if (!row) throw new PlatformError("NOT_FOUND", "Receipt snapshot was not found", 404, { reference });
    return {
      id: row.id,
      checkoutOperationId: row.checkout_operation_id,
      receiptNumber: row.receipt_number,
      businessDate: row.business_date,
      currency: row.currency,
      scale: row.scale,
      totalMinor: row.total_minor,
      semanticPayload: row.semantic_payload,
      contentHash: row.content_hash,
      renderStatus: row.render_status,
      createdAt: row.created_at,
    };
  }

  async requestDelivery(
    client: TransactionClient,
    _context: RequestContext,
    rawInput: ReceiptDeliveryInput,
  ): Promise<Record<string, unknown>> {
    const input = normalizedDelivery(rawInput);
    const result = await client.query(
      `SELECT id::text,receipt_snapshot_id::text,receipt_number,channel,destination_masked,
              requested_at::text,replayed
       FROM pos.request_receipt_delivery_v1($1::uuid,$2::uuid,$3,$4,$5)`,
      [input.id ?? uuidV7(), input.receiptSnapshotId, input.channel, input.destinationMasked ?? null, input.reason],
    );
    return result.rows[0]!;
  }
}
