import type { ExportRequestV1, ProjectionEventEnvelopeV1 } from "./contracts.js";

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;
const NON_NEGATIVE_INTEGER_PATTERN = /^[0-9]+$/u;
const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export class RetryableReportingWorkerError extends Error {
  readonly category: string;

  constructor(category: string, message: string) {
    super(message);
    this.name = "RetryableReportingWorkerError";
    this.category = category;
  }
}

export class PermanentReportingWorkerError extends Error {
  readonly category: string;

  constructor(category: string, message: string) {
    super(message);
    this.name = "PermanentReportingWorkerError";
    this.category = category;
  }
}

export interface ProjectionCommandPort {
  consume(event: ProjectionEventEnvelopeV1): Promise<"applied" | "duplicate">;
}

export interface ProjectionDeadLetterV1 {
  readonly eventId: string;
  readonly category: string;
}

export interface ProjectionBatchResultV1 {
  readonly appliedEventIds: readonly string[];
  readonly duplicateEventIds: readonly string[];
  readonly retryEventIds: readonly string[];
  readonly deadLetters: readonly ProjectionDeadLetterV1[];
  readonly deferredEventIds: readonly string[];
}

export async function runProjectionBatch(input: {
  readonly tenantId: string;
  readonly events: readonly ProjectionEventEnvelopeV1[];
  readonly commands: ProjectionCommandPort;
  readonly maxBatchSize?: number;
}): Promise<ProjectionBatchResultV1> {
  const maxBatchSize = input.maxBatchSize ?? 100;
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1 || maxBatchSize > 1_000) {
    throw new RangeError("Projection worker batch size must be between 1 and 1000");
  }
  if (input.tenantId.trim().length === 0) throw new TypeError("Projection worker tenant is required");

  const events = input.events.slice(0, maxBatchSize);
  for (const event of events) {
    if (event.tenantId !== input.tenantId) throw new TypeError("Projection worker cannot process a cross-tenant event");
    if (event.eventId.trim().length === 0) throw new TypeError("Projection event identity is required");
    if (!POSITIVE_INTEGER_PATTERN.test(event.sequence)) throw new TypeError("Projection event sequence must be a positive integer string");
  }

  const appliedEventIds: string[] = [];
  const duplicateEventIds: string[] = [];
  const retryEventIds: string[] = [];
  const deadLetters: ProjectionDeadLetterV1[] = [];
  const deferredEventIds: string[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) throw new TypeError("Projection worker event is missing");
    try {
      const disposition = await input.commands.consume(event);
      if (disposition === "applied") appliedEventIds.push(event.eventId);
      else duplicateEventIds.push(event.eventId);
    } catch (error) {
      if (error instanceof PermanentReportingWorkerError) {
        deadLetters.push(Object.freeze({ eventId: event.eventId, category: error.category }));
        continue;
      }
      retryEventIds.push(event.eventId);
      for (const deferred of events.slice(index + 1)) deferredEventIds.push(deferred.eventId);
      break;
    }
  }

  return Object.freeze({
    appliedEventIds: Object.freeze(appliedEventIds),
    duplicateEventIds: Object.freeze(duplicateEventIds),
    retryEventIds: Object.freeze(retryEventIds),
    deadLetters: Object.freeze(deadLetters),
    deferredEventIds: Object.freeze(deferredEventIds),
  });
}

export interface ExportArtifactV1 {
  readonly contentType: string;
  readonly fileExtension: ExportRequestV1["format"];
  readonly bytes: Uint8Array;
  readonly rowCount: string;
}

export interface ExportRendererPort {
  render(request: ExportRequestV1): Promise<ExportArtifactV1>;
}

export interface ExportStoragePort {
  put(input: {
    readonly tenantId: string;
    readonly exportId: string;
    readonly objectKey: string;
    readonly contentType: string;
    readonly bytes: Uint8Array;
  }): Promise<{ readonly etag: string }>;
}

export interface ExportCommandPort {
  markRunning(input: { readonly tenantId: string; readonly exportId: string; readonly observedAt: string }): Promise<void>;
  markCompleted(input: {
    readonly tenantId: string;
    readonly exportId: string;
    readonly observedAt: string;
    readonly objectKey: string;
    readonly etag: string;
    readonly rowCount: string;
    readonly byteCount: string;
  }): Promise<void>;
  markFailed(input: {
    readonly tenantId: string;
    readonly exportId: string;
    readonly observedAt: string;
    readonly category: string;
  }): Promise<void>;
}

