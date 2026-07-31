import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createInternalTokenProviderOperationalHealthDigest,
  createInternalTokenProviderOperationalPolicyDigest,
  evaluateInternalTokenProviderOperationalReadiness,
  executeOperationallyGatedRecordedInternalTokenProviderSigning,
} from "../../tooling/scripts/internal-token-provider-operational-gate.mjs";

const now = 1_900_000_000;
const commandKeyReference = "hsm://provider/internal-token/command/version-12";
const readKeyReference = "hsm://provider/internal-token/read/version-7";
const signingInput =
  "eyJhbGciOiJSUzI1NiJ9.eyJhdWQiOiJzdG9yZS1pbnRlcm5hbCJ9";

function digest(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function policyBody(overrides = {}) {
  return {
    schemaVersion: 1,
    environment: "production",
    status: "enabled",
    providerClass: "managed-hsm",
    purposeKeyDigests: [
      {
        purpose: "command-token",
        keyReferenceDigest: digest(commandKeyReference),
      },
      {
        purpose: "read-token",
        keyReferenceDigest: digest(readKeyReference),
      },
    ],
    maxConcurrentRequests: 20,
    maxErrorRateBasisPoints: 200,
    maxP95LatencyMs: 90,
    maxRequestLatencyMs: 100,
    maxAuditAgeSeconds: 60,
    maxJournalAckAgeSeconds: 30,
    generatedAt: now - 60,
    expiresAt: now + 300,
    emergencyDisabled: false,
    ...overrides,
  };
}

function policy(overrides = {}) {
  const body = policyBody(overrides);
  return {
    ...body,
    policyDigest: createInternalTokenProviderOperationalPolicyDigest(body),
  };
}

function healthBody(overrides = {}) {
  return {
    schemaVersion: 1,
    providerClass: "managed-hsm",
    purpose: "command-token",
    keyReferenceDigest: digest(commandKeyReference),
    windowStartedAt: now - 120,
    observedAt: now,
    attemptCount: 100,
    failureCount: 1,
    inFlight: 4,
    p95LatencyMs: 80,
    lastAuditAt: now - 20,
    lastJournalAckAt: now - 10,
    emergencyDisabled: false,
    ...overrides,
  };
}

function health(overrides = {}) {
  const body = healthBody(overrides);
  return {
    ...body,
    healthDigest: createInternalTokenProviderOperationalHealthDigest(body),
  };
}

function commandContext(overrides = {}) {
  return {
    purpose: "command-token",
    keyReferenceDigest: digest(commandKeyReference),
    ...overrides,
  };
}

function signingCommand(overrides = {}) {
  return {
    signingInput,
    keyReference: commandKeyReference,
    keyReferenceDigest: digest(commandKeyReference),
    purpose: "command-token",
    requestedAt: now - 5,
    expiresAt: now + 20,
    ...overrides,
  };
}

function provider(latencyMs = 31, calls = []) {
  return {
    async sign(request) {
      calls.push(request);
      const signature = new Uint8Array(256).fill(17);
      return {
        signature,
        receipt: {
          schemaVersion: 1,
          algorithm: "RS256",
          digestAlgorithm: "SHA-256",
          providerClass: "managed-hsm",
          status: "succeeded",
          nonExportable: true,
          hardwareProtected: true,
          occurredAt: now,
          latencyMs,
          requestDigest: request.requestDigest,
          signingInputDigest: request.signingInputDigest,
          keyReferenceDigest: request.keyReferenceDigest,
          keyVersionDigest: digest("managed-hsm-command-version-12"),
          auditReferenceDigest: digest("provider-audit-event-12"),
          operationDigest: digest("provider-operation-12"),
          signatureDigest: digest(signature),
        },
      };
    },
  };
}

function recorder(records = []) {
  return {
    async record(evidence) {
      records.push(evidence);
      return {
        schemaVersion: 1,
        providerClass: evidence.providerClass,
        purpose: evidence.purpose,
        recorded: true,
        identifiersIncluded: false,
        receiptDigestsIncluded: false,
      };
    },
  };
}

test("healthy bounded evidence clears the provider operational gate", () => {
  const result = evaluateInternalTokenProviderOperationalReadiness(
    policy(),
    health(),
    commandContext(),
    now,
  );

  assert.deepEqual(result, {
    schemaVersion: 1,
    environment: "production",
    status: "ready",
    gate: "clear",
    providerClass: "managed-hsm",
    purpose: "command-token",
    allowedPurposeCount: 2,
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
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    new RegExp(
      [
        digest(commandKeyReference),
        digest(readKeyReference),
        commandKeyReference,
        readKeyReference,
      ].join("|"),
      "u",
    ),
  );
});

test("emergency switches and unsupported providers fail closed", () => {
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        policy({ emergencyDisabled: true }),
        health(),
        commandContext(),
        now,
      ),
    /provider signing is emergency disabled/u,
  );
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        policy(),
        health({ emergencyDisabled: true }),
        commandContext(),
        now,
      ),
    /provider health emergency switch is active/u,
  );

  const unsupported = {
    ...policyBody({ providerClass: "test-double" }),
    policyDigest: digest("unsupported-provider-policy"),
  };
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        unsupported,
        health(),
        commandContext(),
        now,
      ),
    /operational policy provider class is invalid/u,
  );
});

