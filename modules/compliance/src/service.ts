import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import type { MoneyV1 } from "../../../packages/contracts/src/v1/common.js";
import type { FiscalSubmissionStatus, LegalDocumentType, PrivacyOperationType } from "./contracts.js";
import type { FiscalProvider, FiscalProviderRegistry, FiscalProviderResult } from "./provider.js";

export interface PublishLegalDocumentCommand {
  readonly documentId: string;
  readonly documentType: LegalDocumentType;
  readonly legalNumber: string;
  readonly issuedAt: string;
  readonly packVersionId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly taxRuleVersion: string;
  readonly currencyMetadataVersion: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly totals: Readonly<Record<string, MoneyV1>>;
  readonly semanticPayloadHash: string;
  readonly renderedDocumentHash: string;
  readonly archiveObjectKey: string;
  readonly fiscalStatus: "not_required" | "pending";
  readonly correctionOfDocumentId?: string;
}

export interface LegalDocumentResult {
  readonly documentId: string;
  readonly replayed: boolean;
}

export interface CreateFiscalSubmissionCommand {
  readonly submissionId: string;
  readonly documentId: string;
  readonly providerCapabilityId: string;
  readonly countryPackVersion: string;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly submittedAt: string;
}

export interface FiscalSubmissionClaim {
  readonly submissionId: string;
  readonly status: Exclude<FiscalSubmissionStatus, "not_required">;
  readonly replayed: boolean;
}

export interface FiscalSubmissionResult extends FiscalSubmissionClaim {
  readonly observedAt: string;
  readonly providerReference?: string;
  readonly rejectionCode?: string;
}

export interface FiscalTransitionCommand {
  readonly eventId: string;
  readonly submissionId: string;
  readonly status: "accepted" | "rejected" | "unknown" | "corrected";
  readonly observedAt: string;
  readonly providerReference?: string;
  readonly rejectionCode?: string;
}

export interface CreatePrivacyOperationCommand {
  readonly operationId: string;
  readonly subjectReference: string;
  readonly operationType: PrivacyOperationType;
  readonly retentionPolicyId: string;
  readonly reason: string;
  readonly requestedAt: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export type PrivacyOperationStatus = "requested" | "approved" | "running" | "completed" | "partially_completed" | "rejected";

export interface PrivacyOperationResult {
  readonly operationId: string;
  readonly status: PrivacyOperationStatus;
  readonly replayed: boolean;
}

export interface TransitionPrivacyOperationCommand {
  readonly operationId: string;
  readonly status: Exclude<PrivacyOperationStatus, "requested">;
  readonly preservedEvidenceReferences: readonly string[];
  readonly affectedResourceReferences: readonly string[];
  readonly completedAt?: string;
}

export interface ComplianceStore {
  publishLegalDocument(context: RequestContext, command: PublishLegalDocumentCommand): Promise<LegalDocumentResult>;
  createFiscalSubmission(context: RequestContext, command: CreateFiscalSubmissionCommand): Promise<FiscalSubmissionClaim>;
  recordFiscalTransition(context: RequestContext, command: FiscalTransitionCommand): Promise<FiscalSubmissionResult>;
  createPrivacyOperation(context: RequestContext, command: CreatePrivacyOperationCommand): Promise<PrivacyOperationResult>;
  transitionPrivacyOperation(context: RequestContext, command: TransitionPrivacyOperationCommand): Promise<PrivacyOperationResult>;
}

export class MapFiscalProviderRegistry implements FiscalProviderRegistry {
  readonly #providers: ReadonlyMap<string, FiscalProvider>;

  constructor(entries: Iterable<readonly [string, FiscalProvider]>) {
    this.#providers = new Map(entries);
  }

  require(capabilityId: string): FiscalProvider {
    const provider = this.#providers.get(capabilityId);
    if (!provider) throw new PlatformError("NOT_FOUND", `Fiscal provider is not configured: ${capabilityId}`, 404);
    return provider;
  }
}

function requirePermission(context: RequestContext, permission: string): void {
  if (!context.permissions.has(permission)) throw new PlatformError("PERMISSION_DENIED", `Permission denied: ${permission}`, 403);
}

function required(value: string, field: string, maximum = 1000): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  }
  return normalized;
}

function requireLegalEntity(context: RequestContext): void {
  if (!context.legalEntityId) throw new PlatformError("VALIDATION_FAILED", "A legal entity context is required", 400);
}

function providerTransition(result: FiscalProviderResult): FiscalTransitionCommand["status"] {
  return result.status;
}

