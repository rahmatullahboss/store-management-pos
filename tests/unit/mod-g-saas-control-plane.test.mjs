import assert from "node:assert/strict";
import test from "node:test";
import {
  TenantLifecycleExecutionError,
  evaluateTenantAccess,
  featureEnabledForTenant,
  runTenantLifecycleJob,
  transitionSupportIncident,
} from "../../build/modules/saas-admin/src/index.js";

const plan = {
  schemaVersion: "1.0",
  planId: "growth",
  version: "2026-07",
  displayName: "Growth",
  status: "active",
  effectiveFrom: "2026-07-01T00:00:00.000Z",
  entitlements: [
    { entitlementCode: "catalog.products", valueType: "integer", value: "1000", enforcement: "hard", resetPeriod: "month" },
    { entitlementCode: "reporting.advanced", valueType: "boolean", value: "true", enforcement: "hard" },
    { entitlementCode: "integrations.preview", valueType: "boolean", value: "false", enforcement: "soft" },
  ],
};

const subscription = {
  schemaVersion: "1.0",
  subscriptionId: "subscription-1",
  tenantId: "tenant-1",
  planId: "growth",
  planVersion: "2026-07",
  status: "active",
  startedAt: "2026-07-01T00:00:00.000Z",
  currentPeriodStart: "2026-07-01T00:00:00.000Z",
  currentPeriodEnd: "2026-08-01T00:00:00.000Z",
  version: "1",
};

