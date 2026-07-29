import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import type {
  ComplianceStore,
  CreateFiscalSubmissionCommand,
  CreatePrivacyOperationCommand,
  FiscalSubmissionClaim,
  FiscalSubmissionResult,
  FiscalTransitionCommand,
  LegalDocumentResult,
  PrivacyOperationResult,
  PublishLegalDocumentCommand,
  TransitionPrivacyOperationCommand,
} from "./service.js";

interface DocumentRow extends Record<string, unknown> {
  readonly document_id: string;
  readonly replayed: boolean;
}

interface FiscalClaimRow extends Record<string, unknown> {
  readonly submission_id: string;
  readonly status: FiscalSubmissionClaim["status"];
  readonly replayed: boolean;
}

interface PrivacyRow extends Record<string, unknown> {
  readonly operation_id: string;
  readonly status: PrivacyOperationResult["status"];
  readonly replayed: boolean;
}

interface StatusRow extends Record<string, unknown> {
  readonly status: FiscalSubmissionResult["status"] | PrivacyOperationResult["status"];
}

function databaseCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const value = (error as { readonly code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Compliance database command failed";
}

function translate(error: unknown): never {
  if (error instanceof PlatformError) throw error;
  const code = databaseCode(error);
  const detail = message(error);
  if (code === "P0002") throw new PlatformError("NOT_FOUND", detail, 404);
  if (code === "42501") throw new PlatformError("PERMISSION_DENIED", detail, 403);
  if (code === "23505") {
    if (/idempotency/iu.test(detail)) throw new PlatformError("IDEMPOTENCY_CONFLICT", detail, 409);
    throw new PlatformError("CONFLICT", detail, 409);
  }
  if (code === "P0001") {
    if (/replay payload/iu.test(detail)) throw new PlatformError("IDEMPOTENCY_CONFLICT", detail, 409);
    throw new PlatformError("CONFLICT", detail, 409);
  }
  if (code === "22000" || code === "22023" || code === "23514") {
    throw new PlatformError("VALIDATION_FAILED", detail, 400);
  }
  throw error;
}

async function withComplianceError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    translate(error);
  }
}

function first<Row>(rows: readonly Row[], notFound: string): Row {
  const row = rows[0];
  if (!row) throw new PlatformError("NOT_FOUND", notFound, 404);
  return row;
}

export class NeonComplianceStore implements ComplianceStore {
  constructor(private readonly database: NeonDatabase) {}

  async publishLegalDocument(context: RequestContext, command: PublishLegalDocumentCommand): Promise<LegalDocumentResult> {
    return await withComplianceError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<DocumentRow>(
        `SELECT document_id, replayed FROM localization.publish_legal_document(
          $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::date,$8::timestamptz,
          $9::uuid,$10::text,$11::text,$12::text,$13::text,$14::text,$15::text,$16::text,
          $17::jsonb,$18::text,$19::text,$20::text,$21::text,$22::uuid,$23::uuid,$24::text,$25::text
        )`,
        [
          command.documentId,
          context.tenantId,
          context.legalEntityId,
          context.storeId ?? null,
          command.documentType,
          command.legalNumber,
          context.businessDate,
          command.issuedAt,
          command.packVersionId,
          command.templateId,
          command.templateVersion,
          command.taxRuleVersion,
          command.currencyMetadataVersion,
          command.sourceType,
          command.sourceId,
          command.sourceVersion,
          JSON.stringify(command.totals),
          command.semanticPayloadHash,
          command.renderedDocumentHash,
          command.archiveObjectKey,
          command.fiscalStatus,
          command.correctionOfDocumentId ?? null,
          context.actorId,
          context.requestId,
          context.traceId,
        ],
      );
      const row = first(result.rows, "Legal-document publication returned no result");
      return Object.freeze({ documentId: row.document_id, replayed: row.replayed });
    }));
  }

  async createFiscalSubmission(context: RequestContext, command: CreateFiscalSubmissionCommand): Promise<FiscalSubmissionClaim> {
    return await withComplianceError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<FiscalClaimRow>(
        `SELECT submission_id, status, replayed FROM localization.create_fiscal_submission(
          $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::text,$8::text,$9::timestamptz
        )`,
        [
          command.submissionId,
          context.tenantId,
          command.documentId,
          command.providerCapabilityId,
          command.countryPackVersion,
          command.payloadHash,
          command.idempotencyKey,
          command.requestHash,
          command.submittedAt,
        ],
      );
      const row = first(result.rows, "Fiscal submission returned no result");
      return Object.freeze({ submissionId: row.submission_id, status: row.status, replayed: row.replayed });
    }));
  }

  async recordFiscalTransition(context: RequestContext, command: FiscalTransitionCommand): Promise<FiscalSubmissionResult> {
    return await withComplianceError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<StatusRow>(
        `SELECT localization.record_fiscal_transition(
          $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::timestamptz,$8::uuid,$9::text,$10::text
        ) AS status`,
        [
          command.eventId,
          context.tenantId,
          command.submissionId,
          command.status,
          command.providerReference ?? null,
          command.rejectionCode ?? null,
          command.observedAt,
          context.actorId,
          context.requestId,
          context.traceId,
        ],
      );
      const row = first(result.rows, "Fiscal transition returned no result");
      return Object.freeze({
        submissionId: command.submissionId,
        status: row.status as FiscalSubmissionResult["status"],
        replayed: false,
        observedAt: command.observedAt,
        ...(command.providerReference ? { providerReference: command.providerReference } : {}),
        ...(command.rejectionCode ? { rejectionCode: command.rejectionCode } : {}),
      });
    }));
  }

  async createPrivacyOperation(context: RequestContext, command: CreatePrivacyOperationCommand): Promise<PrivacyOperationResult> {
    return await withComplianceError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<PrivacyRow>(
        `SELECT operation_id, status, replayed FROM localization.create_privacy_operation(
          $1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::text,$7::uuid,$8::timestamptz,$9::text,$10::text
        )`,
        [
          command.operationId,
          context.tenantId,
          command.subjectReference,
          command.operationType,
          command.retentionPolicyId,
          command.reason,
          context.actorId,
          command.requestedAt,
          command.idempotencyKey,
          command.requestHash,
        ],
      );
      const row = first(result.rows, "Privacy operation returned no result");
      return Object.freeze({ operationId: row.operation_id, status: row.status, replayed: row.replayed });
    }));
  }

  async transitionPrivacyOperation(context: RequestContext, command: TransitionPrivacyOperationCommand): Promise<PrivacyOperationResult> {
    return await withComplianceError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<StatusRow>(
        `SELECT localization.transition_privacy_operation(
          $1::uuid,$2::uuid,$3::text,$4::text[],$5::text[],$6::timestamptz
        ) AS status`,
        [
          context.tenantId,
          command.operationId,
          command.status,
          command.preservedEvidenceReferences,
          command.affectedResourceReferences,
          command.completedAt ?? null,
        ],
      );
      const row = first(result.rows, "Privacy transition returned no result");
      return Object.freeze({
        operationId: command.operationId,
        status: row.status as PrivacyOperationResult["status"],
        replayed: false,
      });
    }));
  }
}
