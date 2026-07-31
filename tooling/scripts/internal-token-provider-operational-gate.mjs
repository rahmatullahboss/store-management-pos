import { createHash } from "node:crypto";
import {
  executeRecordedAuditedInternalTokenProviderSigning,
} from "./internal-token-provider-signing-recorded.mjs";

const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const ENVIRONMENTS = new Set(["production", "staging"]);
const PROVIDER_CLASSES = new Set(["cloud-kms", "managed-hsm", "pkcs11-hsm"]);
const PURPOSES = ["command-token", "read-token"];
const MAX_POLICY_WINDOW_SECONDS = 900;
const MAX_HEALTH_AGE_SECONDS = 30;
const MAX_HEALTH_WINDOW_SECONDS = 300;
const MAX_FUTURE_SKEW_SECONDS = 5;

export const INTERNAL_TOKEN_PROVIDER_OPERATIONAL_GATE_SCHEMA_VERSION = 1;

function fail(message) {
  throw new Error(`Internal-token provider operational gate: ${message}`);
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

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} is invalid`);
  return value;
}

function boundedInteger(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${name} is invalid`);
  }
  return value;
}

function digest(value, name) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail(`${name} is invalid`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function environment(value) {
  if (typeof value !== "string" || !ENVIRONMENTS.has(value)) {
    fail("environment is invalid");
  }
  return value;
}

function providerClass(value, name) {
  if (typeof value !== "string" || !PROVIDER_CLASSES.has(value)) {
    fail(`${name} is invalid`);
  }
  return value;
}

function purpose(value, name) {
  if (typeof value !== "string" || !PURPOSES.includes(value)) {
    fail(`${name} is invalid`);
  }
  return value;
}

function normalizePurposeKeyDigests(input) {
  if (!Array.isArray(input) || input.length !== PURPOSES.length) {
    fail("purpose-key allowlist is invalid");
  }
  const normalized = input.map((item, index) => {
    const value = exactKeys(
      item,
      ["keyReferenceDigest", "purpose"],
      `purpose-key allowlist item ${index + 1}`,
    );
    return Object.freeze({
      purpose: purpose(
        value.purpose,
        `purpose-key allowlist item ${index + 1} purpose`,
      ),
      keyReferenceDigest: digest(
        value.keyReferenceDigest,
        `purpose-key allowlist item ${index + 1} key-reference digest`,
      ),
    });
  });
  const actualPurposes = normalized.map((item) => item.purpose);
  if (
    actualPurposes.some((value, index) => value !== PURPOSES[index]) ||
    new Set(normalized.map((item) => item.keyReferenceDigest)).size !==
      PURPOSES.length
  ) {
    fail("purpose-key allowlist must contain distinct ordered purpose bindings");
  }
  return Object.freeze(normalized);
}

function normalizePolicyBody(input) {
  const value = exactKeys(
    input,
    [
      "emergencyDisabled",
      "environment",
      "expiresAt",
      "generatedAt",
      "maxAuditAgeSeconds",
      "maxConcurrentRequests",
      "maxErrorRateBasisPoints",
      "maxJournalAckAgeSeconds",
      "maxP95LatencyMs",
      "maxRequestLatencyMs",
      "providerClass",
      "purposeKeyDigests",
      "schemaVersion",
      "status",
    ],
    "operational policy body",
  );
  if (
    value.schemaVersion !==
    INTERNAL_TOKEN_PROVIDER_OPERATIONAL_GATE_SCHEMA_VERSION
  ) {
    fail("operational policy schema version is invalid");
  }
  if (value.status !== "enabled") fail("operational policy status is invalid");
  if (typeof value.emergencyDisabled !== "boolean") {
    fail("operational policy emergency switch is invalid");
  }
  const generatedAt = positiveInteger(
    value.generatedAt,
    "operational policy generated-at",
  );
  const expiresAt = positiveInteger(
    value.expiresAt,
    "operational policy expiry",
  );
  if (
    expiresAt <= generatedAt ||
    expiresAt - generatedAt > MAX_POLICY_WINDOW_SECONDS
  ) {
    fail("operational policy window is invalid");
  }
  const maxRequestLatencyMs = boundedInteger(
    value.maxRequestLatencyMs,
    "maximum request latency",
    1,
    5_000,
  );
  const maxP95LatencyMs = boundedInteger(
    value.maxP95LatencyMs,
    "maximum p95 latency",
    1,
    maxRequestLatencyMs,
  );
  return Object.freeze({
    schemaVersion: INTERNAL_TOKEN_PROVIDER_OPERATIONAL_GATE_SCHEMA_VERSION,
    environment: environment(value.environment),
    status: "enabled",
    providerClass: providerClass(
      value.providerClass,
      "operational policy provider class",
    ),
    purposeKeyDigests: normalizePurposeKeyDigests(value.purposeKeyDigests),
    maxConcurrentRequests: boundedInteger(
      value.maxConcurrentRequests,
      "maximum concurrent requests",
      1,
      1_000,
    ),
    maxErrorRateBasisPoints: boundedInteger(
      value.maxErrorRateBasisPoints,
      "maximum error rate",
      0,
      1_000,
    ),
    maxP95LatencyMs,
    maxRequestLatencyMs,
    maxAuditAgeSeconds: boundedInteger(
      value.maxAuditAgeSeconds,
      "maximum audit age",
      1,
      300,
    ),
    maxJournalAckAgeSeconds: boundedInteger(
      value.maxJournalAckAgeSeconds,
      "maximum journal acknowledgement age",
      1,
      300,
    ),
    generatedAt,
    expiresAt,
    emergencyDisabled: value.emergencyDisabled,
  });
}

export function createInternalTokenProviderOperationalPolicyDigest(input) {
  return sha256(JSON.stringify(normalizePolicyBody(input)));
}

function normalizePolicy(input, now) {
  const value = exactKeys(
    input,
    [
      "emergencyDisabled",
      "environment",
      "expiresAt",
      "generatedAt",
      "maxAuditAgeSeconds",
      "maxConcurrentRequests",
      "maxErrorRateBasisPoints",
      "maxJournalAckAgeSeconds",
      "maxP95LatencyMs",
      "maxRequestLatencyMs",
      "policyDigest",
      "providerClass",
      "purposeKeyDigests",
      "schemaVersion",
      "status",
    ],
    "operational policy",
  );
  const body = normalizePolicyBody({
    schemaVersion: value.schemaVersion,
    environment: value.environment,
    status: value.status,
    providerClass: value.providerClass,
    purposeKeyDigests: value.purposeKeyDigests,
    maxConcurrentRequests: value.maxConcurrentRequests,
    maxErrorRateBasisPoints: value.maxErrorRateBasisPoints,
    maxP95LatencyMs: value.maxP95LatencyMs,
    maxRequestLatencyMs: value.maxRequestLatencyMs,
    maxAuditAgeSeconds: value.maxAuditAgeSeconds,
    maxJournalAckAgeSeconds: value.maxJournalAckAgeSeconds,
    generatedAt: value.generatedAt,
    expiresAt: value.expiresAt,
    emergencyDisabled: value.emergencyDisabled,
  });
  const policyDigest = digest(
    value.policyDigest,
    "operational policy digest",
  );
  if (policyDigest !== sha256(JSON.stringify(body))) {
    fail("operational policy digest does not match");
  }
  if (
    now < body.generatedAt ||
    now > body.expiresAt ||
    body.generatedAt > now + MAX_FUTURE_SKEW_SECONDS
  ) {
    fail("operational policy is stale or not yet valid");
  }
  if (body.emergencyDisabled) {
    fail("provider signing is emergency disabled");
  }
  return Object.freeze({ ...body, policyDigest });
}

function normalizeHealthBody(input) {
  const value = exactKeys(
    input,
    [
      "attemptCount",
      "emergencyDisabled",
      "failureCount",
      "inFlight",
      "keyReferenceDigest",
      "lastAuditAt",
      "lastJournalAckAt",
      "observedAt",
      "p95LatencyMs",
      "providerClass",
      "purpose",
      "schemaVersion",
      "windowStartedAt",
    ],
    "provider health body",
  );
  if (
    value.schemaVersion !==
    INTERNAL_TOKEN_PROVIDER_OPERATIONAL_GATE_SCHEMA_VERSION
  ) {
    fail("provider health schema version is invalid");
  }
  if (typeof value.emergencyDisabled !== "boolean") {
    fail("provider health emergency switch is invalid");
  }
  const windowStartedAt = positiveInteger(
    value.windowStartedAt,
    "provider health window start",
  );
  const observedAt = positiveInteger(
    value.observedAt,
    "provider health observation",
  );
  if (
    observedAt < windowStartedAt ||
    observedAt - windowStartedAt > MAX_HEALTH_WINDOW_SECONDS
  ) {
    fail("provider health window is invalid");
  }
  const attemptCount = positiveInteger(
    value.attemptCount,
    "provider attempt count",
  );
  const failureCount = nonNegativeInteger(
    value.failureCount,
    "provider failure count",
  );
  if (failureCount > attemptCount) {
    fail("provider failure count is invalid");
  }
  const lastAuditAt = positiveInteger(
    value.lastAuditAt,
    "last provider audit timestamp",
  );
  const lastJournalAckAt = positiveInteger(
    value.lastJournalAckAt,
    "last durable journal acknowledgement timestamp",
  );
  if (lastAuditAt > observedAt || lastJournalAckAt > observedAt) {
    fail("provider health evidence contains future acknowledgements");
  }
  return Object.freeze({
    schemaVersion: INTERNAL_TOKEN_PROVIDER_OPERATIONAL_GATE_SCHEMA_VERSION,
    providerClass: providerClass(value.providerClass, "provider health class"),
    purpose: purpose(value.purpose, "provider health purpose"),
    keyReferenceDigest: digest(
      value.keyReferenceDigest,
      "provider health key-reference digest",
    ),
    windowStartedAt,
    observedAt,
    attemptCount,
    failureCount,
    inFlight: nonNegativeInteger(
      value.inFlight,
      "provider in-flight count",
    ),
    p95LatencyMs: nonNegativeInteger(
      value.p95LatencyMs,
      "provider p95 latency",
    ),
    lastAuditAt,
    lastJournalAckAt,
    emergencyDisabled: value.emergencyDisabled,
  });
}

export function createInternalTokenProviderOperationalHealthDigest(input) {
  return sha256(JSON.stringify(normalizeHealthBody(input)));
}

function normalizeHealth(input, policy, command, now) {
  const value = exactKeys(
    input,
    [
      "attemptCount",
      "emergencyDisabled",
      "failureCount",
      "healthDigest",
      "inFlight",
      "keyReferenceDigest",
      "lastAuditAt",
      "lastJournalAckAt",
      "observedAt",
      "p95LatencyMs",
      "providerClass",
      "purpose",
      "schemaVersion",
      "windowStartedAt",
    ],
    "provider health evidence",
  );
  const body = normalizeHealthBody({
    schemaVersion: value.schemaVersion,
    providerClass: value.providerClass,
    purpose: value.purpose,
    keyReferenceDigest: value.keyReferenceDigest,
    windowStartedAt: value.windowStartedAt,
    observedAt: value.observedAt,
    attemptCount: value.attemptCount,
    failureCount: value.failureCount,
    inFlight: value.inFlight,
    p95LatencyMs: value.p95LatencyMs,
    lastAuditAt: value.lastAuditAt,
    lastJournalAckAt: value.lastJournalAckAt,
    emergencyDisabled: value.emergencyDisabled,
  });
  const healthDigest = digest(value.healthDigest, "provider health digest");
  if (healthDigest !== sha256(JSON.stringify(body))) {
    fail("provider health digest does not match");
  }
  if (
    body.observedAt > now + MAX_FUTURE_SKEW_SECONDS ||
    now - body.observedAt > MAX_HEALTH_AGE_SECONDS
  ) {
    fail("provider health evidence is stale or not yet valid");
  }
  if (body.emergencyDisabled) {
    fail("provider health emergency switch is active");
  }
  if (
    body.providerClass !== policy.providerClass ||
    body.purpose !== command.purpose ||
    body.keyReferenceDigest !== command.keyReferenceDigest
  ) {
    fail("provider health evidence is not bound to the signing command");
  }
  return Object.freeze({ ...body, healthDigest });
}

function normalizeCommandContext(input) {
  const value = exactKeys(
    input,
    ["keyReferenceDigest", "purpose"],
    "signing command context",
  );
  return Object.freeze({
    purpose: purpose(value.purpose, "signing command purpose"),
    keyReferenceDigest: digest(
      value.keyReferenceDigest,
      "signing command key-reference digest",
    ),
  });
}

function evaluate(policyInput, healthInput, commandInput, nowInput) {
  const now = positiveInteger(nowInput, "clock");
  const command = normalizeCommandContext(commandInput);
  const policy = normalizePolicy(policyInput, now);
  const binding = policy.purposeKeyDigests.find(
    (item) => item.purpose === command.purpose,
  );
  if (!binding || binding.keyReferenceDigest !== command.keyReferenceDigest) {
    fail("signing command is not allowed by operational policy");
  }
  const health = normalizeHealth(healthInput, policy, command, now);
  if (health.inFlight >= policy.maxConcurrentRequests) {
    fail("provider concurrency limit is reached");
  }
  if (health.p95LatencyMs > policy.maxP95LatencyMs) {
    fail("provider latency budget is exceeded");
  }
  const errorRateBasisPoints = Math.floor(
    (health.failureCount * 10_000) / health.attemptCount,
  );
  if (errorRateBasisPoints > policy.maxErrorRateBasisPoints) {
    fail("provider error budget is exceeded");
  }
  if (health.observedAt - health.lastAuditAt > policy.maxAuditAgeSeconds) {
    fail("provider audit evidence is stale");
  }
  if (
    health.observedAt - health.lastJournalAckAt >
    policy.maxJournalAckAgeSeconds
  ) {
    fail("durable journal acknowledgement is stale");
  }
  const summary = Object.freeze({
    schemaVersion: INTERNAL_TOKEN_PROVIDER_OPERATIONAL_GATE_SCHEMA_VERSION,
    environment: policy.environment,
    status: "ready",
    gate: "clear",
    providerClass: policy.providerClass,
    purpose: command.purpose,
    allowedPurposeCount: policy.purposeKeyDigests.length,
    emergencyDisabled: false,
    concurrencyWithinLimit: true,
    errorRateWithinBudget: true,
    latencyWithinBudget: true,
    auditFresh: true,
    durableJournalFresh: true,
    identifiersIncluded: false,
    policyDigestIncluded: false,
    keyReferenceDigestIncluded: false,
    healthDigestIncluded: false,
  });
  return Object.freeze({ command, health, policy, summary });
}

export function evaluateInternalTokenProviderOperationalReadiness(
  policyInput,
  healthInput,
  commandInput,
  nowInput,
) {
  return evaluate(policyInput, healthInput, commandInput, nowInput).summary;
}

export async function executeOperationallyGatedRecordedInternalTokenProviderSigning(
  providerInput,
  commandInput,
  nowInput,
  recorderInput,
  operationalInput,
) {
  const value = exactKeys(
    operationalInput,
    ["health", "policy"],
    "operational evidence",
  );
  if (
    !commandInput ||
    typeof commandInput !== "object" ||
    Array.isArray(commandInput)
  ) {
    fail("signing command is invalid");
  }
  const readiness = evaluate(
    value.policy,
    value.health,
    {
      purpose: commandInput.purpose,
      keyReferenceDigest: commandInput.keyReferenceDigest,
    },
    nowInput,
  );
  const result = await executeRecordedAuditedInternalTokenProviderSigning(
    providerInput,
    commandInput,
    nowInput,
    recorderInput,
  );
  if (
    result.summary.providerClass !== readiness.policy.providerClass ||
    result.summary.latencyMs > readiness.policy.maxRequestLatencyMs
  ) {
    fail("provider signing result exceeded operational policy");
  }
  return Object.freeze({
    signature: result.signature,
    summary: Object.freeze({
      ...result.summary,
      operationalGateValidated: true,
      operationalPolicyFresh: true,
      operationalHealthFresh: true,
      emergencyDisabled: false,
    }),
  });
}
