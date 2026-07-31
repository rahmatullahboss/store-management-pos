import { createHash } from "node:crypto";

const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const PROVIDERS = new Set(["cloud-kms", "managed-hsm", "pkcs11-hsm"]);
const PURPOSES = new Set(["read-token", "command-token"]);
const MAX_ROWS = 100_000;
const MAX_RETENTION_DAYS = 3_650;
const DAY = 86_400;

export const INTERNAL_TOKEN_PROVIDER_EVIDENCE_EXPORT_SCHEMA_VERSION = 1;
export const INTERNAL_TOKEN_PROVIDER_EVIDENCE_PRIVACY_PROFILE = "digest-only-v1";
export const INTERNAL_TOKEN_PROVIDER_EVIDENCE_CUSTODY_SQL = `SELECT
  platform.append_internal_token_provider_evidence_custody(
    $1::bigint,$2::text,$3::text,$4::text,$5::text,$6::text,
    $7::integer,$8::integer,$9::integer,$10::integer,
    $11::timestamptz,$12::timestamptz,$13::text,$14::text
  ) IS NOT NULL AS recorded`;

function fail(message) {
  throw new Error(`Internal-token provider evidence custody: ${message}`);
}

function exact(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} is invalid`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${name} fields are invalid`);
  }
  return value;
}

function integer(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${name} is invalid`);
  }
  return value;
}

function digest(value, name) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${name} is invalid`);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("base64url");
}

function policy(input, generatedAt) {
  const value = exact(input, [
    "approvalDigest", "effectiveAt", "expiresAt", "maximumExportRows",
    "policyDigest", "retentionDays", "schemaVersion",
  ], "retention policy");
  if (value.schemaVersion !== 1) fail("retention policy schema version is invalid");
  const body = {
    approvalDigest: digest(value.approvalDigest, "retention approval digest"),
    effectiveAt: integer(value.effectiveAt, "policy effective-at", 1),
    expiresAt: integer(value.expiresAt, "policy expiry", 1),
    maximumExportRows: integer(value.maximumExportRows, "maximum export rows", 1, MAX_ROWS),
    retentionDays: integer(value.retentionDays, "retention days", 1, MAX_RETENTION_DAYS),
    schemaVersion: 1,
  };
  if (body.expiresAt <= body.effectiveAt || generatedAt < body.effectiveAt || generatedAt > body.expiresAt) {
    fail("retention policy is not effective");
  }
  const policyDigest = digest(value.policyDigest, "retention policy digest");
  if (hash(body) !== policyDigest || policyDigest === body.approvalDigest) {
    fail("retention policy digest does not match");
  }
  return Object.freeze({ ...body, policyDigest });
}

function hold(input) {
  const value = exact(input, [
    "holdDigest", "imposedAt", "releasedAt", "scopeEndsAt", "scopeStartsAt", "schemaVersion",
  ], "legal hold");
  if (value.schemaVersion !== 1) fail("legal-hold schema version is invalid");
  const body = {
    imposedAt: integer(value.imposedAt, "hold imposed-at", 1),
    releasedAt: value.releasedAt === null ? null : integer(value.releasedAt, "hold released-at", 1),
    schemaVersion: 1,
    scopeEndsAt: value.scopeEndsAt === null ? null : integer(value.scopeEndsAt, "hold scope end", 1),
    scopeStartsAt: integer(value.scopeStartsAt, "hold scope start", 1),
  };
  if ((body.scopeEndsAt !== null && body.scopeEndsAt < body.scopeStartsAt) ||
      (body.releasedAt !== null && body.releasedAt <= body.imposedAt)) {
    fail("legal-hold window is invalid");
  }
  const holdDigest = digest(value.holdDigest, "legal-hold digest");
  if (hash(body) !== holdDigest) fail("legal-hold digest does not match");
  return Object.freeze({ ...body, holdDigest });
}

