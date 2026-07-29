import type { CountryPackManifestV1, CountryPackSupportMatrixV1 } from "./contracts.js";
import { validateCountryPackManifest } from "./domain.js";

const hash = (character: string): string => `sha256:${character.repeat(64)}`;

export const BANGLADESH_COUNTRY_PACK: CountryPackManifestV1 = validateCountryPackManifest({
  schemaVersion: "1.0",
  packId: "country.bd",
  countryCode: "BD",
  version: "1.0.0",
  supportLevel: "limited",
  effectiveFrom: "2026-01-01",
  defaultLocale: "bn-BD",
  localeProfiles: [
    { schemaVersion: "1.0", locale: "bn-BD", fallbackLocales: ["bn", "en"], direction: "ltr", numberingSystem: "beng" },
    { schemaVersion: "1.0", locale: "en-BD", fallbackLocales: ["en"], direction: "ltr", numberingSystem: "latn" },
    { schemaVersion: "1.0", locale: "en", fallbackLocales: [], direction: "ltr", numberingSystem: "latn" },
  ],
  currencyMetadata: [{
    schemaVersion: "1.0",
    currency: "BDT",
    accountingScale: 2,
    cashIncrementMinor: "100",
    cashRoundingMode: "nearest",
    effectiveFrom: "2026-01-01",
    metadataVersion: "bdt-2026-v1",
  }],
  businessDayBoundaries: [{
    schemaVersion: "1.0",
    timeZone: "Asia/Dhaka",
    localStartTime: "06:00",
    effectiveFrom: "2026-01-01",
    boundaryVersion: "bd-business-day-v1",
  }],
  capabilities: {
    taxConfiguration: true,
    accountingMapping: true,
    legalReceipts: true,
    legalInvoices: true,
    creditDebitDocuments: true,
    fiscalSubmission: false,
    electronicInvoicing: false,
    privacyWorkflow: true,
    offlineLegalCapability: "unsupported",
  },
  taxConfigurationVersion: "bd-tax-mapping-v1",
  accountingMappingVersion: "bd-accounting-mapping-v1",
  legalDocumentTemplates: [
    {
      documentType: "receipt",
      templateId: "bd-receipt",
      templateVersion: "1.0.0",
      contentHash: hash("a"),
      effectiveFrom: "2026-01-01",
    },
    {
      documentType: "invoice",
      templateId: "bd-invoice",
      templateVersion: "1.0.0",
      contentHash: hash("b"),
      effectiveFrom: "2026-01-01",
    },
  ],
  privacyPolicyVersion: "bd-privacy-baseline-v1",
  dataResidencyPolicyVersion: "bd-residency-baseline-v1",
  manifestHash: hash("c"),
  signature: "fixture-signature-country-bd-v1",
  signingKeyId: "fixture-key-mod-f-v1",
  publishedAt: "2025-12-01T00:00:00.000Z",
});

export const BANGLADESH_SUPPORT_MATRIX: CountryPackSupportMatrixV1 = Object.freeze({
  packId: BANGLADESH_COUNTRY_PACK.packId,
  packVersion: BANGLADESH_COUNTRY_PACK.version,
  supportLevel: "limited",
  capabilities: BANGLADESH_COUNTRY_PACK.capabilities,
  validatedExamples: Object.freeze([
    "Bengali and English locale fallback",
    "BDT integer-minor-unit cash rounding",
    "Asia/Dhaka business-date boundary",
    "Immutable receipt and invoice template version references",
  ]),
  limitations: Object.freeze([
    "No production legal or tax compliance claim is made by this fixture.",
    "Local accounting, tax and legal review is required before production activation.",
    "Fiscal submission, electronic invoicing and offline legal issuance are disabled.",
  ]),
  reviewedAt: "2026-07-29T00:00:00.000Z",
  reviewedBy: "MOD-F engineering fixture review",
});

export const SYNTHETIC_XZ_COUNTRY_PACK: CountryPackManifestV1 = validateCountryPackManifest({
  schemaVersion: "1.0",
  packId: "country.xz",
  countryCode: "XZ",
  version: "1.0.0",
  supportLevel: "experimental",
  effectiveFrom: "2026-01-01",
  defaultLocale: "en",
  localeProfiles: [
    { schemaVersion: "1.0", locale: "en", fallbackLocales: [], direction: "ltr", numberingSystem: "latn" },
    { schemaVersion: "1.0", locale: "ar-XZ", fallbackLocales: ["en"], direction: "rtl", numberingSystem: "arab" },
    { schemaVersion: "1.0", locale: "ja-XZ", fallbackLocales: ["en"], direction: "ltr", numberingSystem: "latn" },
  ],
  currencyMetadata: [{
    schemaVersion: "1.0",
    currency: "XTS",
    accountingScale: 3,
    cashIncrementMinor: "5",
    cashRoundingMode: "nearest",
    effectiveFrom: "2026-01-01",
    metadataVersion: "xts-synthetic-v1",
  }],
  businessDayBoundaries: [{
    schemaVersion: "1.0",
    timeZone: "UTC",
    localStartTime: "00:00",
    effectiveFrom: "2026-01-01",
    boundaryVersion: "xz-boundary-v1",
  }],
  capabilities: {
    taxConfiguration: false,
    accountingMapping: false,
    legalReceipts: false,
    legalInvoices: false,
    creditDebitDocuments: false,
    fiscalSubmission: false,
    electronicInvoicing: false,
    privacyWorkflow: true,
    offlineLegalCapability: "unsupported",
  },
  legalDocumentTemplates: [],
  privacyPolicyVersion: "xz-synthetic-privacy-v1",
  dataResidencyPolicyVersion: "xz-synthetic-residency-v1",
  manifestHash: hash("d"),
  signature: "fixture-signature-country-xz-v1",
  signingKeyId: "fixture-key-mod-f-v1",
  publishedAt: "2025-12-01T00:00:00.000Z",
});

export const SYNTHETIC_XZ_SUPPORT_MATRIX: CountryPackSupportMatrixV1 = Object.freeze({
  packId: SYNTHETIC_XZ_COUNTRY_PACK.packId,
  packVersion: SYNTHETIC_XZ_COUNTRY_PACK.version,
  supportLevel: "experimental",
  capabilities: SYNTHETIC_XZ_COUNTRY_PACK.capabilities,
  validatedExamples: Object.freeze([
    "Data-only installation without country-specific core columns",
    "Arabic RTL and Japanese CJK locale profiles",
    "Three-decimal synthetic currency metadata",
  ]),
  limitations: Object.freeze(["Synthetic test pack; it must never be presented as a real jurisdiction."]),
  reviewedAt: "2026-07-29T00:00:00.000Z",
  reviewedBy: "MOD-F engineering fixture review",
});

export const BUILTIN_COUNTRY_PACKS = Object.freeze([
  BANGLADESH_COUNTRY_PACK,
  SYNTHETIC_XZ_COUNTRY_PACK,
]);
