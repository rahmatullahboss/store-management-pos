import { createHash } from "node:crypto";

const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const JWT_SIGNING_INPUT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const PROVIDER_CLASSES = new Set([
  "cloud-kms",
  "managed-hsm",
  "pkcs11-hsm",
  "test-double",
]);
const PURPOSES = new Set(["read-token", "command-token"]);
const MAX_SIGNING_INPUT_BYTES = 16_384;
const MAX_KEY_REFERENCE_LENGTH = 512;
const MAX_REQUEST_WINDOW_SECONDS = 30;
const MAX_PROVIDER_LATENCY_MS = 5_000;
const MIN_RSA_SIGNATURE_BYTES = 256;
const MAX_RSA_SIGNATURE_BYTES = 512;

export const INTERNAL_TOKEN_PROVIDER_SIGNING_SCHEMA_VERSION = 1;
export const INTERNAL_TOKEN_PROVIDER_SIGNING_ALGORITHM = "RS256";
export const INTERNAL_TOKEN_PROVIDER_DIGEST_ALGORITHM = "SHA-256";

function fail(message) {
  throw new Error(`Internal-token provider signing: ${message}`);
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

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} is invalid`);
  return value;
}

function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${name} is invalid`);
  }
  return value;
}

function digest(value, name) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${name} is invalid`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function boundedText(value, name, maximum) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    fail(`${name} is invalid`);
  }
  return value;
}

function normalizeCommand(input) {
  const value = exactKeys(
    input,
    [
      "expiresAt",
      "keyReference",
      "keyReferenceDigest",
      "purpose",
      "requestedAt",
      "signingInput",
    ],
    "command",
  );
  const signingInput = boundedText(
    value.signingInput,
    "signing input",
    MAX_SIGNING_INPUT_BYTES,
  );
  if (!JWT_SIGNING_INPUT.test(signingInput)) fail("signing input is not a compact JWT header and payload");
  const keyReference = boundedText(
    value.keyReference,
    "key reference",
    MAX_KEY_REFERENCE_LENGTH,
  );
  const keyReferenceDigest = digest(value.keyReferenceDigest, "key reference digest");
  if (sha256(keyReference) !== keyReferenceDigest) fail("key reference digest does not match");
  if (typeof value.purpose !== "string" || !PURPOSES.has(value.purpose)) {
    fail("purpose is invalid");
  }
  const requestedAt = positiveInteger(value.requestedAt, "requested-at");
  const expiresAt = positiveInteger(value.expiresAt, "expiry");
  if (
    expiresAt <= requestedAt ||
    expiresAt - requestedAt > MAX_REQUEST_WINDOW_SECONDS
  ) {
    fail("request window is invalid");
  }
  const signingInputDigest = sha256(signingInput);
  const requestDigest = sha256(JSON.stringify({
    algorithm: INTERNAL_TOKEN_PROVIDER_SIGNING_ALGORITHM,
    digestAlgorithm: INTERNAL_TOKEN_PROVIDER_DIGEST_ALGORITHM,
    expiresAt,
    keyReferenceDigest,
    purpose: value.purpose,
    requestedAt,
    signingInputDigest,
  }));
  return Object.freeze({
    expiresAt,
    keyReference,
    keyReferenceDigest,
    purpose: value.purpose,
    requestedAt,
    requestDigest,
    signingInput,
    signingInputDigest,
  });
}

function provider(value) {
  const normalized = exactKeys(value, ["sign"], "provider");
  if (typeof normalized.sign !== "function") fail("provider sign operation is unavailable");
  return normalized;
}

function signatureBytes(value) {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < MIN_RSA_SIGNATURE_BYTES ||
    value.byteLength > MAX_RSA_SIGNATURE_BYTES
  ) {
    fail("provider signature is invalid");
  }
  return new Uint8Array(value);
}

function normalizeReceipt(input, request, signature, now) {
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
      "requestDigest",
      "schemaVersion",
      "signatureDigest",
      "signingInputDigest",
      "status",
    ],
    "provider receipt",
  );
  if (value.schemaVersion !== INTERNAL_TOKEN_PROVIDER_SIGNING_SCHEMA_VERSION) {
    fail("provider receipt schema version is invalid");
  }
  if (value.algorithm !== INTERNAL_TOKEN_PROVIDER_SIGNING_ALGORITHM) {
    fail("provider receipt algorithm is invalid");
  }
  if (value.digestAlgorithm !== INTERNAL_TOKEN_PROVIDER_DIGEST_ALGORITHM) {
    fail("provider receipt digest algorithm is invalid");
  }
  if (typeof value.providerClass !== "string" || !PROVIDER_CLASSES.has(value.providerClass)) {
    fail("provider class is invalid");
  }
  if (value.status !== "succeeded") fail("provider receipt status is invalid");
  if (value.nonExportable !== true) fail("provider key is not attested as non-exportable");
  if (value.hardwareProtected !== true) fail("provider key is not attested as hardware protected");
  const occurredAt = positiveInteger(value.occurredAt, "provider receipt timestamp");
  if (
    occurredAt < request.requestedAt ||
    occurredAt > request.expiresAt ||
    occurredAt > now
  ) {
    fail("provider receipt timestamp is outside the request window");
  }
  const latencyMs = boundedInteger(
    value.latencyMs,
    "provider latency",
    0,
    MAX_PROVIDER_LATENCY_MS,
  );
  const requestDigest = digest(value.requestDigest, "receipt request digest");
  const signingInputDigest = digest(value.signingInputDigest, "receipt signing-input digest");
  const keyReferenceDigest = digest(value.keyReferenceDigest, "receipt key-reference digest");
  const keyVersionDigest = digest(value.keyVersionDigest, "receipt key-version digest");
  const auditReferenceDigest = digest(value.auditReferenceDigest, "receipt audit-reference digest");
  const operationDigest = digest(value.operationDigest, "receipt operation digest");
  const signatureDigest = digest(value.signatureDigest, "receipt signature digest");
  if (
    requestDigest !== request.requestDigest ||
    signingInputDigest !== request.signingInputDigest ||
    keyReferenceDigest !== request.keyReferenceDigest ||
    signatureDigest !== sha256(signature)
  ) {
    fail("provider receipt is not bound to the signing operation");
  }
  const purposeDigests = [
    requestDigest,
    signingInputDigest,
    keyReferenceDigest,
    keyVersionDigest,
    auditReferenceDigest,
    operationDigest,
    signatureDigest,
  ];
  if (new Set(purposeDigests).size !== purposeDigests.length) {
    fail("provider receipt digests must have distinct purposes");
  }
  return Object.freeze({
    providerClass: value.providerClass,
    latencyMs,
  });
}

export async function executeAuditedInternalTokenProviderSigning(
  providerInput,
  commandInput,
  nowInput,
) {
  const command = normalizeCommand(commandInput);
  const now = positiveInteger(nowInput, "clock");
  if (now < command.requestedAt || now > command.expiresAt) {
    fail("command is outside its signing window");
  }
  const signer = provider(providerInput);
  let response;
  try {
    response = await signer.sign(Object.freeze({
      algorithm: INTERNAL_TOKEN_PROVIDER_SIGNING_ALGORITHM,
      digestAlgorithm: INTERNAL_TOKEN_PROVIDER_DIGEST_ALGORITHM,
      keyReference: command.keyReference,
      keyReferenceDigest: command.keyReferenceDigest,
      purpose: command.purpose,
      requestDigest: command.requestDigest,
      signingInput: command.signingInput,
      signingInputDigest: command.signingInputDigest,
    }));
  } catch {
    fail("provider signing operation failed");
  }
  const result = exactKeys(response, ["receipt", "signature"], "provider response");
  const signature = signatureBytes(result.signature);
  const receipt = normalizeReceipt(result.receipt, command, signature, now);
  const summary = Object.freeze({
    schemaVersion: INTERNAL_TOKEN_PROVIDER_SIGNING_SCHEMA_VERSION,
    algorithm: INTERNAL_TOKEN_PROVIDER_SIGNING_ALGORITHM,
    digestAlgorithm: INTERNAL_TOKEN_PROVIDER_DIGEST_ALGORITHM,
    providerClass: receipt.providerClass,
    receiptValidated: true,
    nonExportable: true,
    hardwareProtected: true,
    auditReferencePresent: true,
    requestBound: true,
    signatureByteLength: signature.byteLength,
    latencyMs: receipt.latencyMs,
    identifiersIncluded: false,
    signingInputIncluded: false,
    signatureIncluded: false,
    receiptDigestsIncluded: false,
  });
  return Object.freeze({ signature, summary });
}