function sourceRecord(input) {
  const value = exact(input, [
    "algorithm", "auditReferenceDigest", "digestAlgorithm", "hardwareProtected",
    "keyReferenceDigest", "keyVersionDigest", "latencyMs", "nonExportable",
    "occurredAt", "operationDigest", "providerClass", "purpose", "receiptValidated",
    "requestDigest", "signatureByteLength", "signatureDigest", "signingInputDigest",
  ], "provider evidence record");
  const record = {
    algorithm: value.algorithm,
    auditReferenceDigest: digest(value.auditReferenceDigest, "audit-reference digest"),
    digestAlgorithm: value.digestAlgorithm,
    hardwareProtected: value.hardwareProtected,
    keyReferenceDigest: digest(value.keyReferenceDigest, "key-reference digest"),
    keyVersionDigest: digest(value.keyVersionDigest, "key-version digest"),
    latencyMs: integer(value.latencyMs, "provider latency", 0, 5_000),
    nonExportable: value.nonExportable,
    occurredAt: integer(value.occurredAt, "occurrence time", 1),
    operationDigest: digest(value.operationDigest, "operation digest"),
    providerClass: value.providerClass,
    purpose: value.purpose,
    receiptValidated: value.receiptValidated,
    requestDigest: digest(value.requestDigest, "request digest"),
    signatureByteLength: integer(value.signatureByteLength, "signature length", 256, 512),
    signatureDigest: digest(value.signatureDigest, "signature digest"),
    signingInputDigest: digest(value.signingInputDigest, "signing-input digest"),
  };
  if (record.algorithm !== "RS256" || record.digestAlgorithm !== "SHA-256" ||
      !PROVIDERS.has(record.providerClass) || !PURPOSES.has(record.purpose) ||
      record.nonExportable !== true || record.hardwareProtected !== true ||
      record.receiptValidated !== true) {
    fail("provider evidence classification or attestation is invalid");
  }
  const digests = [
    record.requestDigest, record.signingInputDigest, record.keyReferenceDigest,
    record.keyVersionDigest, record.auditReferenceDigest, record.operationDigest,
    record.signatureDigest,
  ];
  if (new Set(digests).size !== digests.length) fail("provider evidence digests must be distinct");
  return Object.freeze(record);
}

function activeHold(record, holds, generatedAt) {
  return holds.some((item) =>
    item.imposedAt <= generatedAt &&
    (item.releasedAt === null || item.releasedAt > generatedAt) &&
    record.occurredAt >= item.scopeStartsAt &&
    (item.scopeEndsAt === null || record.occurredAt <= item.scopeEndsAt));
}

export function createInternalTokenProviderEvidencePolicyDigest(input) {
  return hash(exact(input, [
    "approvalDigest", "effectiveAt", "expiresAt", "maximumExportRows",
    "retentionDays", "schemaVersion",
  ], "retention policy body"));
}

export function createInternalTokenProviderEvidenceHoldDigest(input) {
  return hash(exact(input, [
    "imposedAt", "releasedAt", "scopeEndsAt", "scopeStartsAt", "schemaVersion",
  ], "legal-hold body"));
}

