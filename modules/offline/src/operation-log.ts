import { PlatformError } from "../../../packages/foundation/src/errors.js";

export type OfflineOperationStatus = "pending" | "uploading" | "accepted" | "rejected" | "review_required";

export interface OfflineOperation {
  readonly deviceId: string;
  readonly operationId: string;
  readonly operationType: string;
  readonly payloadHash: string;
  readonly localCommittedAt: string;
  readonly receiptSnapshotId: string | null;
  readonly status: OfflineOperationStatus;
  readonly serverReference: string | null;
  readonly rejectionCode: string | null;
}

export interface RegisterOperationResult {
  readonly disposition: "appended" | "duplicate";
  readonly operation: OfflineOperation;
  readonly log: readonly OfflineOperation[];
}

export interface SyncOutcome {
  readonly status: "accepted" | "rejected" | "review_required";
  readonly serverReference: string | null;
  readonly rejectionCode: string | null;
}

function operationKey(operation: Pick<OfflineOperation, "deviceId" | "operationId">): string {
  return `${operation.deviceId}:${operation.operationId}`;
}

export function registerPendingOperation(log: readonly OfflineOperation[], operation: OfflineOperation): RegisterOperationResult {
  if (operation.status !== "pending") {
    throw new PlatformError("VALIDATION_FAILED", "A new offline operation must enter the log as pending", 400);
  }
  if (!operation.payloadHash || !operation.localCommittedAt) {
    throw new PlatformError("VALIDATION_FAILED", "Offline operation requires payload hash and durable commit time", 400);
  }

  const existing = log.find((candidate) => operationKey(candidate) === operationKey(operation));
  if (existing) {
    if (existing.payloadHash !== operation.payloadHash || existing.operationType !== operation.operationType) {
      throw new PlatformError("IDEMPOTENCY_CONFLICT", "Offline operation ID was reused with different content", 409, {
        deviceId: operation.deviceId,
        operationId: operation.operationId,
      });
    }
    return Object.freeze({ disposition: "duplicate", operation: existing, log });
  }

  const appended = Object.freeze(operation);
  const nextLog = Object.freeze([...log, appended]);
  return Object.freeze({ disposition: "appended", operation: appended, log: nextLog });
}

export function markUploading(log: readonly OfflineOperation[], deviceId: string, operationId: string): readonly OfflineOperation[] {
  return transition(log, deviceId, operationId, (operation) => {
    if (operation.status !== "pending" && operation.status !== "uploading") {
      throw new PlatformError("CONFLICT", "Only pending operations can be uploaded", 409, { deviceId, operationId });
    }
    return Object.freeze({ ...operation, status: "uploading" as const });
  });
}

export function applySyncOutcome(
  log: readonly OfflineOperation[],
  deviceId: string,
  operationId: string,
  outcome: SyncOutcome,
): readonly OfflineOperation[] {
  return transition(log, deviceId, operationId, (operation) => {
    if (operation.status === "accepted") {
      if (outcome.status === "accepted" && operation.serverReference === outcome.serverReference) return operation;
      throw new PlatformError("CONFLICT", "Accepted offline operation is terminal and cannot be rewritten", 409, { deviceId, operationId });
    }
    if (operation.status === "rejected" || operation.status === "review_required") {
      if (
        operation.status === outcome.status
        && operation.serverReference === outcome.serverReference
        && operation.rejectionCode === outcome.rejectionCode
      ) return operation;
      throw new PlatformError("CONFLICT", "Resolved offline operation requires an explicit adjustment operation", 409, { deviceId, operationId });
    }
    return Object.freeze({
      ...operation,
      status: outcome.status,
      serverReference: outcome.serverReference,
      rejectionCode: outcome.rejectionCode,
    });
  });
}

export function pendingOperations(log: readonly OfflineOperation[]): readonly OfflineOperation[] {
  return Object.freeze(log.filter((operation) => operation.status === "pending" || operation.status === "uploading"));
}

function transition(
  log: readonly OfflineOperation[],
  deviceId: string,
  operationId: string,
  update: (operation: OfflineOperation) => OfflineOperation,
): readonly OfflineOperation[] {
  const index = log.findIndex((operation) => operation.deviceId === deviceId && operation.operationId === operationId);
  if (index < 0) throw new PlatformError("NOT_FOUND", "Offline operation was not found", 404, { deviceId, operationId });
  const current = log[index];
  if (!current) throw new PlatformError("INTERNAL_ERROR", "Offline operation index is invalid", 500);
  const next = [...log];
  next[index] = update(current);
  return Object.freeze(next);
}