export class ComplianceService {
  constructor(
    private readonly store: ComplianceStore,
    private readonly providers: FiscalProviderRegistry,
  ) {}

  async publishLegalDocument(context: RequestContext, command: PublishLegalDocumentCommand): Promise<LegalDocumentResult> {
    requirePermission(context, "localization.document.publish");
    requireLegalEntity(context);
    required(command.documentId, "documentId", 64);
    required(command.legalNumber, "legalNumber", 160);
    required(command.packVersionId, "packVersionId", 64);
    required(command.templateId, "templateId", 160);
    required(command.templateVersion, "templateVersion", 80);
    required(command.taxRuleVersion, "taxRuleVersion", 80);
    required(command.currencyMetadataVersion, "currencyMetadataVersion", 80);
    required(command.sourceType, "sourceType", 80);
    required(command.sourceId, "sourceId", 256);
    required(command.sourceVersion, "sourceVersion", 80);
    required(command.semanticPayloadHash, "semanticPayloadHash", 128);
    required(command.renderedDocumentHash, "renderedDocumentHash", 128);
    required(command.archiveObjectKey, "archiveObjectKey", 1000);
    if (Object.keys(command.totals).length === 0) throw new PlatformError("VALIDATION_FAILED", "totals are required", 400);
    return await this.store.publishLegalDocument(context, command);
  }

  async submitFiscal(context: RequestContext, command: CreateFiscalSubmissionCommand): Promise<FiscalSubmissionResult> {
    requirePermission(context, "localization.fiscal.submit");
    requireLegalEntity(context);
    required(command.submissionId, "submissionId", 64);
    required(command.documentId, "documentId", 64);
    required(command.providerCapabilityId, "providerCapabilityId", 160);
    required(command.countryPackVersion, "countryPackVersion", 80);
    required(command.payloadHash, "payloadHash", 128);
    required(command.idempotencyKey, "idempotencyKey", 200);
    required(command.requestHash, "requestHash", 128);

    const claim = await this.store.createFiscalSubmission(context, command);
    if (claim.replayed) {
      return Object.freeze({ ...claim, observedAt: command.submittedAt });
    }
    const provider = this.providers.require(command.providerCapabilityId);
    if (!provider.supportsCountryPack(command.countryPackVersion)) {
      const result = await this.store.recordFiscalTransition(context, {
        eventId: crypto.randomUUID(),
        submissionId: command.submissionId,
        status: "rejected",
        observedAt: command.submittedAt,
        rejectionCode: "UNSUPPORTED_COUNTRY_PACK",
      });
      return result;
    }
    try {
      const providerResult = await provider.submit({
        submissionId: command.submissionId,
        documentId: command.documentId,
        countryPackVersion: command.countryPackVersion,
        payloadHash: command.payloadHash,
        idempotencyKey: command.idempotencyKey,
      });
      return await this.store.recordFiscalTransition(context, {
        eventId: crypto.randomUUID(),
        submissionId: command.submissionId,
        status: providerTransition(providerResult),
        observedAt: providerResult.observedAt,
        ...(providerResult.providerReference ? { providerReference: providerResult.providerReference } : {}),
        ...(providerResult.rejectionCode ? { rejectionCode: providerResult.rejectionCode } : {}),
      });
    } catch {
      return await this.store.recordFiscalTransition(context, {
        eventId: crypto.randomUUID(),
        submissionId: command.submissionId,
        status: "unknown",
        observedAt: new Date().toISOString(),
        rejectionCode: "PROVIDER_RESULT_UNKNOWN",
      });
    }
  }

  async requestPrivacyOperation(context: RequestContext, command: CreatePrivacyOperationCommand): Promise<PrivacyOperationResult> {
    requirePermission(context, "localization.privacy.execute");
    required(command.operationId, "operationId", 64);
    required(command.subjectReference, "subjectReference", 256);
    required(command.retentionPolicyId, "retentionPolicyId", 64);
    required(command.reason, "reason", 1000);
    required(command.idempotencyKey, "idempotencyKey", 200);
    required(command.requestHash, "requestHash", 128);
    return await this.store.createPrivacyOperation(context, command);
  }

  async transitionPrivacyOperation(context: RequestContext, command: TransitionPrivacyOperationCommand): Promise<PrivacyOperationResult> {
    requirePermission(context, "localization.privacy.execute");
    required(command.operationId, "operationId", 64);
    if (["completed", "partially_completed", "rejected"].includes(command.status) && !command.completedAt) {
      throw new PlatformError("VALIDATION_FAILED", "completedAt is required for a terminal privacy status", 400);
    }
    return await this.store.transitionPrivacyOperation(context, command);
  }
}
