import assert from "node:assert/strict";
import test from "node:test";
import { PlatformError } from "../../build/packages/foundation/src/errors.js";
import { ComplianceService, MapFiscalProviderRegistry } from "../../build/modules/compliance/src/service.js";
import { DeterministicFiscalProvider } from "../../build/modules/compliance/src/simulator.js";

const context = {
  requestId: "018f0000-0000-7000-8000-000000000001",
  traceId: "trace-compliance",
  tenantId: "018f0000-0000-7000-8000-000000000002",
  actorId: "018f0000-0000-7000-8000-000000000003",
  legalEntityId: "018f0000-0000-7000-8000-000000000004",
  storeId: "018f0000-0000-7000-8000-000000000005",
  locale: "bn-BD",
  timeZone: "Asia/Dhaka",
  businessDate: "2026-07-29",
  region: "test",
  permissions: new Set([
    "localization.document.publish",
    "localization.fiscal.submit",
    "localization.privacy.execute",
  ]),
};

class FakeComplianceStore {
  constructor() {
    this.documents = new Map();
    this.fiscal = new Map();
    this.privacy = new Map();
    this.transitions = [];
  }

  async publishLegalDocument(_context, command) {
    const key = `${command.sourceType}:${command.sourceId}:${command.sourceVersion}:${command.documentType}`;
    const existing = this.documents.get(key);
    if (existing) return { documentId: existing.documentId, replayed: true };
    const result = { documentId: command.documentId, replayed: false };
    this.documents.set(key, result);
    return result;
  }

  async createFiscalSubmission(_context, command) {
    const existing = this.fiscal.get(command.idempotencyKey);
    if (existing) return { ...existing, replayed: true };
    const result = { submissionId: command.submissionId, status: "pending", replayed: false };
    this.fiscal.set(command.idempotencyKey, result);
    return result;
  }

  async recordFiscalTransition(_context, command) {
    this.transitions.push(command);
    return {
      submissionId: command.submissionId,
      status: command.status,
      replayed: false,
      observedAt: command.observedAt,
      ...(command.providerReference ? { providerReference: command.providerReference } : {}),
      ...(command.rejectionCode ? { rejectionCode: command.rejectionCode } : {}),
    };
  }

  async createPrivacyOperation(_context, command) {
    const existing = this.privacy.get(command.idempotencyKey);
    if (existing) return { ...existing, replayed: true };
    const result = { operationId: command.operationId, status: "requested", replayed: false };
    this.privacy.set(command.idempotencyKey, result);
    return result;
  }

  async transitionPrivacyOperation(_context, command) {
    return { operationId: command.operationId, status: command.status, replayed: false };
  }
}

const legalDocument = () => ({
  documentId: "document-1",
  documentType: "receipt",
  legalNumber: "BD-000001",
  issuedAt: "2026-07-29T10:00:00.000Z",
  packVersionId: "pack-version-1",
  templateId: "bd-receipt",
  templateVersion: "1.0.0",
  taxRuleVersion: "bd-tax-v1",
  currencyMetadataVersion: "bdt-v1",
  sourceType: "pos.receipt",
  sourceId: "receipt-1",
  sourceVersion: "1",
  totals: { payable: { amountMinor: "1000", currency: "BDT", scale: 2 } },
  semanticPayloadHash: "a".repeat(64),
  renderedDocumentHash: "b".repeat(64),
  archiveObjectKey: "legal/bd/receipt-1.pdf",
  fiscalStatus: "pending",
});

const fiscalCommand = (idempotencyKey = "fiscal-key-1") => ({
  submissionId: "submission-1",
  documentId: "document-1",
  providerCapabilityId: "fiscal.bd.simulator",
  countryPackVersion: "1.0.0",
  payloadHash: "c".repeat(64),
  idempotencyKey,
  requestHash: `hash-${idempotencyKey}`,
  submittedAt: "2026-07-29T10:01:00.000Z",
});