export function buildInternalTokenProviderEvidenceExport(recordsInput, policyInput, holdsInput, generatedAtInput) {
  const generatedAt = integer(generatedAtInput, "export generation time", 1);
  if (!Array.isArray(recordsInput) || recordsInput.length === 0) fail("provider evidence records are required");
  if (!Array.isArray(holdsInput)) fail("legal holds are invalid");
  const approvedPolicy = policy(policyInput, generatedAt);
  if (recordsInput.length > approvedPolicy.maximumExportRows) fail("approved export row limit exceeded");
  const holds = holdsInput.map(hold);
  if (new Set(holds.map((item) => item.holdDigest)).size !== holds.length) fail("legal-hold digests must be unique");
  const records = recordsInput.map(sourceRecord).sort((left, right) =>
    left.occurredAt - right.occurredAt || left.requestDigest.localeCompare(right.requestDigest));
  for (const key of ["requestDigest", "operationDigest", "signatureDigest"]) {
    if (new Set(records.map((item) => item[key])).size !== records.length) {
      fail(`provider evidence ${key} values must be unique`);
    }
  }

  let previousRecordDigest = null;
  const exported = records.map((record, index) => {
    if (record.occurredAt > generatedAt) fail("provider evidence record is from the future");
    const retentionUntil = record.occurredAt + approvedPolicy.retentionDays * DAY;
    if (!Number.isSafeInteger(retentionUntil)) fail("retention horizon overflowed");
    const legalHold = activeHold(record, holds, generatedAt);
    const body = {
      algorithm: record.algorithm,
      digestAlgorithm: record.digestAlgorithm,
      eligibleForDisposal: generatedAt >= retentionUntil && !legalHold,
      hardwareProtected: true,
      latencyMs: record.latencyMs,
      legalHold,
      nonExportable: true,
      occurredAt: record.occurredAt,
      previousRecordDigest,
      providerClass: record.providerClass,
      purpose: record.purpose,
      receiptValidated: true,
      retentionUntil,
      sequence: index + 1,
      signatureByteLength: record.signatureByteLength,
      sourceRecordDigest: hash(record),
    };
    const recordDigest = hash(body);
    previousRecordDigest = recordDigest;
    return Object.freeze({ ...body, recordDigest });
  });
  if (new Set(exported.map((item) => item.sourceRecordDigest)).size !== exported.length) {
    fail("provider evidence source records must be unique");
  }
  const body = {
    chainRootDigest: previousRecordDigest,
    earliestOccurredAt: exported[0].occurredAt,
    eligibleForDisposalCount: exported.filter((item) => item.eligibleForDisposal).length,
    generatedAt,
    latestOccurredAt: exported.at(-1).occurredAt,
    legalHoldCount: exported.filter((item) => item.legalHold).length,
    minimumRetainedUntil: Math.max(generatedAt, ...exported.map((item) => item.retentionUntil)),
    policyDigest: approvedPolicy.policyDigest,
    privacyProfile: INTERNAL_TOKEN_PROVIDER_EVIDENCE_PRIVACY_PROFILE,
    recordCount: exported.length,
    records: Object.freeze(exported),
    retentionDays: approvedPolicy.retentionDays,
    schemaVersion: 1,
    status: "sealed",
  };
  return Object.freeze({ ...body, exportDigest: hash(body) });
}

function exportedRecord(input, sequence, previousRecordDigest, generatedAt, retentionDays) {
  const value = exact(input, [
    "algorithm", "digestAlgorithm", "eligibleForDisposal", "hardwareProtected",
    "latencyMs", "legalHold", "nonExportable", "occurredAt", "previousRecordDigest",
    "providerClass", "purpose", "receiptValidated", "recordDigest", "retentionUntil",
    "sequence", "signatureByteLength", "sourceRecordDigest",
  ], "export record");
  if (value.sequence !== sequence || value.previousRecordDigest !== previousRecordDigest) {
    fail("export record sequence or linkage is invalid");
  }
  const body = {
    algorithm: value.algorithm,
    digestAlgorithm: value.digestAlgorithm,
    eligibleForDisposal: value.eligibleForDisposal,
    hardwareProtected: value.hardwareProtected,
    latencyMs: integer(value.latencyMs, "provider latency", 0, 5_000),
    legalHold: value.legalHold,
    nonExportable: value.nonExportable,
    occurredAt: integer(value.occurredAt, "occurrence time", 1),
    previousRecordDigest: value.previousRecordDigest,
    providerClass: value.providerClass,
    purpose: value.purpose,
    receiptValidated: value.receiptValidated,
    retentionUntil: integer(value.retentionUntil, "retention horizon", 1),
    sequence,
    signatureByteLength: integer(value.signatureByteLength, "signature length", 256, 512),
    sourceRecordDigest: digest(value.sourceRecordDigest, "source record digest"),
  };
  if (body.algorithm !== "RS256" || body.digestAlgorithm !== "SHA-256" ||
      !PROVIDERS.has(body.providerClass) || !PURPOSES.has(body.purpose) ||
      body.nonExportable !== true || body.hardwareProtected !== true ||
      body.receiptValidated !== true || typeof body.legalHold !== "boolean" ||
      typeof body.eligibleForDisposal !== "boolean") {
    fail("export record classification is invalid");
  }
  const expectedRetention = body.occurredAt + retentionDays * DAY;
  const expectedEligibility = generatedAt >= expectedRetention && !body.legalHold;
  if (body.retentionUntil !== expectedRetention || body.eligibleForDisposal !== expectedEligibility) {
    fail("export record retention decision does not match");
  }
  const recordDigest = digest(value.recordDigest, "export record digest");
  if (hash(body) !== recordDigest) fail("export record digest does not match");
  return Object.freeze({ ...body, recordDigest });
}

