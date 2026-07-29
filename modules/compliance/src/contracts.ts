import type { AuditMetadataV1, MoneyV1, ScopeContextV1 } from "../../../packages/contracts/src/v1/common.js";

export type LegalDocumentType = "receipt" | "invoice" | "credit_note" | "debit_note" | "delivery_note";
export type FiscalSubmissionStatus = "not_required" | "pending" | "accepted" | "rejected" | "unknown" | "corrected";
export type PrivacyOperationType = "access" | "export" | "correct" | "anonymize" | "erase" | "restrict";

export interface LegalNumberScopeV1 {
  readonly schemaVersion: "1.0";
  readonly scopeId: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly storeId?: string;
  readonly documentType: LegalDocumentType;
  readonly fiscalYear: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly minimumValue: string;
  readonly maximumValue: string;
  readonly width: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly offlineAllocationAllowed: boolean;
  readonly sequenceVersion: string;
}

export interface LegalNumberAllocationV1 {
  readonly allocationId: string;
  readonly scopeId: string;
  readonly operationId: string;
  readonly numericValue: string;
  readonly legalNumber: string;
  readonly allocatedAt: string;
  readonly allocationMode: "online" | "offline_block";
  readonly deviceId?: string;
}

export interface LegalDocumentSnapshotV1 {
  readonly schemaVersion: "1.0";
  readonly documentId: string;
  readonly context: ScopeContextV1;
  readonly documentType: LegalDocumentType;
  readonly legalNumber: string;
  readonly businessDate: string;
  readonly issuedAt: string;
  readonly countryPackId: string;
  readonly countryPackVersion: string;
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
  readonly fiscalStatus: FiscalSubmissionStatus;
  readonly correctionOfDocumentId?: string;
  readonly audit: AuditMetadataV1;
}

export interface FiscalSubmissionRequestV1 {
  readonly schemaVersion: "1.0";
  readonly submissionId: string;
  readonly documentId: string;
  readonly providerCapabilityId: string;
  readonly countryPackVersion: string;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly submittedAt: string;
}

export interface FiscalSubmissionResultV1 {
  readonly submissionId: string;
  readonly documentId: string;
  readonly status: Exclude<FiscalSubmissionStatus, "not_required">;
  readonly providerReference?: string;
  readonly rejectionCode?: string;
  readonly rejectionMessage?: string;
  readonly retryAfter?: string;
  readonly observedAt: string;
}

export interface RetentionPolicyV1 {
  readonly schemaVersion: "1.0";
  readonly policyId: string;
  readonly version: string;
  readonly dataCategory: string;
  readonly retentionDays: number;
  readonly legalBasis: string;
  readonly immutableEvidenceRequired: boolean;
  readonly anonymizationAllowed: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface PrivacyOperationV1 {
  readonly schemaVersion: "1.0";
  readonly operationId: string;
  readonly context: ScopeContextV1;
  readonly subjectReference: string;
  readonly operationType: PrivacyOperationType;
  readonly policyVersion: string;
  readonly status: "requested" | "approved" | "running" | "completed" | "partially_completed" | "rejected";
  readonly preservedEvidenceReferences: readonly string[];
  readonly affectedResourceReferences: readonly string[];
  readonly requestedAt: string;
  readonly completedAt?: string;
  readonly reason: string;
  readonly audit: AuditMetadataV1;
}

export interface DataResidencyPolicyV1 {
  readonly schemaVersion: "1.0";
  readonly policyId: string;
  readonly version: string;
  readonly allowedRegions: readonly string[];
  readonly storageProviders: readonly string[];
  readonly processingProviders: readonly string[];
  readonly backupRegions: readonly string[];
  readonly crossBorderTransferBasis?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}