export interface ExportWorkerResultV1 {
  readonly status: "completed" | "failed";
  readonly objectKey?: string;
  readonly etag?: string;
  readonly rowCount?: string;
  readonly byteCount?: string;
  readonly errorCategory?: string;
}

function assertSafePathSegment(value: string, field: string): void {
  if (!SAFE_PATH_SEGMENT_PATTERN.test(value)) throw new TypeError(`${field} is not safe for an export object key`);
}

async function failExport(input: {
  readonly request: ExportRequestV1;
  readonly commands: ExportCommandPort;
  readonly observedAt: string;
  readonly category: string;
}): Promise<ExportWorkerResultV1> {
  await input.commands.markFailed({
    tenantId: input.request.scope.tenantId,
    exportId: input.request.exportId,
    observedAt: input.observedAt,
    category: input.category,
  });
  return Object.freeze({ status: "failed", errorCategory: input.category });
}

export async function runExportWorker(input: {
  readonly request: ExportRequestV1;
  readonly renderer: ExportRendererPort;
  readonly storage: ExportStoragePort;
  readonly commands: ExportCommandPort;
  readonly observedAt: string;
  readonly maxArtifactBytes?: number;
  readonly maxRows?: string;
}): Promise<ExportWorkerResultV1> {
  const tenantId = input.request.scope.tenantId;
  assertSafePathSegment(tenantId, "tenantId");
  assertSafePathSegment(input.request.exportId, "exportId");
  const maxArtifactBytes = input.maxArtifactBytes ?? 50 * 1024 * 1024;
  if (!Number.isSafeInteger(maxArtifactBytes) || maxArtifactBytes < 1) throw new RangeError("Export byte limit must be a positive safe integer");
  const maxRows = input.maxRows ?? "1000000";
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(maxRows)) throw new TypeError("Export row limit must be a non-negative integer string");

  await input.commands.markRunning({ tenantId, exportId: input.request.exportId, observedAt: input.observedAt });

  let artifact: ExportArtifactV1;
  try {
    artifact = await input.renderer.render(input.request);
  } catch {
    return failExport({ request: input.request, commands: input.commands, observedAt: input.observedAt, category: "render_failed" });
  }

  if (artifact.fileExtension !== input.request.format || artifact.contentType.trim().length === 0) {
    return failExport({ request: input.request, commands: input.commands, observedAt: input.observedAt, category: "artifact_contract_invalid" });
  }
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(artifact.rowCount) || BigInt(artifact.rowCount) > BigInt(maxRows)) {
    return failExport({ request: input.request, commands: input.commands, observedAt: input.observedAt, category: "row_limit_exceeded" });
  }
  if (artifact.bytes.byteLength > maxArtifactBytes) {
    return failExport({ request: input.request, commands: input.commands, observedAt: input.observedAt, category: "byte_limit_exceeded" });
  }

  const objectKey = `exports/${tenantId}/${input.request.exportId}.${artifact.fileExtension}`;
  let stored: { readonly etag: string };
  try {
    stored = await input.storage.put({
      tenantId,
      exportId: input.request.exportId,
      objectKey,
      contentType: artifact.contentType,
      bytes: artifact.bytes,
    });
  } catch {
    return failExport({ request: input.request, commands: input.commands, observedAt: input.observedAt, category: "storage_failed" });
  }
  if (stored.etag.trim().length === 0) {
    return failExport({ request: input.request, commands: input.commands, observedAt: input.observedAt, category: "storage_receipt_invalid" });
  }

  const byteCount = artifact.bytes.byteLength.toString();
  await input.commands.markCompleted({
    tenantId,
    exportId: input.request.exportId,
    observedAt: input.observedAt,
    objectKey,
    etag: stored.etag,
    rowCount: artifact.rowCount,
    byteCount,
  });
  return Object.freeze({
    status: "completed",
    objectKey,
    etag: stored.etag,
    rowCount: artifact.rowCount,
    byteCount,
  });
}
