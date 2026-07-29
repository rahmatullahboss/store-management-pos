import type { RequestContext } from "../../../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import {
  PosReceiptRepository,
  type ReceiptDeliveryChannel,
  type ReceiptDeliveryInput,
} from "../../../../../modules/pos/src/receipt-repository.js";
import {
  jsonBody,
  jsonResponse,
  optionalString,
  requirePermission,
  requireString,
  requireUuid,
} from "../http.js";

const DELIVERY_CHANNELS = new Set<ReceiptDeliveryChannel>(["print", "email", "sms"]);

function deliveryInput(receiptSnapshotId: string, body: Record<string, unknown>): ReceiptDeliveryInput {
  const channel = requireString(body.channel, "channel", 16) as ReceiptDeliveryChannel;
  if (!DELIVERY_CHANNELS.has(channel)) throw new PlatformError("VALIDATION_FAILED", "Unsupported receipt delivery channel", 400);
  const destinationMasked = optionalString(body.destinationMasked, "destinationMasked", 200);
  return {
    ...(body.id === undefined ? {} : { id: requireUuid(body.id, "id") }),
    receiptSnapshotId,
    channel,
    ...(destinationMasked === undefined ? {} : { destinationMasked }),
    reason: requireString(body.reason, "reason", 500),
  };
}

export async function handlePosReceiptRequest(
  request: Request,
  url: URL,
  context: RequestContext,
  database: NeonDatabase,
  repository = new PosReceiptRepository(),
): Promise<Response | undefined> {
  const lookup = url.pathname.match(/^\/v1\/pos\/receipts\/([^/]+)$/u);
  if (request.method === "GET" && lookup?.[1]) {
    requirePermission(context, "pos.checkout.read");
    return jsonResponse({
      data: await database.withClientTransaction(
        context,
        async (client) => await repository.findReceipt(client, context, decodeURIComponent(lookup[1]!)),
      ),
    });
  }

  const delivery = url.pathname.match(/^\/v1\/pos\/receipts\/([^/]+)\/deliveries$/u);
  if (request.method === "POST" && delivery?.[1]) {
    const receiptSnapshotId = requireUuid(decodeURIComponent(delivery[1]), "receiptSnapshotId");
    const body = await jsonBody(request);
    const input = deliveryInput(receiptSnapshotId, body);
    requirePermission(context, input.channel === "print" ? "pos.receipt.reprint" : "pos.receipt.deliver");
    return jsonResponse(
      await database.withClientTransaction(
        context,
        async (client) => await repository.requestDelivery(client, context, input),
      ),
      { status: 202 },
    );
  }

  return undefined;
}