test("tenant access combines subscription period, plan identity and exact entitlement limits", () => {
  const allowed = evaluateTenantAccess({
    subscription,
    plan,
    entitlementCode: "catalog.products",
    observedAt: "2026-07-30T00:00:00.000Z",
    observedQuantity: "999",
  });
  assert.deepEqual(allowed, {
    allowed: true,
    reason: "allowed",
    enforcement: "hard",
    requiresBillingAttention: false,
    limit: "1000",
    observed: "999",
  });

  const denied = evaluateTenantAccess({
    subscription,
    plan,
    entitlementCode: "catalog.products",
    observedAt: "2026-07-30T00:00:00.000Z",
    observedQuantity: "1001",
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "entitlement_limit_exceeded");

  const suspended = evaluateTenantAccess({
    subscription: { ...subscription, status: "suspended", suspendedAt: "2026-07-29T00:00:00.000Z" },
    plan,
    entitlementCode: "reporting.advanced",
    observedAt: "2026-07-30T00:00:00.000Z",
  });
  assert.deepEqual(suspended, {
    allowed: false,
    reason: "subscription_inactive",
    enforcement: "hard",
    requiresBillingAttention: false,
  });

  const pastDue = evaluateTenantAccess({
    subscription: { ...subscription, status: "past_due" },
    plan,
    entitlementCode: "reporting.advanced",
    observedAt: "2026-07-30T00:00:00.000Z",
  });
  assert.equal(pastDue.allowed, true);
  assert.equal(pastDue.requiresBillingAttention, true);

  const softDisabled = evaluateTenantAccess({
    subscription,
    plan,
    entitlementCode: "integrations.preview",
    observedAt: "2026-07-30T00:00:00.000Z",
  });
  assert.equal(softDisabled.allowed, true);
  assert.equal(softDisabled.reason, "entitlement_disabled");
  assert.equal(softDisabled.enforcement, "soft");
});

test("feature rollout decisions are stable per tenant and obey explicit state", () => {
  const rollout = {
    schemaVersion: "1.0",
    rolloutId: "rollout-1",
    tenantId: "tenant-1",
    featureCode: "reporting.new-dashboard",
    status: "enabled",
    rolloutPercentage: 50,
    reason: "Controlled pilot",
    updatedAt: "2026-07-30T00:00:00.000Z",
    version: "1",
  };
  const first = featureEnabledForTenant(rollout);
  assert.equal(featureEnabledForTenant(rollout), first);
  assert.equal(featureEnabledForTenant({ ...rollout, rolloutPercentage: 100 }), true);
  assert.equal(featureEnabledForTenant({ ...rollout, status: "paused", rolloutPercentage: 0 }), false);
  assert.throws(() => featureEnabledForTenant({ ...rollout, status: "paused" }), /percentage must be zero/i);
});

test("support incident state machine preserves resolution evidence and supports audited reopening", () => {
  const incident = {
    schemaVersion: "1.0",
    incidentId: "incident-1",
    tenantId: "tenant-1",
    incidentCode: "INC-2026-001",
    severity: "high",
    status: "open",
    summary: "Connector outage",
    openedAt: "2026-07-30T00:00:00.000Z",
    version: "1",
  };
  const investigating = transitionSupportIncident(incident, "investigate", "2026-07-30T00:05:00.000Z");
  assert.equal(investigating.status, "investigating");
  const resolved = transitionSupportIncident(investigating, "resolve", "2026-07-30T00:10:00.000Z");
  assert.equal(resolved.resolvedAt, "2026-07-30T00:10:00.000Z");
  const reopened = transitionSupportIncident(resolved, "reopen", "2026-07-30T00:15:00.000Z");
  assert.equal(reopened.status, "investigating");
  assert.equal("resolvedAt" in reopened, false);
  assert.throws(() => transitionSupportIncident(reopened, "close", "2026-07-30T00:20:00.000Z"), /invalid/i);
});

function lifecycleJob(operation = "suspend") {
  return {
    schemaVersion: "1.0",
    jobId: `job-${operation}`,
    tenantId: "tenant-1",
    operation,
    status: "queued",
    requestedAt: "2026-07-30T00:00:00.000Z",
    requestedBy: "user-1",
    reason: "Approved operation",
    metadata: { actorId: "user-1", requestId: "request-1", traceId: "trace-1" },
  };
}

test("tenant lifecycle worker records ordered running and completed transitions", async () => {
  const transitions = [];
  const result = await runTenantLifecycleJob({
    job: lifecycleJob(),
    observedAt: "2026-07-30T00:01:00.000Z",
    executor: { async execute() { return { disposition: "completed" }; } },
    commands: { async transition(input) { transitions.push(input); } },
  });
  assert.deepEqual(result, { status: "completed" });
  assert.deepEqual(transitions.map(({ priorStatus, newStatus }) => [priorStatus, newStatus]), [
    ["queued", "running"],
    ["running", "completed"],
  ]);
});

test("tenant lifecycle export requires evidence and normalizes retryable failures", async () => {
  const missingEvidence = [];
  const result = await runTenantLifecycleJob({
    job: lifecycleJob("export"),
    observedAt: "2026-07-30T00:01:00.000Z",
    executor: { async execute() { return { disposition: "completed" }; } },
    commands: { async transition(input) { missingEvidence.push(input); } },
  });
  assert.deepEqual(result, { status: "failed", reasonCode: "export_evidence_invalid", retryable: false });
  assert.equal(missingEvidence.at(-1).newStatus, "failed");

  const retryable = [];
  const outage = await runTenantLifecycleJob({
    job: lifecycleJob("provision"),
    observedAt: "2026-07-30T00:02:00.000Z",
    executor: {
      async execute() {
        throw new TenantLifecycleExecutionError("provider_unavailable", true, "Provider unavailable");
      },
    },
    commands: { async transition(input) { retryable.push(input); } },
  });
  assert.deepEqual(outage, { status: "failed", reasonCode: "provider_unavailable", retryable: true });
  assert.equal(retryable.at(-1).reasonCode, "provider_unavailable");
});

test("tenant lifecycle offboarding completes only with tenant export evidence", async () => {
  const transitions = [];
  const result = await runTenantLifecycleJob({
    job: lifecycleJob("offboard"),
    observedAt: "2026-07-30T00:03:00.000Z",
    executor: {
      async execute() {
        return { disposition: "completed", evidenceReference: "r2://tenant-1/exports/offboard.json" };
      },
    },
    commands: { async transition(input) { transitions.push(input); } },
  });
  assert.deepEqual(result, {
    status: "completed",
    evidenceReference: "r2://tenant-1/exports/offboard.json",
  });
  assert.equal(transitions.at(-1).newStatus, "completed");
});
