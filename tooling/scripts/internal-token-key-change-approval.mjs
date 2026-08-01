const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const REFERENCE = /^[A-Z][A-Z0-9-]{7,63}$/u;
const MAX_APPROVAL_WINDOW_SECONDS = 1_800;

export const INTERNAL_TOKEN_KEY_CHANGE_APPROVAL_SCHEMA_VERSION = 1;

const CHANGE_TYPES = new Set([
  "scheduled_rotation",
  "urgent_replacement",
  "previous_retirement",
]);
const REQUIRED_ROLES = new Set(["security_owner", "platform_owner"]);

function fail(message) {
  throw new Error(`Internal-token key change approval: ${message}`);
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} is invalid`);
  }
  return value;
}

function exactKeys(value, expected, name) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    fail(`${name} fields are invalid`);
  }
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} is invalid`);
  return value;
}

function digest(value, name) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${name} is invalid`);
  return value;
}

function role(value) {
  if (typeof value !== "string" || !REQUIRED_ROLES.has(value)) {
    fail("approval role is invalid");
  }
  return value;
}

export function normalizeInternalTokenKeyChangeRequest(input) {
  const value = object(input, "change request");
  exactKeys(
    value,
    [
      "changeReference",
      "changeType",
      "requestedAt",
      "expiresAt",
      "proposerDigest",
    ],
    "change request",
  );
  if (typeof value.changeReference !== "string" || !REFERENCE.test(value.changeReference)) {
    fail("change reference is invalid");
  }
  if (typeof value.changeType !== "string" || !CHANGE_TYPES.has(value.changeType)) {
    fail("change type is invalid");
  }
  const requestedAt = positiveInteger(value.requestedAt, "requested-at");
  const expiresAt = positiveInteger(value.expiresAt, "expiry");
  if (
    expiresAt <= requestedAt ||
    expiresAt - requestedAt > MAX_APPROVAL_WINDOW_SECONDS
  ) {
    fail("approval window is invalid");
  }
  return Object.freeze({
    schemaVersion: INTERNAL_TOKEN_KEY_CHANGE_APPROVAL_SCHEMA_VERSION,
    changeReference: value.changeReference,
    changeType: value.changeType,
    requestedAt,
    expiresAt,
    proposerDigest: digest(value.proposerDigest, "proposer digest"),
  });
}

export function evaluateInternalTokenKeyChangeApprovals(
  requestInput,
  approvalsInput,
  nowInput,
) {
  const request = normalizeInternalTokenKeyChangeRequest(requestInput);
  const now = positiveInteger(nowInput, "clock");
  if (now < request.requestedAt || now > request.expiresAt) {
    fail("change request is outside its approval window");
  }
  if (!Array.isArray(approvalsInput) || approvalsInput.length !== 2) {
    fail("exactly two approvals are required");
  }
  const approvals = approvalsInput.map((input, index) => {
    const value = object(input, `approval ${index + 1}`);
    exactKeys(value, ["actorDigest", "role", "approvedAt"], `approval ${index + 1}`);
    const approvedAt = positiveInteger(value.approvedAt, `approval ${index + 1} timestamp`);
    if (approvedAt < request.requestedAt || approvedAt > request.expiresAt || approvedAt > now) {
      fail(`approval ${index + 1} timestamp is outside the window`);
    }
    return Object.freeze({
      actorDigest: digest(value.actorDigest, `approval ${index + 1} actor digest`),
      role: role(value.role),
      approvedAt,
    });
  });
  if (approvals.some((approval) => approval.actorDigest === request.proposerDigest)) {
    fail("proposer cannot approve the change");
  }
  if (new Set(approvals.map((approval) => approval.actorDigest)).size !== 2) {
    fail("approval actors must be distinct");
  }
  if (new Set(approvals.map((approval) => approval.role)).size !== REQUIRED_ROLES.size) {
    fail("required approval roles are incomplete");
  }
  return Object.freeze({
    schemaVersion: INTERNAL_TOKEN_KEY_CHANGE_APPROVAL_SCHEMA_VERSION,
    changeReference: request.changeReference,
    changeType: request.changeType,
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    approvalCount: approvals.length,
    approved: true,
  });
}

export function summarizeInternalTokenKeyChangeApproval(resultInput) {
  const result = object(resultInput, "approval result");
  if (
    result.schemaVersion !== INTERNAL_TOKEN_KEY_CHANGE_APPROVAL_SCHEMA_VERSION ||
    result.approved !== true ||
    result.approvalCount !== 2
  ) {
    fail("approval result is invalid");
  }
  return Object.freeze({
    schemaVersion: INTERNAL_TOKEN_KEY_CHANGE_APPROVAL_SCHEMA_VERSION,
    changeType: result.changeType,
    approvalCount: 2,
    approved: true,
    actorIdentifiersIncluded: false,
    changeReferenceIncluded: false,
  });
}
