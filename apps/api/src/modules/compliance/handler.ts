import type { MoneyV1 } from "../../../../../packages/contracts/src/v1/common.js";
import type { RequestContext } from "../../../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../../../packages/foundation/src/ids.js";
import type { FiscalProviderRegistry } from "../../../../../modules/compliance/src/provider.js";
import { ComplianceService, MapFiscalProviderRegistry } from "../../../../../modules/compliance/src/service.js";
import { NeonComplianceStore } from "../../../../../modules/compliance/src/store.js";
import {
  bodyRecord,
  dataResponse,
  idempotencyKey,
  isRecord,
  optionalString,
  optionalUuid,
  pathUuid,
  requestHash,
  requiredArray,
  requiredEnum,
  requiredRecord,
  requiredString,
  requiredUuid,
} from "../../finance-handler-utils.js";

const documentTypes = ["receipt", "invoice", "credit_note", "debit_note", "delivery_note"] as const;
const initialFiscalStatuses = ["not_required", "pending"] as const;
const privacyTypes = ["access", "export", "correct", "anonymize", "erase", "restrict"] as const;
const privacyActions = {
  approve: "approved",
  start: "running",
  complete: "completed",
  partial: "partially_completed",
  reject: "rejected",
} as const;

function service(database: NeonDatabase, providers?: FiscalProviderRegistry): ComplianceService {
  return new ComplianceService(new NeonComplianceStore(database), providers ?? new MapFiscalProviderRegistry([]));
}

