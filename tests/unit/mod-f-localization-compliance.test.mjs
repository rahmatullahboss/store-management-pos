import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNonOverlappingEffectiveRanges,
  buildLocaleFallbackChain,
  businessDateForInstant,
  roundCashAmount,
  selectCurrencyMetadata,
  textDirection,
} from "../../build/modules/localization/src/domain.js";
import {
  assertCountryPackUpgrade,
  selectEffectiveCountryPack,
  validateCountryPackManifest,
} from "../../build/modules/country-packs/src/domain.js";
import {
  allocateLegalNumber,
  createLegalNumberSequence,
  resolvePrivacyDisposition,
} from "../../build/modules/compliance/src/domain.js";
import { money } from "../../build/packages/foundation/src/money.js";

const hash = `sha256:${"a".repeat(64)}`;

function platformError(code) {
  return (error) => error instanceof Error && error.code === code;
}

function bdtMetadata(overrides = {}) {
  return {
    schemaVersion: "1.0",
    currency: "BDT",
    accountingScale: 2,
    cashIncrementMinor: "100",
    cashRoundingMode: "nearest",
    effectiveFrom: "2026-01-01",
    metadataVersion: "bdt-2026-v1",
    ...overrides,
  };
}

function boundary(overrides = {}) {
  return {
    schemaVersion: "1.0",
    timeZone: "Asia/Dhaka",
    localStartTime: "06:00",
    effectiveFrom: "2026-01-01",
    boundaryVersion: "bd-business-day-v1",
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    schemaVersion: "1.0",
    packId: "country.bd",
    countryCode: "BD",
    version: "1.0.0",
    supportLevel: "limited",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    defaultLocale: "bn-BD",
    localeProfiles: [
      { schemaVersion: "1.0", locale: "bn-BD", fallbackLocales: ["bn", "en"], direction: "ltr" },
      { schemaVersion: "1.0", locale: "en", fallbackLocales: [], direction: "ltr" },
    ],
    currencyMetadata: [bdtMetadata()],
    businessDayBoundaries: [boundary()],
    capabilities: {
      taxConfiguration: true,
      accountingMapping: true,
      legalReceipts: true,
      legalInvoices: true,
      creditDebitDocuments: true,
      fiscalSubmission: false,
      electronicInvoicing: false,
      privacyWorkflow: true,
      offlineLegalCapability: "cash_only",
    },
    taxConfigurationVersion: "bd-tax-v1",
    accountingMappingVersion: "bd-coa-v1",
    legalDocumentTemplates: [
      {
        documentType: "receipt",
        templateId: "bd-receipt",
        templateVersion: "1.0.0",
        contentHash: hash,
        effectiveFrom: "2026-01-01",
      },
    ],
    privacyPolicyVersion: "bd-privacy-v1",
    dataResidencyPolicyVersion: "bd-residency-v1",
    manifestHash: hash,
    signature: "test-signature",
    signingKeyId: "test-key-1",
    publishedAt: "2025-12-01T00:00:00Z",
    ...overrides,
  };
}

test("BCP 47 fallback preserves Bengali preference and reaches the configured default", () => {
  assert.deepEqual(
    buildLocaleFallbackChain("bn-BD-u-nu-beng", ["bn-BD", "bn", "en"], "en"),
    ["bn-BD", "bn", "en"],
  );
  assert.equal(textDirection("ar-BD"), "rtl");
  assert.equal(textDirection("ja-JP"), "ltr");
  assert.throws(() => buildLocaleFallbackChain("bn-BD", ["bn-BD"], "en"), platformError("VALIDATION_FAILED"));
});

test("cash rounding is exact and nearest ties round away from zero", () => {
  assert.equal(roundCashAmount(money(12_345n, "BDT", 2), bdtMetadata()).amountMinor, 12_300n);
  assert.equal(roundCashAmount(money(12_350n, "BDT", 2), bdtMetadata()).amountMinor, 12_400n);
  assert.equal(roundCashAmount(money(-12_350n, "BDT", 2), bdtMetadata()).amountMinor, -12_400n);
  assert.equal(roundCashAmount(money(12_301n, "BDT", 2), bdtMetadata({ cashRoundingMode: "up" })).amountMinor, 12_400n);
  assert.equal(roundCashAmount(money(12_399n, "BDT", 2), bdtMetadata({ cashRoundingMode: "down" })).amountMinor, 12_300n);
  assert.throws(() => roundCashAmount(money(100n, "USD", 2), bdtMetadata()), platformError("VALIDATION_FAILED"));
});

