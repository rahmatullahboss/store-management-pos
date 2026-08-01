const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const PROVIDER_CLASSES = new Set(["cloud-kms", "managed-hsm", "pkcs11-hsm"]);
const PURPOSES = new Set(["read-token", "command-token"]);

export const INTERNAL_TOKEN_PROVIDER_SIGNING_JOURNAL_SCHEMA_VERSION = 1;
export const INTERNAL_TOKEN_PROVIDER_SIGNING_JOURNAL_SQL = `SELECT
  platform.append_internal_token_provider_signing_journal(
    $1::text,
    $2::text,
    $3::text,
    $4::text,
    $5::text,
    $6::text,
    $7::text,
    $8::text,
    $9::text,
    $10::text,
    $11::text,
    $12::boolean,
    $13::boolean,
    $14::boolean,
    $15::smallint,
    $16::integer,
    $17::timestamptz
  ) IS NOT NULL AS recorded`;

function fail(message) {
  throw new Error(`Internal-token provider signing journal: ${message}`);
}

function exactKeys(value, expected, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} is invalid`);
  }
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    fail(`${name} fields are invalid`);
  }
  return value;
}

function digest(value, name) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${name} is invalid`);
  return value;
}

function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${name} is invalid`);
  }
  return value;
}

function queryClient(value) {
  if (!value || typeof value.query !== "function") {
    fail("a query-capable governance client is required");
  }
  return value;
}

function timestamp(value) {
  const seconds = boundedInteger(value, "receipt timestamp", 1, Number.MAX_SAFE_INTEGER);
  const date = new Date(seconds * 1_000);
  if (!Number.isFinite(date.getTime())) fail("receipt timestamp is invalid");
  return date.toISOString();
}

function normalizeEvidence(input) {
  const value = exactKeys(
    input,
    [
      "algorithm",
      "auditReferenceDigest",
      "digestAlgorithm",
      "hardwareProtected",
      "keyReferenceDigest",
      "keyVersionDigest",
      "latencyMs",
      "nonExportable",
      "occurredAt",
      "operationDigest",
      "providerClass",
      "purpose",
      "receiptValidated",
      "requestDigest",
      "schemaVersion",
      "signatureByteLength",
      "signatureDigest",
      "signingInputDigest",
    ],
    "evidence",
  );
  if (value.schemaVersion !== INTERNAL_TOKEN_PROVIDER_SIGNING_JOURNAL_SCHEMA_VERSION) {
    fail("evidence schema version is invalid");
  }
  if (value.algorithm !== "RS256" || value.digestAlgorithm !== "SHA-256") {
    fail("evidence algorithm is invalid");
  }
  if (typeof value.providerClass !== "string" || !PROVIDER_CLASSES.has(value.providerClass)) {
    fail("provider class is not durable-journal eligible");
  }
  if (typeof value.purpose !== "string" || !PURPOSES.has(value.purpose)) {
    fail("purpose is invalid");
  }
  if (
    value.nonExportable !== true ||
    value.hardwareProtected !== true ||
    value.receiptValidated !== true
  ) {
    fail("provider attestation is incomplete");
  }
  const digests = {
    requestDigest: digest(value.requestDigest, "request digest"),
    signingInputDigest: digest(value.signingInputDigest, "signing-input digest"),
    keyReferenceDigest: digest(value.keyReferenceDigest, "key-reference digest"),
    keyVersionDigest: digest(value.keyVersionDigest, "key-version digest"),
    auditReferenceDigest: digest(value.auditReferenceDigest, "audit-reference digest"),
    operationDigest: digest(value.operationDigest, "operation digest"),
    signatureDigest: digest(value.signatureDigest, "signature digest"),
  };
  if (new Set(Object.values(digests)).size !== Object.keys(digests).length) {
    fail("evidence digests must have distinct purposes");
  }
  return Object.freeze({
    ...digests,
    schemaVersion: INTERNAL_TOKEN_PROVIDER_SIGNING_JOURNAL_SCHEMA_VERSION,
    algorithm: "RS256",
    digestAlgorithm: "SHA-256",
    providerClass: value.providerClass,
    purpose: value.purpose,
    nonExportable: true,
    hardwareProtected: true,
    receiptValidated: true,
    signatureByteLength: boundedInteger(
      value.signatureByteLength,
      "signature byte length",
      256,
      512,
    ),
    latencyMs: boundedInteger(value.latencyMs, "provider latency", 0, 5_000),
    occurredAt: timestamp(value.occurredAt),
  });
}

export async function recordInternalTokenProviderSigningEvidence(
  clientInput,
  evidenceInput,
) {
  const evidence = normalizeEvidence(evidenceInput);
  const client = queryClient(clientInput);
  const result = await client.query(INTERNAL_TOKEN_PROVIDER_SIGNING_JOURNAL_SQL, [
    evidence.requestDigest,
    evidence.signingInputDigest,
    evidence.keyReferenceDigest,
    evidence.keyVersionDigest,
    evidence.auditReferenceDigest,
    evidence.operationDigest,
    evidence.signatureDigest,
    evidence.purpose,
    evidence.providerClass,
    evidence.algorithm,
    evidence.digestAlgorithm,
    evidence.nonExportable,
    evidence.hardwareProtected,
    evidence.receiptValidated,
    evidence.signatureByteLength,
    evidence.latencyMs,
    evidence.occurredAt,
  ]);
  if (result?.rows?.[0]?.recorded !== true) {
    fail("database acknowledgement is invalid");
  }
  return Object.freeze({
    schemaVersion: INTERNAL_TOKEN_PROVIDER_SIGNING_JOURNAL_SCHEMA_VERSION,
    providerClass: evidence.providerClass,
    purpose: evidence.purpose,
    recorded: true,
    identifiersIncluded: false,
    receiptDigestsIncluded: false,
  });
}