function moneyValue(value: unknown, field: string): MoneyV1 {
  if (!isRecord(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be an object`, 400);
  const amountMinor = requiredString(value, "amountMinor", 128);
  const currency = requiredString(value, "currency", 3).toUpperCase();
  const scale = value.scale;
  if (!/^-?\d+$/u.test(amountMinor)) throw new PlatformError("VALIDATION_FAILED", `${field}.amountMinor must be an integer string`, 400);
  if (!/^[A-Z]{3}$/u.test(currency)) throw new PlatformError("VALIDATION_FAILED", `${field}.currency must be a three-letter code`, 400);
  if (!Number.isInteger(scale) || (scale as number) < 0 || (scale as number) > 12) {
    throw new PlatformError("VALIDATION_FAILED", `${field}.scale must be an integer between 0 and 12`, 400);
  }
  return Object.freeze({ amountMinor, currency, scale: scale as number });
}

function totals(value: Record<string, unknown>): Readonly<Record<string, MoneyV1>> {
  const entries = Object.entries(value);
  if (entries.length === 0) throw new PlatformError("VALIDATION_FAILED", "totals are required", 400);
  return Object.freeze(Object.fromEntries(entries.map(([key, item]) => {
    if (key.trim().length === 0 || key.length > 80) throw new PlatformError("VALIDATION_FAILED", "totals keys are invalid", 400);
    return [key, moneyValue(item, `totals.${key}`)];
  })));
}

function stringArray(value: readonly unknown[], field: string): readonly string[] {
  return Object.freeze(value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0 || item.length > 512) {
      throw new PlatformError("VALIDATION_FAILED", `${field}[${index}] is invalid`, 400);
    }
    return item.trim();
  }));
}

async function publishLegalDocument(request: Request, context: RequestContext, database: NeonDatabase, providers?: FiscalProviderRegistry): Promise<Response> {
  const body = await bodyRecord(request);
  const correctionOfDocumentId = optionalUuid(body, "correctionOfDocumentId");
  const command = {
    documentId: optionalUuid(body, "documentId") ?? uuidV7(),
    documentType: requiredEnum(body, "documentType", documentTypes),
    legalNumber: requiredString(body, "legalNumber", 160),
    issuedAt: optionalString(body, "issuedAt", 40) ?? new Date().toISOString(),
    packVersionId: requiredUuid(body, "packVersionId"),
    templateId: requiredString(body, "templateId", 160),
    templateVersion: requiredString(body, "templateVersion", 80),
    taxRuleVersion: requiredString(body, "taxRuleVersion", 80),
    currencyMetadataVersion: requiredString(body, "currencyMetadataVersion", 80),
    sourceType: requiredString(body, "sourceType", 80),
    sourceId: requiredString(body, "sourceId", 256),
    sourceVersion: requiredString(body, "sourceVersion", 80),
    totals: totals(requiredRecord(body, "totals")),
    semanticPayloadHash: requiredString(body, "semanticPayloadHash", 128),
    renderedDocumentHash: requiredString(body, "renderedDocumentHash", 128),
    archiveObjectKey: requiredString(body, "archiveObjectKey", 1000),
    fiscalStatus: requiredEnum(body, "fiscalStatus", initialFiscalStatuses),
    ...(correctionOfDocumentId ? { correctionOfDocumentId } : {}),
  };
  const result = await service(database, providers).publishLegalDocument(context, command);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function submitFiscal(request: Request, context: RequestContext, database: NeonDatabase, providers?: FiscalProviderRegistry): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const command = {
    submissionId: optionalUuid(body, "submissionId") ?? uuidV7(),
    documentId: requiredUuid(body, "documentId"),
    providerCapabilityId: requiredString(body, "providerCapabilityId", 160),
    countryPackVersion: requiredString(body, "countryPackVersion", 80),
    payloadHash: requiredString(body, "payloadHash", 128),
    idempotencyKey: key,
    submittedAt: optionalString(body, "submittedAt", 40) ?? new Date().toISOString(),
  };
  const hash = await requestHash(command);
  const result = await service(database, providers).submitFiscal(context, { ...command, requestHash: hash });
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function requestPrivacy(request: Request, context: RequestContext, database: NeonDatabase, providers?: FiscalProviderRegistry): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const command = {
    operationId: optionalUuid(body, "operationId") ?? uuidV7(),
    subjectReference: requiredString(body, "subjectReference", 256),
    operationType: requiredEnum(body, "operationType", privacyTypes),
    retentionPolicyId: requiredUuid(body, "retentionPolicyId"),
    reason: requiredString(body, "reason", 1000),
    requestedAt: optionalString(body, "requestedAt", 40) ?? new Date().toISOString(),
    idempotencyKey: key,
  };
  const hash = await requestHash(command);
  const result = await service(database, providers).requestPrivacyOperation(context, { ...command, requestHash: hash });
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function transitionPrivacy(
  request: Request,
  context: RequestContext,
  database: NeonDatabase,
  operationId: string,
  action: keyof typeof privacyActions,
  providers?: FiscalProviderRegistry,
): Promise<Response> {
  const body = await bodyRecord(request);
  const completedAt = optionalString(body, "completedAt", 40);
  const result = await service(database, providers).transitionPrivacyOperation(context, {
    operationId: pathUuid(operationId, "operationId"),
    status: privacyActions[action],
    preservedEvidenceReferences: stringArray(requiredArray(body, "preservedEvidenceReferences"), "preservedEvidenceReferences"),
    affectedResourceReferences: stringArray(requiredArray(body, "affectedResourceReferences"), "affectedResourceReferences"),
    ...(completedAt ? { completedAt } : {}),
  });
  return dataResponse(result);
}

export async function handleComplianceRequest(
  request: Request,
  url: URL,
  context: RequestContext,
  database: NeonDatabase,
  providers?: FiscalProviderRegistry,
): Promise<Response | null> {
  if (request.method === "POST" && url.pathname === "/v1/compliance/legal-documents") {
    return await publishLegalDocument(request, context, database, providers);
  }
  if (request.method === "POST" && url.pathname === "/v1/compliance/fiscal-submissions") {
    return await submitFiscal(request, context, database, providers);
  }
  if (request.method === "POST" && url.pathname === "/v1/compliance/privacy-operations") {
    return await requestPrivacy(request, context, database, providers);
  }
  const privacyTransition = url.pathname.match(/^\/v1\/compliance\/privacy-operations\/([^/]+)\/(approve|start|complete|partial|reject)$/u);
  if (request.method === "POST" && privacyTransition?.[1] && privacyTransition[2]) {
    return await transitionPrivacy(
      request,
      context,
      database,
      privacyTransition[1],
      privacyTransition[2] as keyof typeof privacyActions,
      providers,
    );
  }
  return null;
}
