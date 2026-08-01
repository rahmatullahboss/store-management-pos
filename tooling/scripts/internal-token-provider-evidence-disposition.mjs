import { createHash } from "node:crypto";

const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const MAX_APPROVAL_WINDOW_SECONDS = 1_800;
const MAX_CANDIDATES = 100_000;
const REQUIRED_ROLES = new Set(["records_owner", "security_owner"]);
const PROVIDER_CLASSES = new Set([
  "object-lock-archive",
  "vault-archive",
  "offline-custodian",
]);

export const INTERNAL_TOKEN_PROVIDER_EVIDENCE_DISPOSITION_SCHEMA_VERSION = 1;
export const INTERNAL_TOKEN_PROVIDER_EVIDENCE_DISPOSITION_SQL = `SELECT
  platform.append_internal_token_provider_evidence_disposition(
    $1::bigint,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,
    $9::text,$10::integer,$11::smallint,$12::integer,$13::text,$14::timestamptz,
    $15::text,$16::text
  ) IS NOT NULL AS recorded`;

function fail(message) {
  throw new Error(`Internal-token provider evidence disposition: ${message}`);
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

function distinct(values, name) {
  if (new Set(values).size !== values.length) fail(`${name} must have distinct purposes`);
}

function custody(input) {
  const value = exact(input, [
    "chainRootDigest", "custodyDigest", "eligibleForDisposalCount", "exportDigest",
    "generatedAt", "legalHoldCount", "minimumRetainedUntil", "policyDigest",
    "previousCustodyDigest", "privacyProfile", "recordCount", "retentionDays",
    "schemaVersion", "sequence", "status",
  ], "custody evidence");
  if (value.schemaVersion !== 1 || value.privacyProfile !== "digest-only-v1" || value.status !== "sealed") {
    fail("custody evidence profile is invalid");
  }
  const sequence = integer(value.sequence, "custody sequence", 1);
  const previousCustodyDigest = value.previousCustodyDigest === null ? null :
    digest(value.previousCustodyDigest, "previous custody digest");
  if ((sequence === 1) !== (previousCustodyDigest === null)) fail("custody linkage shape is invalid");
  const recordCount = integer(value.recordCount, "custody record count", 1, MAX_CANDIDATES);
  const legalHoldCount = integer(value.legalHoldCount, "custody legal-hold count", 0, recordCount);
  const eligibleForDisposalCount = integer(
    value.eligibleForDisposalCount,
    "custody disposal-eligible count",
    0,
    recordCount - legalHoldCount,
  );
  const body = {
    chainRootDigest: digest(value.chainRootDigest, "custody chain-root digest"),
    eligibleForDisposalCount,
    exportDigest: digest(value.exportDigest, "custody export digest"),
    generatedAt: integer(value.generatedAt, "custody generation time", 1),
    legalHoldCount,
    minimumRetainedUntil: integer(
      value.minimumRetainedUntil,
      "custody minimum retained-until",
      value.generatedAt,
    ),
    policyDigest: digest(value.policyDigest, "custody policy digest"),
    previousCustodyDigest,
    privacyProfile: value.privacyProfile,
    recordCount,
    retentionDays: integer(value.retentionDays, "custody retention days", 1, 3_650),
    schemaVersion: 1,
    sequence,
    status: "sealed",
  };
  const custodyDigest = digest(value.custodyDigest, "custody digest");
  if (hash(body) !== custodyDigest) fail("custody evidence digest does not match");
  distinct(
    [body.chainRootDigest, body.exportDigest, body.policyDigest, custodyDigest],
    "custody evidence digests",
  );
  return Object.freeze({ ...body, custodyDigest });
}

function request(input) {
  const value = exact(input, [
    "candidateCount", "caseDigest", "custodyDigest", "expiresAt", "exportDigest",
    "policyDigest", "proposerDigest", "requestDigest", "requestedAt", "schemaVersion",
  ], "disposition request");
  if (value.schemaVersion !== 1) fail("disposition request schema version is invalid");
  const body = {
    candidateCount: integer(value.candidateCount, "candidate count", 1, MAX_CANDIDATES),
    caseDigest: digest(value.caseDigest, "case digest"),
    custodyDigest: digest(value.custodyDigest, "request custody digest"),
    expiresAt: integer(value.expiresAt, "request expiry", 1),
    exportDigest: digest(value.exportDigest, "request export digest"),
    policyDigest: digest(value.policyDigest, "request policy digest"),
    proposerDigest: digest(value.proposerDigest, "proposer digest"),
    requestedAt: integer(value.requestedAt, "requested-at", 1),
    schemaVersion: 1,
  };
  if (body.expiresAt <= body.requestedAt ||
      body.expiresAt - body.requestedAt > MAX_APPROVAL_WINDOW_SECONDS) {
    fail("disposition request approval window is invalid");
  }
  const requestDigest = digest(value.requestDigest, "request digest");
  if (hash(body) !== requestDigest) fail("disposition request digest does not match");
  distinct([
    body.caseDigest,
    body.custodyDigest,
    body.exportDigest,
    body.policyDigest,
    body.proposerDigest,
    requestDigest,
  ], "disposition request digests");
  return Object.freeze({ ...body, requestDigest });
}

function approval(input, dispositionRequest) {
  const value = exact(input, [
    "approvalCount", "approvalDigest", "approvedAt", "approvals", "candidateCount",
    "custodyDigest", "expiresAt", "requestDigest", "schemaVersion",
  ], "disposition approval");
  if (value.schemaVersion !== 1 || value.approvalCount !== 2 ||
      value.candidateCount !== dispositionRequest.candidateCount ||
      value.custodyDigest !== dispositionRequest.custodyDigest ||
      value.expiresAt !== dispositionRequest.expiresAt ||
      value.requestDigest !== dispositionRequest.requestDigest) {
    fail("disposition approval binding is invalid");
  }
  if (!Array.isArray(value.approvals) || value.approvals.length !== 2) {
    fail("exactly two disposition approvals are required");
  }
  const approvals = value.approvals.map((item, index) => {
    const entry = exact(item, ["actorDigest", "approvedAt", "role"], `approval ${index + 1}`);
    const approvedAt = integer(entry.approvedAt, `approval ${index + 1} timestamp`, 1);
    if (approvedAt < dispositionRequest.requestedAt || approvedAt > dispositionRequest.expiresAt) {
      fail(`approval ${index + 1} timestamp is outside the request window`);
    }
    if (typeof entry.role !== "string" || !REQUIRED_ROLES.has(entry.role)) {
      fail(`approval ${index + 1} role is invalid`);
    }
    return Object.freeze({
      actorDigest: digest(entry.actorDigest, `approval ${index + 1} actor digest`),
      approvedAt,
      role: entry.role,
    });
  }).sort((left, right) => left.role.localeCompare(right.role));
  if (approvals.some((item) => item.actorDigest === dispositionRequest.proposerDigest)) {
    fail("disposition proposer cannot approve the request");
  }
  if (new Set(approvals.map((item) => item.actorDigest)).size !== 2) {
    fail("disposition approval actors must be distinct");
  }
  if (new Set(approvals.map((item) => item.role)).size !== REQUIRED_ROLES.size) {
    fail("required disposition approval roles are incomplete");
  }
  const approvedAt = integer(value.approvedAt, "approval completion time", 1);
  if (approvedAt !== Math.max(...approvals.map((item) => item.approvedAt))) {
    fail("approval completion time does not match");
  }
  const body = {
    approvals,
    candidateCount: dispositionRequest.candidateCount,
    custodyDigest: dispositionRequest.custodyDigest,
    expiresAt: dispositionRequest.expiresAt,
    requestDigest: dispositionRequest.requestDigest,
    schemaVersion: 1,
  };
  const approvalDigest = digest(value.approvalDigest, "approval digest");
  if (hash(body) !== approvalDigest) fail("disposition approval digest does not match");
  distinct(
    [dispositionRequest.custodyDigest, dispositionRequest.requestDigest, approvalDigest],
    "disposition approval digests",
  );
  return Object.freeze({
    ...body,
    approvalCount: 2,
    approvalDigest,
    approvedAt,
  });
}

function recheck(input, dispositionRequest, dispositionApproval, now) {
  const value = exact(input, [
    "approvalDigest", "candidateCount", "custodyDigest", "exportDigest",
    "legalHoldCount", "recheckDigest", "recheckedAt", "requestDigest",
    "schemaVersion", "snapshotDigest",
  ], "disposition recheck");
  if (value.schemaVersion !== 1 ||
      value.approvalDigest !== dispositionApproval.approvalDigest ||
      value.candidateCount !== dispositionRequest.candidateCount ||
      value.custodyDigest !== dispositionRequest.custodyDigest ||
      value.exportDigest !== dispositionRequest.exportDigest ||
      value.requestDigest !== dispositionRequest.requestDigest) {
    fail("disposition recheck binding is invalid");
  }
  const legalHoldCount = integer(value.legalHoldCount, "recheck legal-hold count", 0);
  if (legalHoldCount !== 0) fail("active legal hold blocks evidence disposition");
  const recheckedAt = integer(value.recheckedAt, "recheck timestamp", 1);
  if (recheckedAt < dispositionApproval.approvedAt ||
      recheckedAt > dispositionRequest.expiresAt || recheckedAt > now) {
    fail("disposition recheck timestamp is outside the authorization window");
  }
  const snapshotBody = {
    candidateCount: dispositionRequest.candidateCount,
    custodyDigest: dispositionRequest.custodyDigest,
    exportDigest: dispositionRequest.exportDigest,
    legalHoldCount,
    recheckedAt,
    schemaVersion: 1,
  };
  const snapshotDigest = digest(value.snapshotDigest, "recheck snapshot digest");
  if (hash(snapshotBody) !== snapshotDigest) fail("disposition recheck snapshot digest does not match");
  const body = {
    approvalDigest: dispositionApproval.approvalDigest,
    requestDigest: dispositionRequest.requestDigest,
    snapshotDigest,
  };
  const recheckDigest = digest(value.recheckDigest, "recheck digest");
  if (hash(body) !== recheckDigest) fail("disposition recheck digest does not match");
  distinct([
    dispositionRequest.custodyDigest,
    dispositionRequest.requestDigest,
    dispositionApproval.approvalDigest,
    snapshotDigest,
    recheckDigest,
  ], "disposition recheck digests");
  return Object.freeze({
    ...snapshotBody,
    approvalDigest: dispositionApproval.approvalDigest,
    requestDigest: dispositionRequest.requestDigest,
    recheckDigest,
    snapshotDigest,
  });
}

export function createInternalTokenProviderEvidenceDispositionRequest(custodyInput, input) {
  const sealedCustody = custody(custodyInput);
  const value = exact(input, [
    "caseDigest", "expiresAt", "proposerDigest", "requestedAt", "schemaVersion",
  ], "disposition request input");
  if (value.schemaVersion !== 1) fail("disposition request schema version is invalid");
  const requestedAt = integer(value.requestedAt, "requested-at", 1);
  const expiresAt = integer(value.expiresAt, "request expiry", 1);
  if (requestedAt < sealedCustody.generatedAt ||
      requestedAt < sealedCustody.minimumRetainedUntil) {
    fail("custody evidence has not reached its retention horizon");
  }
  if (sealedCustody.legalHoldCount !== 0 ||
      sealedCustody.eligibleForDisposalCount !== sealedCustody.recordCount) {
    fail("custody export is not entirely eligible for disposition");
  }
  const body = {
    candidateCount: sealedCustody.recordCount,
    caseDigest: digest(value.caseDigest, "case digest"),
    custodyDigest: sealedCustody.custodyDigest,
    expiresAt,
    exportDigest: sealedCustody.exportDigest,
    policyDigest: sealedCustody.policyDigest,
    proposerDigest: digest(value.proposerDigest, "proposer digest"),
    requestedAt,
    schemaVersion: 1,
  };
  if (expiresAt <= requestedAt || expiresAt - requestedAt > MAX_APPROVAL_WINDOW_SECONDS) {
    fail("disposition request approval window is invalid");
  }
  const requestDigest = hash(body);
  distinct([
    body.caseDigest,
    body.custodyDigest,
    body.exportDigest,
    body.policyDigest,
    body.proposerDigest,
    requestDigest,
  ], "disposition request digests");
  return Object.freeze({ ...body, requestDigest });
}

export function authorizeInternalTokenProviderEvidenceDisposition(
  requestInput,
  approvalsInput,
  nowInput,
) {
  const dispositionRequest = request(requestInput);
  const now = integer(nowInput, "authorization clock", 1);
  if (now < dispositionRequest.requestedAt || now > dispositionRequest.expiresAt) {
    fail("disposition request is outside its approval window");
  }
  if (!Array.isArray(approvalsInput) || approvalsInput.length !== 2) {
    fail("exactly two disposition approvals are required");
  }
  const approvals = approvalsInput.map((item, index) => {
    const value = exact(item, ["actorDigest", "approvedAt", "role"], `approval ${index + 1}`);
    const approvedAt = integer(value.approvedAt, `approval ${index + 1} timestamp`, 1);
    if (approvedAt < dispositionRequest.requestedAt ||
        approvedAt > dispositionRequest.expiresAt || approvedAt > now) {
      fail(`approval ${index + 1} timestamp is outside the request window`);
    }
    if (typeof value.role !== "string" || !REQUIRED_ROLES.has(value.role)) {
      fail(`approval ${index + 1} role is invalid`);
    }
    return Object.freeze({
      actorDigest: digest(value.actorDigest, `approval ${index + 1} actor digest`),
      approvedAt,
      role: value.role,
    });
  }).sort((left, right) => left.role.localeCompare(right.role));
  if (approvals.some((item) => item.actorDigest === dispositionRequest.proposerDigest)) {
    fail("disposition proposer cannot approve the request");
  }
  if (new Set(approvals.map((item) => item.actorDigest)).size !== 2) {
    fail("disposition approval actors must be distinct");
  }
  if (new Set(approvals.map((item) => item.role)).size !== REQUIRED_ROLES.size) {
    fail("required disposition approval roles are incomplete");
  }
  const body = {
    approvals,
    candidateCount: dispositionRequest.candidateCount,
    custodyDigest: dispositionRequest.custodyDigest,
    expiresAt: dispositionRequest.expiresAt,
    requestDigest: dispositionRequest.requestDigest,
    schemaVersion: 1,
  };
  const approvalDigest = hash(body);
  distinct(
    [dispositionRequest.custodyDigest, dispositionRequest.requestDigest, approvalDigest],
    "disposition approval digests",
  );
  return Object.freeze({
    ...body,
    approvalCount: 2,
    approvalDigest,
    approvedAt: Math.max(...approvals.map((item) => item.approvedAt)),
  });
}

export function createInternalTokenProviderEvidenceDispositionSnapshotDigest(input) {
  return hash(exact(input, [
    "candidateCount", "custodyDigest", "exportDigest", "legalHoldCount",
    "recheckedAt", "schemaVersion",
  ], "disposition recheck snapshot"));
}

export function recheckInternalTokenProviderEvidenceDisposition(
  requestInput,
  approvalInput,
  recheckInput,
  nowInput,
) {
  const dispositionRequest = request(requestInput);
  const dispositionApproval = approval(approvalInput, dispositionRequest);
  const now = integer(nowInput, "recheck clock", 1);
  const value = exact(recheckInput, [
    "candidateCount", "custodyDigest", "exportDigest", "legalHoldCount",
    "recheckedAt", "schemaVersion", "snapshotDigest",
  ], "disposition recheck input");
  const snapshotBody = {
    candidateCount: value.candidateCount,
    custodyDigest: value.custodyDigest,
    exportDigest: value.exportDigest,
    legalHoldCount: value.legalHoldCount,
    recheckedAt: value.recheckedAt,
    schemaVersion: value.schemaVersion,
  };
  const snapshotDigest = digest(value.snapshotDigest, "recheck snapshot digest");
  if (hash(snapshotBody) !== snapshotDigest) fail("disposition recheck snapshot digest does not match");
  const body = {
    approvalDigest: dispositionApproval.approvalDigest,
    requestDigest: dispositionRequest.requestDigest,
    snapshotDigest,
  };
  return recheck({
    ...snapshotBody,
    approvalDigest: dispositionApproval.approvalDigest,
    recheckDigest: hash(body),
    requestDigest: dispositionRequest.requestDigest,
    snapshotDigest,
  }, dispositionRequest, dispositionApproval, now);
}

function receipt(input, dispositionRequest, dispositionApproval, dispositionRecheck, now) {
  const value = exact(input, [
    "approvalDigest", "candidateCount", "custodyDigest", "legalHoldChecked",
    "occurredAt", "operationDigest", "providerAuditDigest", "providerClass",
    "recheckDigest", "requestDigest", "schemaVersion", "status",
  ], "destruction receipt");
  if (value.schemaVersion !== 1 || value.status !== "succeeded" ||
      value.legalHoldChecked !== true ||
      value.approvalDigest !== dispositionApproval.approvalDigest ||
      value.candidateCount !== dispositionRequest.candidateCount ||
      value.custodyDigest !== dispositionRequest.custodyDigest ||
      value.recheckDigest !== dispositionRecheck.recheckDigest ||
      value.requestDigest !== dispositionRequest.requestDigest) {
    fail("destruction receipt binding or status is invalid");
  }
  if (typeof value.providerClass !== "string" || !PROVIDER_CLASSES.has(value.providerClass)) {
    fail("destruction provider class is invalid");
  }
  const occurredAt = integer(value.occurredAt, "destruction timestamp", 1);
  if (occurredAt < dispositionRecheck.recheckedAt ||
      occurredAt > dispositionRequest.expiresAt || occurredAt > now) {
    fail("destruction timestamp is outside the authorization window");
  }
  const operationDigest = digest(value.operationDigest, "destruction operation digest");
  const providerAuditDigest = digest(value.providerAuditDigest, "destruction provider-audit digest");
  distinct([
    dispositionRequest.custodyDigest,
    dispositionRequest.requestDigest,
    dispositionApproval.approvalDigest,
    dispositionRecheck.recheckDigest,
    operationDigest,
    providerAuditDigest,
  ], "destruction receipt digests");
  return Object.freeze({
    candidateCount: dispositionRequest.candidateCount,
    occurredAt,
    operationDigest,
    providerAuditDigest,
    providerClass: value.providerClass,
  });
}

export function createInternalTokenProviderEvidenceDispositionCommand(
  requestInput,
  approvalInput,
  recheckInput,
  receiptInput,
  nowInput,
  sequenceInput,
  previousInput,
) {
  const dispositionRequest = request(requestInput);
  const dispositionApproval = approval(approvalInput, dispositionRequest);
  const now = integer(nowInput, "disposition clock", 1);
  const dispositionRecheck = recheck(
    recheckInput,
    dispositionRequest,
    dispositionApproval,
    now,
  );
  const destructionReceipt = receipt(
    receiptInput,
    dispositionRequest,
    dispositionApproval,
    dispositionRecheck,
    now,
  );
  const sequence = integer(sequenceInput, "disposition sequence", 1);
  const previousDispositionDigest = previousInput === null ? null :
    digest(previousInput, "previous disposition digest");
  if ((sequence === 1) !== (previousDispositionDigest === null)) {
    fail("disposition linkage shape is invalid");
  }
  const body = {
    approvalCount: 2,
    approvalDigest: dispositionApproval.approvalDigest,
    candidateCount: dispositionRequest.candidateCount,
    custodyDigest: dispositionRequest.custodyDigest,
    legalHoldCount: 0,
    occurredAt: destructionReceipt.occurredAt,
    operationDigest: destructionReceipt.operationDigest,
    previousDispositionDigest,
    privacyProfile: "digest-only-v1",
    providerAuditDigest: destructionReceipt.providerAuditDigest,
    providerClass: destructionReceipt.providerClass,
    recheckDigest: dispositionRecheck.recheckDigest,
    requestDigest: dispositionRequest.requestDigest,
    schemaVersion: 1,
    sequence,
    status: "destroyed",
  };
  const dispositionDigest = hash(body);
  distinct([
    body.custodyDigest,
    body.requestDigest,
    body.approvalDigest,
    body.recheckDigest,
    body.operationDigest,
    body.providerAuditDigest,
    dispositionDigest,
  ], "disposition command digests");
  return Object.freeze({ ...body, dispositionDigest });
}

function command(input) {
  const value = exact(input, [
    "approvalCount", "approvalDigest", "candidateCount", "custodyDigest",
    "dispositionDigest", "legalHoldCount", "occurredAt", "operationDigest",
    "previousDispositionDigest", "privacyProfile", "providerAuditDigest",
    "providerClass", "recheckDigest", "requestDigest", "schemaVersion",
    "sequence", "status",
  ], "disposition command");
  if (value.schemaVersion !== 1 || value.approvalCount !== 2 ||
      value.legalHoldCount !== 0 || value.privacyProfile !== "digest-only-v1" ||
      value.status !== "destroyed" ||
      typeof value.providerClass !== "string" || !PROVIDER_CLASSES.has(value.providerClass)) {
    fail("disposition command profile is invalid");
  }
  const sequence = integer(value.sequence, "disposition sequence", 1);
  const previousDispositionDigest = value.previousDispositionDigest === null ? null :
    digest(value.previousDispositionDigest, "previous disposition digest");
  if ((sequence === 1) !== (previousDispositionDigest === null)) {
    fail("disposition linkage shape is invalid");
  }
  const body = {
    approvalCount: 2,
    approvalDigest: digest(value.approvalDigest, "approval digest"),
    candidateCount: integer(value.candidateCount, "candidate count", 1, MAX_CANDIDATES),
    custodyDigest: digest(value.custodyDigest, "custody digest"),
    legalHoldCount: 0,
    occurredAt: integer(value.occurredAt, "disposition timestamp", 1),
    operationDigest: digest(value.operationDigest, "operation digest"),
    previousDispositionDigest,
    privacyProfile: value.privacyProfile,
    providerAuditDigest: digest(value.providerAuditDigest, "provider-audit digest"),
    providerClass: value.providerClass,
    recheckDigest: digest(value.recheckDigest, "recheck digest"),
    requestDigest: digest(value.requestDigest, "request digest"),
    schemaVersion: 1,
    sequence,
    status: "destroyed",
  };
  const dispositionDigest = digest(value.dispositionDigest, "disposition digest");
  if (hash(body) !== dispositionDigest) fail("disposition command digest does not match");
  distinct([
    body.custodyDigest,
    body.requestDigest,
    body.approvalDigest,
    body.recheckDigest,
    body.operationDigest,
    body.providerAuditDigest,
    dispositionDigest,
  ], "disposition command digests");
  return Object.freeze({ ...body, dispositionDigest });
}

export async function recordInternalTokenProviderEvidenceDisposition(client, commandInput) {
  if (!client || typeof client.query !== "function") fail("a query-capable governance client is required");
  const value = command(commandInput);
  let result;
  try {
    result = await client.query(INTERNAL_TOKEN_PROVIDER_EVIDENCE_DISPOSITION_SQL, [
      value.sequence,
      value.custodyDigest,
      value.requestDigest,
      value.approvalDigest,
      value.recheckDigest,
      value.operationDigest,
      value.providerAuditDigest,
      value.previousDispositionDigest,
      value.dispositionDigest,
      value.candidateCount,
      value.approvalCount,
      value.legalHoldCount,
      value.providerClass,
      new Date(value.occurredAt * 1_000).toISOString(),
      value.privacyProfile,
      value.status,
    ]);
  } catch {
    fail("disposition database write failed");
  }
  if (result?.rows?.[0]?.recorded !== true) fail("disposition database acknowledgement is invalid");
  return Object.freeze({
    approvalCount: 2,
    candidateCount: value.candidateCount,
    durable: true,
    identifiersIncluded: false,
    receiptDigestsIncluded: false,
  });
}