test("Dhaka business date honors a local 06:00 boundary without rewriting historical instants", () => {
  assert.equal(businessDateForInstant("2026-07-29T23:30:00Z", boundary()), "2026-07-29");
  assert.equal(businessDateForInstant("2026-07-30T00:30:00Z", boundary()), "2026-07-30");
});

test("effective-dated metadata selects one version and rejects overlap", () => {
  const first = bdtMetadata({ effectiveTo: "2026-06-30" });
  const second = bdtMetadata({ effectiveFrom: "2026-07-01", metadataVersion: "bdt-2026-v2", cashIncrementMinor: "50" });
  assert.equal(selectCurrencyMetadata([first, second], "BDT", "2026-07-29").metadataVersion, "bdt-2026-v2");
  assert.doesNotThrow(() => assertNonOverlappingEffectiveRanges([first, second]));
  assert.throws(
    () => assertNonOverlappingEffectiveRanges([first, { ...second, effectiveFrom: "2026-06-30" }]),
    platformError("CONFLICT"),
  );
});

test("country packs validate independently and effective versions remain immutable", () => {
  const first = validateCountryPackManifest(manifest());
  const second = validateCountryPackManifest(manifest({
    version: "1.1.0",
    effectiveFrom: "2027-01-01",
    effectiveTo: undefined,
    manifestHash: `sha256:${"b".repeat(64)}`,
  }));
  assert.equal(selectEffectiveCountryPack([first, second], "country.bd", "2027-03-01").version, "1.1.0");
  assert.doesNotThrow(() => assertCountryPackUpgrade(first, second));

  const synthetic = validateCountryPackManifest(manifest({
    packId: "country.xz",
    countryCode: "XZ",
    defaultLocale: "en",
    localeProfiles: [{ schemaVersion: "1.0", locale: "en", fallbackLocales: [], direction: "ltr" }],
    manifestHash: `sha256:${"c".repeat(64)}`,
  }));
  assert.equal(synthetic.countryCode, "XZ");
  assert.throws(() => validateCountryPackManifest(manifest({ countryCode: "Bangladesh" })), platformError("VALIDATION_FAILED"));
});

test("legal numbering is collision-free, idempotent and enforces offline capability", () => {
  const scope = {
    schemaVersion: "1.0",
    scopeId: "scope-1",
    tenantId: "tenant-1",
    legalEntityId: "entity-1",
    documentType: "receipt",
    fiscalYear: "2026-2027",
    prefix: "BD-",
    suffix: "",
    minimumValue: "1",
    maximumValue: "2",
    width: 4,
    effectiveFrom: "2026-07-01",
    offlineAllocationAllowed: false,
    sequenceVersion: "1",
  };
  let state = createLegalNumberSequence(scope);
  const first = allocateLegalNumber(state, {
    allocationId: "allocation-1",
    operationId: "operation-1",
    allocatedAt: "2026-07-29T08:00:00Z",
    allocationMode: "online",
  });
  state = first.state;
  assert.equal(first.allocation.legalNumber, "BD-0001");
  const replay = allocateLegalNumber(state, {
    allocationId: "different-id-is-ignored-on-operation-replay",
    operationId: "operation-1",
    allocatedAt: "2026-07-29T09:00:00Z",
    allocationMode: "online",
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.allocation.legalNumber, "BD-0001");
  assert.throws(() => allocateLegalNumber(state, {
    allocationId: "allocation-offline",
    operationId: "operation-offline",
    allocatedAt: "2026-07-29T09:00:00Z",
    allocationMode: "offline_block",
    deviceId: "device-1",
  }), platformError("FORBIDDEN"));
});

test("privacy erasure preserves legally required evidence through anonymization", () => {
  const policy = {
    schemaVersion: "1.0",
    policyId: "patient-identity-retention",
    version: "1",
    dataCategory: "customer_identity",
    retentionDays: 2555,
    legalBasis: "statutory accounting retention",
    immutableEvidenceRequired: true,
    anonymizationAllowed: true,
    effectiveFrom: "2026-01-01",
  };
  const disposition = resolvePrivacyDisposition(policy, "erase", false);
  assert.equal(disposition.allowed, true);
  assert.equal(disposition.effective, "anonymize");
  assert.equal(disposition.preserveImmutableEvidence, true);
});