export function verifyInternalTokenProviderEvidenceExport(input) {
  const value = exact(input, [
    "chainRootDigest", "earliestOccurredAt", "eligibleForDisposalCount",
    "exportDigest", "generatedAt", "latestOccurredAt", "legalHoldCount",
    "minimumRetainedUntil", "policyDigest", "privacyProfile", "recordCount",
    "records", "retentionDays", "schemaVersion", "status",
  ], "provider evidence export");
  if (value.schemaVersion !== 1 || value.privacyProfile !== "digest-only-v1" || value.status !== "sealed") {
    fail("provider evidence export profile is invalid");
  }
  const generatedAt = integer(value.generatedAt, "export generation time", 1);
  const retentionDays = integer(value.retentionDays, "retention days", 1, MAX_RETENTION_DAYS);
  const recordCount = integer(value.recordCount, "record count", 1, MAX_ROWS);
  if (!Array.isArray(value.records) || value.records.length !== recordCount) fail("record count does not match");
  let previous = null;
  const records = value.records.map((item, index) => {
    const normalized = exportedRecord(item, index + 1, previous, generatedAt, retentionDays);
    previous = normalized.recordDigest;
    return normalized;
  });
  for (let index = 1; index < records.length; index += 1) {
    if (records[index - 1].occurredAt > records[index].occurredAt) fail("export order is invalid");
  }
  if (new Set(records.map((item) => item.sourceRecordDigest)).size !== records.length) fail("source records are not unique");
  if (digest(value.chainRootDigest, "chain root digest") !== previous) fail("chain root is invalid");
  const legalHoldCount = integer(value.legalHoldCount, "legal-hold count", 0, recordCount);
  const eligibleForDisposalCount = integer(value.eligibleForDisposalCount, "eligible count", 0, recordCount - legalHoldCount);
  if (records.filter((item) => item.legalHold).length !== legalHoldCount ||
      records.filter((item) => item.eligibleForDisposal).length !== eligibleForDisposalCount) {
    fail("retention counts do not match");
  }
  const earliestOccurredAt = integer(value.earliestOccurredAt, "earliest occurrence", 1);
  const latestOccurredAt = integer(value.latestOccurredAt, "latest occurrence", 1);
  if (earliestOccurredAt !== records[0].occurredAt || latestOccurredAt !== records.at(-1).occurredAt) {
    fail("occurrence range does not match");
  }
  const minimumRetainedUntil = integer(value.minimumRetainedUntil, "minimum retained-until", generatedAt);
  if (minimumRetainedUntil !== Math.max(generatedAt, ...records.map((item) => item.retentionUntil))) {
    fail("minimum retained-until does not match");
  }
  const body = {
    chainRootDigest: value.chainRootDigest,
    earliestOccurredAt,
    eligibleForDisposalCount,
    generatedAt,
    latestOccurredAt,
    legalHoldCount,
    minimumRetainedUntil,
    policyDigest: digest(value.policyDigest, "policy digest"),
    privacyProfile: value.privacyProfile,
    recordCount,
    records: value.records,
    retentionDays,
    schemaVersion: 1,
    status: "sealed",
  };
  const exportDigest = digest(value.exportDigest, "export digest");
  if (hash(body) !== exportDigest) fail("export digest does not match");
  return Object.freeze({
    chainValid: true,
    eligibleForDisposalCount,
    legalHoldCount,
    privacyProfile: value.privacyProfile,
    recordCount,
    retentionDays,
    status: "sealed",
  });
}

function custodyBody(exportInput, sequence, previousCustodyDigest) {
  const verified = verifyInternalTokenProviderEvidenceExport(exportInput);
  return {
    chainRootDigest: exportInput.chainRootDigest,
    eligibleForDisposalCount: verified.eligibleForDisposalCount,
    exportDigest: exportInput.exportDigest,
    generatedAt: exportInput.generatedAt,
    legalHoldCount: verified.legalHoldCount,
    minimumRetainedUntil: exportInput.minimumRetainedUntil,
    policyDigest: exportInput.policyDigest,
    previousCustodyDigest,
    privacyProfile: verified.privacyProfile,
    recordCount: verified.recordCount,
    retentionDays: verified.retentionDays,
    schemaVersion: 1,
    sequence,
    status: "sealed",
  };
}

