import {
  executeAuditedInternalTokenProviderSigning,
} from "./internal-token-provider-signing.mjs";

export const INTERNAL_TOKEN_PROVIDER_RECORDED_SIGNING_SCHEMA_VERSION = 1;

function fail(message) {
  throw new Error(`Recorded internal-token provider signing: ${message}`);
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

function provider(value) {
  const normalized = exactKeys(value, ["sign"], "provider");
  if (typeof normalized.sign !== "function") fail("provider sign operation is unavailable");
  return normalized;
}

function recorder(value) {
  const normalized = exactKeys(value, ["record"], "recorder");
  if (typeof normalized.record !== "function") fail("recorder operation is unavailable");
  return normalized;
}

function validateRecordAcknowledgement(value, evidence) {
  const result = exactKeys(
    value,
    [
      "identifiersIncluded",
      "providerClass",
      "purpose",
      "receiptDigestsIncluded",
      "recorded",
      "schemaVersion",
    ],
    "record acknowledgement",
  );
  if (
    result.schemaVersion !== INTERNAL_TOKEN_PROVIDER_RECORDED_SIGNING_SCHEMA_VERSION ||
    result.recorded !== true ||
    result.identifiersIncluded !== false ||
    result.receiptDigestsIncluded !== false ||
    result.providerClass !== evidence.providerClass ||
    result.purpose !== evidence.purpose
  ) {
    fail("record acknowledgement is invalid");
  }
}

export async function executeRecordedAuditedInternalTokenProviderSigning(
  providerInput,
  commandInput,
  nowInput,
  recorderInput,
) {
  const signer = provider(providerInput);
  const journal = recorder(recorderInput);
  let providerRequest;
  let providerResponse;
  const result = await executeAuditedInternalTokenProviderSigning(
    {
      async sign(request) {
        providerRequest = request;
        providerResponse = await signer.sign(request);
        return providerResponse;
      },
    },
    commandInput,
    nowInput,
  );
  const receipt = providerResponse.receipt;
  const evidence = Object.freeze({
    schemaVersion: INTERNAL_TOKEN_PROVIDER_RECORDED_SIGNING_SCHEMA_VERSION,
    algorithm: receipt.algorithm,
    digestAlgorithm: receipt.digestAlgorithm,
    providerClass: receipt.providerClass,
    purpose: providerRequest.purpose,
    requestDigest: receipt.requestDigest,
    signingInputDigest: receipt.signingInputDigest,
    keyReferenceDigest: receipt.keyReferenceDigest,
    keyVersionDigest: receipt.keyVersionDigest,
    auditReferenceDigest: receipt.auditReferenceDigest,
    operationDigest: receipt.operationDigest,
    signatureDigest: receipt.signatureDigest,
    nonExportable: receipt.nonExportable,
    hardwareProtected: receipt.hardwareProtected,
    receiptValidated: true,
    signatureByteLength: result.signature.byteLength,
    latencyMs: receipt.latencyMs,
    occurredAt: receipt.occurredAt,
  });
  let acknowledgement;
  try {
    acknowledgement = await journal.record(evidence);
  } catch {
    fail("durable evidence recording failed");
  }
  validateRecordAcknowledgement(acknowledgement, evidence);
  return Object.freeze({
    signature: result.signature,
    summary: Object.freeze({
      ...result.summary,
      durableEvidenceRecorded: true,
    }),
  });
}
