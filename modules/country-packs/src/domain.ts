import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { businessDate, locale, timeZone } from "../../../packages/foundation/src/localization.js";
import { assertNonOverlappingEffectiveRanges, textDirection } from "../../localization/src/domain.js";
import type { CountryPackManifestV1, LegalDocumentTemplateRefV1 } from "./contracts.js";

const semverPattern = /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z.-]+))?$/u;
const hashPattern = /^(?:sha256:)?[a-f0-9]{64}$/u;

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  return normalized;
}

function semanticVersionParts(value: string): readonly [number, number, number, string | undefined] {
  const match = semverPattern.exec(value);
  if (!match?.groups) throw new PlatformError("VALIDATION_FAILED", "Country-pack version must use semantic versioning", 400);
  return [Number(match.groups.major), Number(match.groups.minor), Number(match.groups.patch), match.groups.prerelease];
}

export function compareCountryPackVersions(left: string, right: string): -1 | 0 | 1 {
  const leftParts = semanticVersionParts(left);
  const rightParts = semanticVersionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined || rightPart === undefined) throw new Error("Semantic version parsing failed");
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  const leftPrerelease = leftParts[3];
  const rightPrerelease = rightParts[3];
  if (leftPrerelease === rightPrerelease) return 0;
  if (leftPrerelease === undefined) return 1;
  if (rightPrerelease === undefined) return -1;
  return leftPrerelease.localeCompare(rightPrerelease) < 0 ? -1 : 1;
}

function validateTemplates(templates: readonly LegalDocumentTemplateRefV1[]): void {
  const byDocumentType = new Map<string, LegalDocumentTemplateRefV1[]>();
  for (const template of templates) {
    required(template.templateId, "templateId");
    required(template.templateVersion, "templateVersion");
    if (!hashPattern.test(template.contentHash)) {
      throw new PlatformError("VALIDATION_FAILED", "Legal document template content hash must be SHA-256", 400);
    }
    businessDate(template.effectiveFrom);
    if (template.effectiveTo) businessDate(template.effectiveTo);
    const versions = byDocumentType.get(template.documentType) ?? [];
    versions.push(template);
    byDocumentType.set(template.documentType, versions);
  }
  for (const versions of byDocumentType.values()) assertNonOverlappingEffectiveRanges(versions);
}

