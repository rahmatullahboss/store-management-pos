import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";
import {
  parseStorefrontOperationalEventV1,
  type StorefrontOperationalEventV1,
} from "./observability.js";

export interface StorefrontOperationalEventSinkV1 {
  emit(event: StorefrontOperationalEventV1): Promise<unknown>;
}

export type StorefrontOperationalSinkStateV1 = "accepted" | "unavailable";
export type StorefrontOperationalSinkReasonV1 =
  | "accepted"
  | "sink_unavailable"
  | "configuration_error";

export interface StorefrontOperationalSinkReceiptV1 {
  readonly receiptVersion: "storefront-operational-sink-receipt.v1";
  readonly state: StorefrontOperationalSinkStateV1;
  readonly reason: StorefrontOperationalSinkReasonV1;
  readonly sinkRevision: string | null;
}

const SAFE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const RECEIPT_KEYS = new Set([
  "receiptVersion",
  "state",
  "reason",
  "sinkRevision",
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StorefrontContractError("Storefront operational sink receipt must be an object.");
  }
  return value as Record<string, unknown>;
}

export function parseStorefrontOperationalSinkReceiptV1(
  value: unknown,
): StorefrontOperationalSinkReceiptV1 {
  const source = record(value);
  const unexpected = Object.keys(source).filter((key) => !RECEIPT_KEYS.has(key));
  if (unexpected.length > 0) {
    throw new StorefrontContractError(
      `Storefront operational sink receipt contains unsupported fields: ${unexpected.sort().join(", ")}.`,
    );
  }
  if (source.receiptVersion !== "storefront-operational-sink-receipt.v1") {
    throw new StorefrontContractError("Unsupported storefront operational sink receipt version.");
  }
  if (source.state !== "accepted" && source.state !== "unavailable") {
    throw new StorefrontContractError("Storefront operational sink receipt state is unsupported.");
  }
  if (
    source.reason !== "accepted" &&
    source.reason !== "sink_unavailable" &&
    source.reason !== "configuration_error"
  ) {
    throw new StorefrontContractError("Storefront operational sink receipt reason is unsupported.");
  }
  if (source.state === "accepted" && source.reason !== "accepted") {
    throw new StorefrontContractError("Accepted operational sink receipts must use accepted reason.");
  }
  if (
    source.state === "unavailable" &&
    source.reason !== "sink_unavailable" &&
    source.reason !== "configuration_error"
  ) {
    throw new StorefrontContractError(
      "Unavailable operational sink receipts must use an unavailable reason.",
    );
  }

  let sinkRevision: string | null = null;
  if (source.sinkRevision !== null && source.sinkRevision !== undefined) {
    if (typeof source.sinkRevision !== "string" || !SAFE_REVISION.test(source.sinkRevision)) {
      throw new StorefrontContractError("Storefront operational sink revision is invalid.");
    }
    sinkRevision = source.sinkRevision;
  }
  if (source.state === "accepted" && sinkRevision === null) {
    throw new StorefrontContractError("Accepted operational sink receipts require a sink revision.");
  }

  return Object.freeze({
    receiptVersion: "storefront-operational-sink-receipt.v1",
    state: source.state,
    reason: source.reason,
    sinkRevision,
  });
}

function unavailable(reason: "sink_unavailable" | "configuration_error"): StorefrontOperationalSinkReceiptV1 {
  return Object.freeze({
    receiptVersion: "storefront-operational-sink-receipt.v1",
    state: "unavailable",
    reason,
    sinkRevision: null,
  });
}

export async function deliverStorefrontOperationalEventV1(input: {
  readonly sink: StorefrontOperationalEventSinkV1;
  readonly event: unknown;
}): Promise<StorefrontOperationalSinkReceiptV1> {
  const event = parseStorefrontOperationalEventV1(input.event);

  let rawReceipt: unknown;
  try {
    rawReceipt = await input.sink.emit(event);
  } catch {
    return unavailable("sink_unavailable");
  }

  try {
    return parseStorefrontOperationalSinkReceiptV1(rawReceipt);
  } catch {
    return unavailable("configuration_error");
  }
}