test("compliance service publishes immutable legal documents and enforces permission", async () => {
  const store = new FakeComplianceStore();
  const service = new ComplianceService(store, new MapFiscalProviderRegistry([]));
  assert.deepEqual(await service.publishLegalDocument(context, legalDocument()), { documentId: "document-1", replayed: false });
  assert.deepEqual(await service.publishLegalDocument(context, legalDocument()), { documentId: "document-1", replayed: true });
  await assert.rejects(
    () => service.publishLegalDocument({ ...context, permissions: new Set() }, legalDocument()),
    (error) => error instanceof PlatformError && error.code === "PERMISSION_DENIED",
  );
});

test("fiscal submission records provider acceptance once and replays without blind provider retry", async () => {
  const store = new FakeComplianceStore();
  let calls = 0;
  const provider = new DeterministicFiscalProvider(
    "fiscal.bd.simulator",
    new Set(["1.0.0"]),
    "accept",
    () => "2026-07-29T10:02:00.000Z",
  );
  const wrapped = { ...provider, async submit(request) { calls += 1; return await provider.submit(request); } };
  const service = new ComplianceService(store, new MapFiscalProviderRegistry([[wrapped.capabilityId, wrapped]]));
  const first = await service.submitFiscal(context, fiscalCommand());
  assert.equal(first.status, "accepted");
  assert.equal(first.providerReference, "fiscal-submission-1");
  const replay = await service.submitFiscal(context, fiscalCommand());
  assert.equal(replay.status, "pending");
  assert.equal(replay.replayed, true);
  assert.equal(calls, 1);
});

test("unknown provider result fails safe and unsupported packs are rejected explicitly", async () => {
  const store = new FakeComplianceStore();
  const throwing = new DeterministicFiscalProvider(
    "fiscal.bd.simulator",
    new Set(["1.0.0"]),
    "throw_after_effect",
    () => "2026-07-29T10:03:00.000Z",
  );
  const service = new ComplianceService(store, new MapFiscalProviderRegistry([[throwing.capabilityId, throwing]]));
  const unknown = await service.submitFiscal(context, fiscalCommand("fiscal-key-unknown"));
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.rejectionCode, "PROVIDER_RESULT_UNKNOWN");

  const unsupportedStore = new FakeComplianceStore();
  const unsupported = new DeterministicFiscalProvider("fiscal.bd.simulator", new Set(["2.0.0"]));
  const unsupportedService = new ComplianceService(unsupportedStore, new MapFiscalProviderRegistry([[unsupported.capabilityId, unsupported]]));
  const rejected = await unsupportedService.submitFiscal(context, fiscalCommand("fiscal-key-unsupported"));
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.rejectionCode, "UNSUPPORTED_COUNTRY_PACK");
});

test("privacy workflow requires terminal completion evidence", async () => {
  const store = new FakeComplianceStore();
  const service = new ComplianceService(store, new MapFiscalProviderRegistry([]));
  const created = await service.requestPrivacyOperation(context, {
    operationId: "privacy-1",
    subjectReference: "customer-1",
    operationType: "erase",
    retentionPolicyId: "retention-1",
    reason: "Verified data-subject request",
    requestedAt: "2026-07-29T10:04:00.000Z",
    idempotencyKey: "privacy-key-1",
    requestHash: "hash-privacy-key-1",
  });
  assert.equal(created.status, "requested");
  await assert.rejects(
    () => service.transitionPrivacyOperation(context, {
      operationId: "privacy-1",
      status: "completed",
      preservedEvidenceReferences: ["invoice-1"],
      affectedResourceReferences: ["customer-1"],
    }),
    (error) => error instanceof PlatformError && error.code === "VALIDATION_FAILED",
  );
  const completed = await service.transitionPrivacyOperation(context, {
    operationId: "privacy-1",
    status: "completed",
    preservedEvidenceReferences: ["invoice-1"],
    affectedResourceReferences: ["customer-1"],
    completedAt: "2026-07-29T10:05:00.000Z",
  });
  assert.equal(completed.status, "completed");
});