test("purpose and key bindings cannot be crossed", () => {
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        policy(),
        health(),
        commandContext({
          purpose: "read-token",
          keyReferenceDigest: digest(commandKeyReference),
        }),
        now,
      ),
    /signing command is not allowed by operational policy/u,
  );

  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        policy(),
        health({
          purpose: "read-token",
          keyReferenceDigest: digest(readKeyReference),
        }),
        commandContext(),
        now,
      ),
    /provider health evidence is not bound to the signing command/u,
  );
});

test("stale and tampered policy or health evidence is rejected", () => {
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        policy({
          generatedAt: now - 1_000,
          expiresAt: now - 100,
        }),
        health(),
        commandContext(),
        now,
      ),
    /operational policy is stale or not yet valid/u,
  );
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        policy(),
        health({ observedAt: now - 31, lastAuditAt: now - 40 }),
        commandContext(),
        now,
      ),
    /provider health evidence is stale or not yet valid/u,
  );

  const tamperedPolicy = policy();
  tamperedPolicy.maxConcurrentRequests += 1;
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        tamperedPolicy,
        health(),
        commandContext(),
        now,
      ),
    /operational policy digest does not match/u,
  );

  const tamperedHealth = health();
  tamperedHealth.inFlight += 1;
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        policy(),
        tamperedHealth,
        commandContext(),
        now,
      ),
    /provider health digest does not match/u,
  );
});

test("concurrency, latency and error budgets fail independently", () => {
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        policy(),
        health({ inFlight: 20 }),
        commandContext(),
        now,
      ),
    /provider concurrency limit is reached/u,
  );
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        policy(),
        health({ p95LatencyMs: 91 }),
        commandContext(),
        now,
      ),
    /provider latency budget is exceeded/u,
  );
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        policy(),
        health({ attemptCount: 100, failureCount: 3 }),
        commandContext(),
        now,
      ),
    /provider error budget is exceeded/u,
  );
});

test("provider audit and durable journal acknowledgements must be fresh", () => {
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        policy(),
        health({ lastAuditAt: now - 61 }),
        commandContext(),
        now,
      ),
    /provider audit evidence is stale/u,
  );
  assert.throws(
    () =>
      evaluateInternalTokenProviderOperationalReadiness(
        policy(),
        health({ lastJournalAckAt: now - 31 }),
        commandContext(),
        now,
      ),
    /durable journal acknowledgement is stale/u,
  );
});

test("operationally gated signing records evidence before returning", async () => {
  const providerCalls = [];
  const records = [];
  const result =
    await executeOperationallyGatedRecordedInternalTokenProviderSigning(
      provider(31, providerCalls),
      signingCommand(),
      now,
      recorder(records),
      {
        policy: policy(),
        health: health(),
      },
    );

  assert.equal(providerCalls.length, 1);
  assert.equal(records.length, 1);
  assert.equal(result.signature.byteLength, 256);
  assert.equal(result.summary.operationalGateValidated, true);
  assert.equal(result.summary.operationalPolicyFresh, true);
  assert.equal(result.summary.operationalHealthFresh, true);
  assert.equal(result.summary.durableEvidenceRecorded, true);
  assert.equal(result.summary.emergencyDisabled, false);
  assert.equal(result.summary.identifiersIncluded, false);
  assert.equal(result.summary.receiptDigestsIncluded, false);
  assert.doesNotMatch(
    JSON.stringify(result.summary),
    /hsm:\/\/|version-12|provider-audit-event|provider-operation/u,
  );
});

test("blocked readiness never calls the provider or recorder", async () => {
  const providerCalls = [];
  const records = [];
  await assert.rejects(
    executeOperationallyGatedRecordedInternalTokenProviderSigning(
      provider(31, providerCalls),
      signingCommand(),
      now,
      recorder(records),
      {
        policy: policy({ emergencyDisabled: true }),
        health: health(),
      },
    ),
    /provider signing is emergency disabled/u,
  );
  assert.equal(providerCalls.length, 0);
  assert.equal(records.length, 0);
});

test("actual request latency over policy aborts signature return", async () => {
  const providerCalls = [];
  const records = [];
  await assert.rejects(
    executeOperationallyGatedRecordedInternalTokenProviderSigning(
      provider(101, providerCalls),
      signingCommand(),
      now,
      recorder(records),
      {
        policy: policy(),
        health: health(),
      },
    ),
    /provider signing result exceeded operational policy/u,
  );
  assert.equal(providerCalls.length, 1);
  assert.equal(records.length, 1);
});
