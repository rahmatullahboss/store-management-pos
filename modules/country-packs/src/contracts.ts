import type { ScopeContextV1 } from "../../../packages/contracts/src/v1/common.js";
import type { BusinessDayBoundaryV1, CurrencyMetadataV1, LocaleProfileV1 } from "../../localization/src/contracts.js";

export type CountrySupportLevel = "experimental" | "limited" | "validated";
export type OfflineLegalCapability = "unsupported" | "cash_only" | "contingency_receipts" | "fully_supported";

export interface CountryPackCapabilityV1 {
  readonly taxConfiguration: boolean;
  readonly accountingMapping: boolean;
  readonly legalReceipts: boolean;
  readonly legalInvoices: boolean;
  readonly creditDebitDocuments: boolean;
  readonly fiscalSubmission: boolean;
  readonly electronicInvoicing: boolean;
  readonly privacyWorkflow: boolean;
  readonly offlineLegalCapability: OfflineLegalCapability;
}

export interface LegalDocumentTemplateRefV1 {
  readonly documentType: "receipt" | "invoice" | "credit_note" | "debit_note" | "delivery_note";
  readonly templateId: string;
  readonly templateVersion: string;
  readonly contentHash: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface CountryPackManifestV1 {
  readonly schemaVersion: "1.0";
  readonly packId: string;
  readonly countryCode: string;
  readonly version: string;
  readonly supportLevel: CountrySupportLevel;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly defaultLocale: string;
  readonly localeProfiles: readonly LocaleProfileV1[];
  readonly currencyMetadata: readonly CurrencyMetadataV1[];
  readonly businessDayBoundaries: readonly BusinessDayBoundaryV1[];
  readonly capabilities: CountryPackCapabilityV1;
  readonly taxConfigurationVersion?: string;
  readonly accountingMappingVersion?: string;
  readonly legalDocumentTemplates: readonly LegalDocumentTemplateRefV1[];
  readonly privacyPolicyVersion: string;
  readonly dataResidencyPolicyVersion: string;
  readonly manifestHash: string;
  readonly signature: string;
  readonly signingKeyId: string;
  readonly publishedAt: string;
}

export interface CountryPackActivationV1 {
  readonly schemaVersion: "1.0";
  readonly activationId: string;
  readonly context: ScopeContextV1;
  readonly packId: string;
  readonly packVersion: string;
  readonly activatedAt: string;
  readonly effectiveFrom: string;
  readonly deactivatedAt?: string;
  readonly previousActivationId?: string;
  readonly approvedBy: string;
  readonly reason: string;
}

export interface CountryPackSupportMatrixV1 {
  readonly packId: string;
  readonly packVersion: string;
  readonly supportLevel: CountrySupportLevel;
  readonly capabilities: CountryPackCapabilityV1;
  readonly validatedExamples: readonly string[];
  readonly limitations: readonly string[];
  readonly reviewedAt: string;
  readonly reviewedBy: string;
}
