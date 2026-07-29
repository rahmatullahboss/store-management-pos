import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { TransactionClient } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";

export type PosReceiptDeliveryChannel = "print" | "email" | "sms";

export interface PosReceiptDeliveryInput {
  readonly id?: string;
  readonly receiptSnapshotId: string;
  readonly channel: PosReceiptDeliveryChannel;
  readonly destinationMasked?: string;
  readonly reason: string;
}

export class PosReceiptDeliverySqlRepository {
  async requestDelivery(
    client: TransactionClient,
    context: RequestContext,
    input: PosReceiptDeliveryInput,
  ): Promise<Record<string, unknown>> {
    if (!context.requestId.trim()) {
      throw new PlatformError("VALIDATION_FAILED", "Receipt delivery requires a request ID", 400);
    }
    const reason = input.reason.trim();
    if (reason.length < 1 || reason.length > 500) {
      throw new PlatformError("VALIDATION_FAILED", "Receipt delivery reason must contain 1 to 500 characters", 400);
    }
    const destinationMasked = input.destinationMasked?.trim();
    if (input.channel === "print" && destinationMasked !== undefined) {
      throw new PlatformError("VALIDATION_FAILED", "Print delivery cannot include a destination", 400);
    }
    if (input.channel !== "print" && (destinationMasked === undefined || destinationMasked.length < 3 || destinationMasked.length > 200)) {
      throw new PlatformError("VALIDATION_FAILED", "Email and SMS delivery require a masked destination", 400);
    }

    const result = await client.query(
      `SELECT id::text,receipt_snapshot_id::text,receipt_number,channel,
              destination_masked,requested_at::text,replayed
       FROM pos.request_receipt_delivery_v1($1::uuid,$2::uuid,$3,$4,$5)`,
      [
        input.id ?? uuidV7(),
        input.receiptSnapshotId,
        input.channel,
        destinationMasked ?? null,
        reason,
      ],
    );
    return result.rows[0]!;
  }
}