export function createInternalTokenProviderEvidenceCustodyCommand(exportInput, sequenceInput, previousInput) {
  const sequence = integer(sequenceInput, "custody sequence", 1);
  const previousCustodyDigest = previousInput === null ? null : digest(previousInput, "previous custody digest");
  if ((sequence === 1) !== (previousCustodyDigest === null)) fail("custody linkage shape is invalid");
  const body = custodyBody(exportInput, sequence, previousCustodyDigest);
  const custodyDigest = hash(body);
  const purposeDigests = [body.exportDigest, body.policyDigest, body.chainRootDigest, custodyDigest];
  if (new Set(purposeDigests).size !== purposeDigests.length) fail("custody digests must be distinct");
  return Object.freeze({ ...body, custodyDigest });
}

function command(input) {
  const value = exact(input, [
    "chainRootDigest", "custodyDigest", "eligibleForDisposalCount", "exportDigest",
    "generatedAt", "legalHoldCount", "minimumRetainedUntil", "policyDigest",
    "previousCustodyDigest", "privacyProfile", "recordCount", "retentionDays",
    "schemaVersion", "sequence", "status",
  ], "custody command");
  if (value.schemaVersion !== 1 || value.privacyProfile !== "digest-only-v1" || value.status !== "sealed") {
    fail("custody command profile is invalid");
  }
  const sequence = integer(value.sequence, "custody sequence", 1);
  const previousCustodyDigest = value.previousCustodyDigest === null ? null :
    digest(value.previousCustodyDigest, "previous custody digest");
  if ((sequence === 1) !== (previousCustodyDigest === null)) fail("custody linkage shape is invalid");
  const recordCount = integer(value.recordCount, "record count", 1, MAX_ROWS);
  const legalHoldCount = integer(value.legalHoldCount, "legal-hold count", 0, recordCount);
  const eligibleForDisposalCount = integer(value.eligibleForDisposalCount, "eligible count", 0, recordCount - legalHoldCount);
  const body = {
    chainRootDigest: digest(value.chainRootDigest, "chain root digest"),
    eligibleForDisposalCount,
    exportDigest: digest(value.exportDigest, "export digest"),
    generatedAt: integer(value.generatedAt, "generation time", 1),
    legalHoldCount,
    minimumRetainedUntil: integer(value.minimumRetainedUntil, "minimum retained-until", value.generatedAt),
    policyDigest: digest(value.policyDigest, "policy digest"),
    previousCustodyDigest,
    privacyProfile: value.privacyProfile,
    recordCount,
    retentionDays: integer(value.retentionDays, "retention days", 1, MAX_RETENTION_DAYS),
    schemaVersion: 1,
    sequence,
    status: "sealed",
  };
  const custodyDigest = digest(value.custodyDigest, "custody digest");
  if (hash(body) !== custodyDigest) fail("custody command digest does not match");
  if (new Set([body.exportDigest, body.policyDigest, body.chainRootDigest, custodyDigest]).size !== 4) {
    fail("custody digests must be distinct");
  }
  return Object.freeze({ ...body, custodyDigest });
}

export async function recordInternalTokenProviderEvidenceCustody(client, commandInput) {
  if (!client || typeof client.query !== "function") fail("a query-capable governance client is required");
  const value = command(commandInput);
  let result;
  try {
    result = await client.query(INTERNAL_TOKEN_PROVIDER_EVIDENCE_CUSTODY_SQL, [
      value.sequence, value.exportDigest, value.policyDigest, value.chainRootDigest,
      value.previousCustodyDigest, value.custodyDigest, value.recordCount,
      value.legalHoldCount, value.eligibleForDisposalCount, value.retentionDays,
      new Date(value.generatedAt * 1_000).toISOString(),
      new Date(value.minimumRetainedUntil * 1_000).toISOString(),
      value.privacyProfile, value.status,
    ]);
  } catch {
    fail("custody database write failed");
  }
  if (result?.rows?.[0]?.recorded !== true) fail("custody database acknowledgement is invalid");
  return Object.freeze({
    durable: true,
    identifierIncluded: false,
    receiptDigestsIncluded: false,
    recordCount: value.recordCount,
  });
}
