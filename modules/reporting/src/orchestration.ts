import type { ExportRequestV1 } from "./contracts.js";

const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface ReportingExportArtifactV1 {
  readonly body: Uint8Array;
  readonly rowCount: number;
  readonly byteCount: number;
  readonly contentType: string;
}

export interface ReportingExportRendererPort {
  render(request: ExportRequestV1): Promise<ReportingExportArtifactV1>;
}

export interface ReportingExportStorageReceiptV1 {
  readonly objectReference: string;
  readonly contentHash: string;
  readonly receipt: string;
}

export interface ReportingExportStoragePort {
  put(input: {
    readonly tenantId: string;
    readonly exportId: string;
    readonly objectKey: string;
    readonly contentType: string;
    readonly body: Uint8Array;
  }): Promise<ReportingExportStorageReceiptV1>;
}

export interface ReportingExportCommandPort {
  start(input: {
    readonly tenantId: string;
    readonly exportId: string;
    readonly observedAt: string;
  }): Promise<void>;
  complete(input: {
    readonly tenantId: string;
    readonly exportId: string;
    readonly observedAt: string;
    readonly expiresAt: string;
    readonly objectReference: string;
    readonly contentHash: string;
    readonly receipt: string;
    readonly rowCount: number;
    readonly byteCount: number;
    readonly contentType: string;
  }): Promise<void>;
  fail(input: {
    readonly tenantId: string;
    readonly exportId: string;
    readonly observedAt: string;
    readonly category: string;
  }): Promise<void>;
}

export interface ReportingExportOrchestrationResultV1 extends ReportingExportStorageReceiptV1 {
  readonly rowCount: number;
  readonly byteCount: number;
  readonly contentType: string;
  readonly expiresAt: string;
}

function assertSafePathSegment(value: string, field: string): void {
  if (!SAFE_PATH_SEGMENT_PATTERN.test(value)) {
    throw new TypeError(`${field} is not safe for an export object key`);
  }
}

function assertPositiveLimit(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive safe integer`);
  }
}

function assertTimestampWindow(observedAt: string, expiresAt: string): void {
  const observed = Date.parse(observedAt);
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(observed) || !Number.isFinite(expires) || expires <= observed) {
    throw new TypeError("Reporting export expiry window is invalid");
  }
}

async function failAndThrow(input: {
  readonly commands: ReportingExportCommandPort;
  readonly tenantId: string;
  readonly exportId: string;
  readonly observedAt: string;
  readonly category: string;
  readonly error: Error;
}): Promise<never> {
  await input.commands.fail({
    tenantId: input.tenantId,
    exportId: input.exportId,
    observedAt: input.observedAt,
    category: input.category,
  });
  throw input.error;
}

export async function orchestrateReportingExport(input: {
  readonly request: ExportRequestV1;
  readonly renderer: ReportingExportRendererPort;
  readonly storage: ReportingExportStoragePort;
  readonly commands: ReportingExportCommandPort;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly limits: {
    readonly maxRows: number;
    readonly maxBytes: number;
  };
}): Promise<ReportingExportOrchestrationResultV1> {
  const tenantId = input.request.scope.tenantId;
  const exportId = input.request.exportId;
  assertSafePathSegment(tenantId, "tenantId");
  assertSafePathSegment(exportId, "exportId");
  assertPositiveLimit(input.limits.maxRows, "Reporting export row limit");
  assertPositiveLimit(input.limits.maxBytes, "Reporting export byte limit");
  assertTimestampWindow(input.observedAt, input.expiresAt);

  await input.commands.start({ tenantId, exportId, observedAt: input.observedAt });

  let artifact: ReportingExportArtifactV1;
  try {
    artifact = await input.renderer.render(input.request);
  } catch {
    return failAndThrow({
      commands: input.commands,
      tenantId,
      exportId,
      observedAt: input.observedAt,
      category: "render_failed",
      error: new Error("Reporting export rendering failed"),
    });
  }

  if (!Number.isSafeInteger(artifact.rowCount) || artifact.rowCount < 0) {
    return failAndThrow({
      commands: input.commands,
      tenantId,
      exportId,
      observedAt: input.observedAt,
      category: "artifact_contract_invalid",
      error: new TypeError("Reporting export row count is invalid"),
    });
  }
  if (artifact.rowCount > input.limits.maxRows) {
    return failAndThrow({
      commands: input.commands,
      tenantId,
      exportId,
      observedAt: input.observedAt,
      category: "row_limit_exceeded",
      error: new RangeError("Reporting export row limit exceeded"),
    });
  }
  if (!(artifact.body instanceof Uint8Array)
      || !Number.isSafeInteger(artifact.byteCount)
      || artifact.byteCount < 0
      || artifact.byteCount !== artifact.body.byteLength
      || artifact.contentType.trim().length === 0) {
    return failAndThrow({
      commands: input.commands,
      tenantId,
      exportId,
      observedAt: input.observedAt,
      category: "artifact_contract_invalid",
      error: new TypeError("Reporting export artifact contract is invalid"),
    });
  }
  if (artifact.byteCount > input.limits.maxBytes) {
    return failAndThrow({
      commands: input.commands,
      tenantId,
      exportId,
      observedAt: input.observedAt,
      category: "byte_limit_exceeded",
      error: new RangeError("Reporting export byte limit exceeded"),
    });
  }

  const objectKey = `exports/${tenantId}/${exportId}.${input.request.format}`;
  let stored: ReportingExportStorageReceiptV1;
  try {
    stored = await input.storage.put({
      tenantId,
      exportId,
      objectKey,
      contentType: artifact.contentType,
      body: artifact.body,
    });
  } catch {
    return failAndThrow({
      commands: input.commands,
      tenantId,
      exportId,
      observedAt: input.observedAt,
      category: "storage_failed",
      error: new Error("Reporting export storage failed"),
    });
  }

  if (stored.objectReference.trim().length === 0
      || !SHA256_PATTERN.test(stored.contentHash)
      || stored.receipt.trim().length === 0) {
    return failAndThrow({
      commands: input.commands,
      tenantId,
      exportId,
      observedAt: input.observedAt,
      category: "storage_receipt_invalid",
      error: new TypeError("Reporting export storage receipt is invalid"),
    });
  }

  await input.commands.complete({
    tenantId,
    exportId,
    observedAt: input.observedAt,
    expiresAt: input.expiresAt,
    objectReference: stored.objectReference,
    contentHash: stored.contentHash,
    receipt: stored.receipt,
    rowCount: artifact.rowCount,
    byteCount: artifact.byteCount,
    contentType: artifact.contentType,
  });

  return Object.freeze({
    ...stored,
    rowCount: artifact.rowCount,
    byteCount: artifact.byteCount,
    contentType: artifact.contentType,
    expiresAt: input.expiresAt,
  });
}
