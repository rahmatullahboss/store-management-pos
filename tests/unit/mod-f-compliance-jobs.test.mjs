import assert from "node:assert/strict";
import test from "node:test";
import { executeComplianceJob } from "../../build/apps/worker-jobs/src/compliance-jobs.js";
import { PlatformError } from "../../build/packages/foundation/src/errors.js";

const context = {
  requestId: "018f0000-0000-7000-8000-000000000001",
  traceId: "trace-compliance-job",
  tenantId: "018f0000-0000-7000-8000-000000000002",
  actorId: "018f0000-0000-7000-8000-000000000003",
  legalEntityId: "018f0000-0000-7000-8000-000000000004",
  locale: "en-GB",
  timeZone: "Europe/London",
  businessDate: "2026-07-29",
  region: "test",
  permissions: new Set(),
};

class RecordingMetrics {
  constructor() { this.rows = []; }
  increment(name, value, attributes) { this.rows.push({ kind: "increment", name, value, attributes }); }
  observe(name, value, attributes) { this.rows.push({ kind: "observe", name, value, attributes }); }
}

const fiscalJob = {
  type: "fiscal_submission_dispatch",
  submissionId: "submission-1",
  documentId: "document-1",
  providerCapabilityId: "provider-1",
  countryPackVersion: "1.0.0",
  payloadHash: "a".repeat(64),
  idempotencyKey: "fiscal-job-1",
  requestHash: "hash-fiscal-job-1",
  submittedAt: "2026-07-29T11:00:00.000Z",
};

test("fiscal job completes accepted results and sends unknown or replayed pending results to review", async () => {
  const metrics = new RecordingMetrics();
  const accepted = await executeComplianceJob(context, {
    compliance: {
      async submitFiscal() {
        return { submissionId: "submission-1", status: "accepted", replayed: false, observedAt: "2026-07-29T11:01:00.000Z" };
      },
      async transitionPrivacyOperation() { throw new Error("not used"); },
    },
  }, fiscalJob, { metrics });
  assert.equal(accepted.status, "completed");

  const unknown = await executeComplianceJob(context, {
    compliance: {
      async submitFiscal() {
        return { submissionId: "submission-1", status: "unknown", replayed: false, observedAt: "2026-07-29T11:02:00.000Z" };
      },
      async transitionPrivacyOperation() { throw new Error("not used"); },
    },
  }, fiscalJob);
  assert.equal(unknown.status, "review");
  assert.match(unknown.reason, /explicit recovery or review/i);

  const replay = await executeComplianceJob(context, {
    compliance: {
      async submitFiscal() {
        return { submissionId: "submission-1", status: "pending", replayed: true, observedAt: "2026-07-29T11:03:00.000Z" };
      },
      async transitionPrivacyOperation() { throw new Error("not used"); },
    },
  }, fiscalJob);
  assert.equal(replay.status, "review");
  assert.equal(metrics.rows[0].name, "mod_f.compliance.job");
});

test("privacy transition job completes evidence-preserving transitions and reports safe failures", async () => {
  const job = {
    type: "privacy_operation_transition",
    operationId: "privacy-1",
    status: "completed",
    preservedEvidenceReferences: ["invoice-1"],
    affectedResourceReferences: ["customer-1"],
    completedAt: "2026-07-29T11:10:00.000Z",
  };
  const completed = await executeComplianceJob(context, {
    compliance: {
      async submitFiscal() { throw new Error("not used"); },
      async transitionPrivacyOperation() {
        return { operationId: "privacy-1", status: "completed", replayed: false };
      },
    },
  }, job);
  assert.equal(completed.status, "completed");

  const failed = await executeComplianceJob(context, {
    compliance: {
      async submitFiscal() { throw new Error("not used"); },
      async transitionPrivacyOperation() {
        throw new PlatformError("PERMISSION_DENIED", "Permission denied", 403);
      },
    },
  }, job);
  assert.equal(failed.status, "failed");
  assert.equal(failed.reason, "PERMISSION_DENIED:Permission denied");
});