export function validateCountryPackManifest(manifest: CountryPackManifestV1): CountryPackManifestV1 {
  required(manifest.packId, "packId");
  if (!/^[A-Z]{2}$/u.test(manifest.countryCode)) {
    throw new PlatformError("VALIDATION_FAILED", "Country code must use uppercase ISO alpha-2 form", 400);
  }
  semanticVersionParts(manifest.version);
  businessDate(manifest.effectiveFrom);
  if (manifest.effectiveTo) {
    businessDate(manifest.effectiveTo);
    if (manifest.effectiveTo < manifest.effectiveFrom) {
      throw new PlatformError("VALIDATION_FAILED", "Country-pack effective range is invalid", 400);
    }
  }

  const defaultLocale = locale(manifest.defaultLocale);
  const localeNames = new Set<string>();
  for (const profile of manifest.localeProfiles) {
    const canonical = locale(profile.locale);
    if (localeNames.has(canonical)) throw new PlatformError("CONFLICT", "Country pack contains a duplicate locale profile", 409);
    localeNames.add(canonical);
    if (profile.direction !== textDirection(canonical)) {
      throw new PlatformError("VALIDATION_FAILED", "Locale direction does not match its Unicode script", 400);
    }
    for (const fallback of profile.fallbackLocales) locale(fallback);
  }
  if (!localeNames.has(defaultLocale)) {
    throw new PlatformError("VALIDATION_FAILED", "Country-pack default locale requires a locale profile", 400);
  }

  const currencyGroups = new Map<string, typeof manifest.currencyMetadata>();
  for (const metadata of manifest.currencyMetadata) {
    const versions = currencyGroups.get(metadata.currency) ?? [];
    currencyGroups.set(metadata.currency, [...versions, metadata]);
  }
  for (const versions of currencyGroups.values()) assertNonOverlappingEffectiveRanges(versions);

  const boundaryGroups = new Map<string, typeof manifest.businessDayBoundaries>();
  for (const boundary of manifest.businessDayBoundaries) {
    timeZone(boundary.timeZone);
    const versions = boundaryGroups.get(boundary.timeZone) ?? [];
    boundaryGroups.set(boundary.timeZone, [...versions, boundary]);
  }
  for (const versions of boundaryGroups.values()) assertNonOverlappingEffectiveRanges(versions);

  if (manifest.capabilities.fiscalSubmission && !manifest.capabilities.legalReceipts && !manifest.capabilities.legalInvoices) {
    throw new PlatformError("VALIDATION_FAILED", "Fiscal submission requires a supported legal document", 400);
  }
  if (manifest.capabilities.electronicInvoicing && !manifest.capabilities.legalInvoices) {
    throw new PlatformError("VALIDATION_FAILED", "Electronic invoicing requires legal invoice support", 400);
  }
  if (manifest.capabilities.offlineLegalCapability !== "unsupported" && !manifest.capabilities.legalReceipts) {
    throw new PlatformError("VALIDATION_FAILED", "Offline legal capability requires legal receipt support", 400);
  }

  validateTemplates(manifest.legalDocumentTemplates);
  required(manifest.privacyPolicyVersion, "privacyPolicyVersion");
  required(manifest.dataResidencyPolicyVersion, "dataResidencyPolicyVersion");
  if (!hashPattern.test(manifest.manifestHash)) {
    throw new PlatformError("VALIDATION_FAILED", "Country-pack manifest hash must be SHA-256", 400);
  }
  required(manifest.signature, "signature");
  required(manifest.signingKeyId, "signingKeyId");
  const publishedAt = new Date(manifest.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) throw new PlatformError("VALIDATION_FAILED", "publishedAt must be a timestamp", 400);

  return Object.freeze({
    ...manifest,
    localeProfiles: Object.freeze([...manifest.localeProfiles]),
    currencyMetadata: Object.freeze([...manifest.currencyMetadata]),
    businessDayBoundaries: Object.freeze([...manifest.businessDayBoundaries]),
    legalDocumentTemplates: Object.freeze([...manifest.legalDocumentTemplates]),
  });
}

export function selectEffectiveCountryPack(
  manifests: readonly CountryPackManifestV1[],
  packId: string,
  onDate: string,
): CountryPackManifestV1 {
  const date = businessDate(onDate);
  const matches = manifests.filter((manifest) => {
    validateCountryPackManifest(manifest);
    return manifest.packId === packId && manifest.effectiveFrom <= date && (!manifest.effectiveTo || manifest.effectiveTo >= date);
  });
  if (matches.length === 0) throw new PlatformError("NOT_FOUND", "No effective country-pack version exists", 404);
  if (matches.length > 1) throw new PlatformError("CONFLICT", "Country-pack effective versions overlap", 409);
  const selected = matches[0];
  if (!selected) throw new Error("Effective country-pack selection failed");
  return selected;
}

export function assertCountryPackUpgrade(previous: CountryPackManifestV1, next: CountryPackManifestV1): void {
  validateCountryPackManifest(previous);
  validateCountryPackManifest(next);
  if (previous.packId !== next.packId || previous.countryCode !== next.countryCode) {
    throw new PlatformError("VALIDATION_FAILED", "Country-pack upgrade must retain pack and country identity", 400);
  }
  if (compareCountryPackVersions(next.version, previous.version) <= 0) {
    throw new PlatformError("VALIDATION_FAILED", "Country-pack upgrade version must increase", 400);
  }
  if (next.effectiveFrom <= previous.effectiveFrom) {
    throw new PlatformError("VALIDATION_FAILED", "Country-pack upgrade must have a later effective date", 400);
  }
  if (!previous.effectiveTo || previous.effectiveTo >= next.effectiveFrom) {
    throw new PlatformError("CONFLICT", "Previous country-pack version must end before the upgrade starts", 409);
  }
}
