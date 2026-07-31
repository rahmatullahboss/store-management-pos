import { createHash } from "node:crypto";

const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const MAX_SNAPSHOT_LIFETIME_SECONDS = 5 * 60;
const MAX_ENTRY_APPROVAL_WINDOW_SECONDS = 10 * 60;
const MAX_ENTRIES = 100;
const ACTIONS = new Set([
  "emergency_stop",
  "reinstate",
  "revoke",
  "suspend",
]);
const OWNER_ROLES = Object.freeze([
  "operations_owner",
  "platform_owner",
  "security_owner",
]);
const OWNER_ROLE_SET = new Set(OWNER_ROLES);

export const INTERNAL_TOKEN_PRODUCTION_LAUNCH_REVOCATION_SCHEMA_VERSION = 1;
export const INTERNAL_TOKEN_PRODUCTION_LAUNCH_REVOCATION_OWNER_ROLES = OWNER_ROLES;

function fail(message) {
  throw new Error(`Internal-token production launch revocation: ${message}`);
}

function exact(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} is invalid`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
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
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail(`${name} is invalid`);
  }
  return value;
}

function optionalDigest(value, name) {
  if (value === null) return null;
  return digest(value, name);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("base64url");
}

function assertDistinct(values, name) {
  if (new Set(values).size !== values.length) {
    fail(`${name} must be distinct`);
  }
}

function normalizeAction(value, name) {
  if (typeof value !== "string" || !ACTIONS.has(value)) {
    fail(`${name} is invalid`);
  }
  return value;
}

function requiredRoles(action) {
  return action === "emergency_stop" ? ["security_owner"] : OWNER_ROLES;
}

function normalizeApproval(input, entry, index) {
  const value = exact(
    input,
    [
      "action",
      "actorDigest",
      "admissionBundleDigest",
      "approvalDigest",
      "approvedAt",
      "entrySequence",
      "incidentDigest",
      "reasonDigest",
      "releaseDigest",
      "role",
      "schemaVersion",
    ],
    `revocation approval ${index + 1}`,
  );
  if (
    value.schemaVersion !== INTERNAL_TOKEN_PRODUCTION_LAUNCH_REVOCATION_SCHEMA_VERSION ||
    value.action !== entry.action ||
    value.entrySequence !== entry.sequence ||
    value.releaseDigest !== entry.releaseDigest ||
    value.admissionBundleDigest !== entry.admissionBundleDigest ||
    value.reasonDigest !== entry.reasonDigest ||
    value.incidentDigest !== entry.incidentDigest
  ) {
    fail(`revocation approval ${index + 1} binding is invalid`);
  }
  if (typeof value.role !== "string" || !OWNER_ROLE_SET.has(value.role)) {
    fail(`revocation approval ${index + 1} role is invalid`);
  }
  const approvedAt = integer(
    value.approvedAt,
    `revocation approval ${index + 1} approved-at`,
    1,
  );
  if (approvedAt < entry.proposedAt || approvedAt > entry.effectiveAt) {
    fail(`revocation approval ${index + 1} timestamp is outside the entry window`);
  }
  const body = {
    action: entry.action,
    actorDigest: digest(
      value.actorDigest,
      `revocation approval ${index + 1} actor digest`,
    ),
    admissionBundleDigest: entry.admissionBundleDigest,
    approvedAt,
    entrySequence: entry.sequence,
    incidentDigest: entry.incidentDigest,
    reasonDigest: entry.reasonDigest,
    releaseDigest: entry.releaseDigest,
    role: value.role,
    schemaVersion: INTERNAL_TOKEN_PRODUCTION_LAUNCH_REVOCATION_SCHEMA_VERSION,
  };
  const approvalDigest = digest(
    value.approvalDigest,
    `revocation approval ${index + 1} digest`,
  );
  if (hash(body) !== approvalDigest) {
    fail(`revocation approval ${index + 1} digest does not match`);
  }
  assertDistinct(
    [
      body.actorDigest,
      body.admissionBundleDigest,
      body.reasonDigest,
      body.releaseDigest,
      approvalDigest,
      ...(body.incidentDigest === null ? [] : [body.incidentDigest]),
    ],
    `revocation approval ${index + 1} digests`,
  );
  return Object.freeze({ ...body, approvalDigest });
}

function normalizeEntry(input, context, index) {
  const value = exact(
    input,
    [
      "action",
      "admissionBundleDigest",
      "approvals",
      "effectiveAt",
      "entryDigest",
      "incidentDigest",
      "previousEntryDigest",
      "proposedAt",
      "reasonDigest",
      "releaseDigest",
      "schemaVersion",
      "sequence",
    ],
    `revocation entry ${index + 1}`,
  );
  if (value.schemaVersion !== INTERNAL_TOKEN_PRODUCTION_LAUNCH_REVOCATION_SCHEMA_VERSION) {
    fail(`revocation entry ${index + 1} schema version is invalid`);
  }
  const sequence = integer(value.sequence, `revocation entry ${index + 1} sequence`, 1);
  if (sequence !== index + 1) {
    fail("revocation entry sequence is not contiguous");
  }
  const action = normalizeAction(value.action, `revocation entry ${index + 1} action`);
  const proposedAt = integer(
    value.proposedAt,
    `revocation entry ${index + 1} proposed-at`,
    1,
  );
  const effectiveAt = integer(
    value.effectiveAt,
    `revocation entry ${index + 1} effective-at`,
    1,
  );
  if (
    effectiveAt < proposedAt ||
    effectiveAt - proposedAt > MAX_ENTRY_APPROVAL_WINDOW_SECONDS ||
    effectiveAt > context.generatedAt
  ) {
    fail(`revocation entry ${index + 1} time window is invalid`);
  }
  const releaseDigest = digest(
    value.releaseDigest,
    `revocation entry ${index + 1} release digest`,
  );
  const admissionBundleDigest = digest(
    value.admissionBundleDigest,
    `revocation entry ${index + 1} admission bundle digest`,
  );
  if (
    releaseDigest !== context.releaseDigest ||
    admissionBundleDigest !== context.admissionBundleDigest
  ) {
    fail(`revocation entry ${index + 1} launch binding is invalid`);
  }
  const reasonDigest = digest(
    value.reasonDigest,
    `revocation entry ${index + 1} reason digest`,
  );
  const incidentDigest = optionalDigest(
    value.incidentDigest,
    `revocation entry ${index + 1} incident digest`,
  );
  if (
    (action === "emergency_stop" && incidentDigest === null) ||
    (action !== "emergency_stop" && incidentDigest !== null)
  ) {
    fail(`revocation entry ${index + 1} incident binding is invalid`);
  }
  const expectedPreviousDigest =
    index === 0 ? context.genesisDigest : context.entries[index - 1].entryDigest;
  const previousEntryDigest = digest(
    value.previousEntryDigest,
    `revocation entry ${index + 1} previous digest`,
  );
  if (previousEntryDigest !== expectedPreviousDigest) {
    fail("revocation journal chain is not contiguous");
  }
  const entry = {
    action,
    admissionBundleDigest,
    effectiveAt,
    incidentDigest,
    previousEntryDigest,
    proposedAt,
    reasonDigest,
    releaseDigest,
    schemaVersion: INTERNAL_TOKEN_PRODUCTION_LAUNCH_REVOCATION_SCHEMA_VERSION,
    sequence,
  };
  const roles = requiredRoles(action);
  if (!Array.isArray(value.approvals) || value.approvals.length !== roles.length) {
    fail(`revocation entry ${index + 1} approval count is invalid`);
  }
  const approvals = value.approvals
    .map((approval, approvalIndex) => normalizeApproval(approval, entry, approvalIndex))
    .sort((left, right) => left.role.localeCompare(right.role));
  if (
    approvals.some((approval, approvalIndex) => approval.role !== roles[approvalIndex]) ||
    new Set(approvals.map((approval) => approval.role)).size !== roles.length
  ) {
    fail(`revocation entry ${index + 1} approval roles are invalid`);
  }
  if (new Set(approvals.map((approval) => approval.actorDigest)).size !== approvals.length) {
    fail(`revocation entry ${index + 1} approval actors must be distinct`);
  }
  if (
    new Set(approvals.map((approval) => approval.approvalDigest)).size !==
    approvals.length
  ) {
    fail(`revocation entry ${index + 1} approval digests must be distinct`);
  }
  const body = {
    ...entry,
    approvalDigests: approvals.map((approval) => approval.approvalDigest),
  };
  const entryDigest = digest(
    value.entryDigest,
    `revocation entry ${index + 1} digest`,
  );
  if (hash(body) !== entryDigest) {
    fail(`revocation entry ${index + 1} digest does not match`);
  }
  assertDistinct(
    [
      entryDigest,
      previousEntryDigest,
      reasonDigest,
      releaseDigest,
      admissionBundleDigest,
      ...approvals.map((approval) => approval.actorDigest),
      ...approvals.map((approval) => approval.approvalDigest),
      ...(incidentDigest === null ? [] : [incidentDigest]),
    ],
    `revocation entry ${index + 1} digests`,
  );
  return Object.freeze({ ...body, approvals, entryDigest });
}

function transition(state, action, index) {
  if (state === "revoked") {
    fail(`revocation entry ${index + 1} follows a terminal revocation`);
  }
  if (action === "suspend" || action === "emergency_stop") {
    if (state !== "clear") {
      fail(`revocation entry ${index + 1} cannot suspend a non-clear launch`);
    }
    return "suspended";
  }
  if (action === "reinstate") {
    if (state !== "suspended") {
      fail(`revocation entry ${index + 1} cannot reinstate a non-suspended launch`);
    }
    return "clear";
  }
  if (action === "revoke") return "revoked";
  fail(`revocation entry ${index + 1} transition is invalid`);
}

export function createInternalTokenProductionLaunchRevocationApprovalDigest(input) {
  return hash(
    exact(
      input,
      [
        "action",
        "actorDigest",
        "admissionBundleDigest",
        "approvedAt",
        "entrySequence",
        "incidentDigest",
        "reasonDigest",
        "releaseDigest",
        "role",
        "schemaVersion",
      ],
      "revocation approval body",
    ),
  );
}

export function createInternalTokenProductionLaunchRevocationEntryDigest(input) {
  return hash(
    exact(
      input,
      [
        "action",
        "admissionBundleDigest",
        "approvalDigests",
        "effectiveAt",
        "incidentDigest",
        "previousEntryDigest",
        "proposedAt",
        "reasonDigest",
        "releaseDigest",
        "schemaVersion",
        "sequence",
      ],
      "revocation entry body",
    ),
  );
}

export function createInternalTokenProductionLaunchRevocationSnapshotDigest(input) {
  return hash(
    exact(
      input,
      [
        "admissionBundleDigest",
        "entries",
        "environment",
        "expiresAt",
        "generatedAt",
        "genesisDigest",
        "headDigest",
        "releaseDigest",
        "schemaVersion",
      ],
      "revocation snapshot body",
    ),
  );
}

export function evaluateInternalTokenProductionLaunchRevocation(
  input,
  expectedInput,
  nowInput,
) {
  const now = integer(nowInput, "revocation clock", 1);
  const expected = exact(
    expectedInput,
    ["admissionBundleDigest", "releaseDigest"],
    "expected launch binding",
  );
  const expectedReleaseDigest = digest(expected.releaseDigest, "expected release digest");
  const expectedAdmissionBundleDigest = digest(
    expected.admissionBundleDigest,
    "expected admission bundle digest",
  );
  const value = exact(
    input,
    [
      "admissionBundleDigest",
      "entries",
      "environment",
      "expiresAt",
      "generatedAt",
      "genesisDigest",
      "headDigest",
      "releaseDigest",
      "schemaVersion",
      "snapshotDigest",
    ],
    "revocation snapshot",
  );
  if (
    value.schemaVersion !== INTERNAL_TOKEN_PRODUCTION_LAUNCH_REVOCATION_SCHEMA_VERSION ||
    value.environment !== "production"
  ) {
    fail("revocation snapshot environment or schema version is invalid");
  }
  const generatedAt = integer(value.generatedAt, "revocation snapshot generated-at", 1);
  const expiresAt = integer(value.expiresAt, "revocation snapshot expiry", 1);
  if (
    expiresAt <= generatedAt ||
    expiresAt - generatedAt > MAX_SNAPSHOT_LIFETIME_SECONDS ||
    generatedAt > now + 30 ||
    now > expiresAt
  ) {
    fail("revocation snapshot is stale or not yet valid");
  }
  const releaseDigest = digest(value.releaseDigest, "revocation release digest");
  const admissionBundleDigest = digest(
    value.admissionBundleDigest,
    "revocation admission bundle digest",
  );
  if (
    releaseDigest !== expectedReleaseDigest ||
    admissionBundleDigest !== expectedAdmissionBundleDigest
  ) {
    fail("revocation snapshot is not bound to the admitted launch");
  }
  const genesisDigest = digest(value.genesisDigest, "revocation genesis digest");
  assertDistinct(
    [genesisDigest, releaseDigest, admissionBundleDigest],
    "revocation root digests",
  );
  if (!Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) {
    fail("revocation entries are invalid or exceed the maximum");
  }
  const context = {
    admissionBundleDigest,
    entries: [],
    generatedAt,
    genesisDigest,
    releaseDigest,
  };
  let state = "clear";
  let approvalCount = 0;
  let emergencyStopCount = 0;
  for (const [index, rawEntry] of value.entries.entries()) {
    const entry = normalizeEntry(rawEntry, context, index);
    context.entries.push(entry);
    state = transition(state, entry.action, index);
    approvalCount += entry.approvals.length;
    if (entry.action === "emergency_stop") emergencyStopCount += 1;
  }
  const headDigest = digest(value.headDigest, "revocation head digest");
  const expectedHeadDigest =
    context.entries.length === 0
      ? genesisDigest
      : context.entries[context.entries.length - 1].entryDigest;
  if (headDigest !== expectedHeadDigest) {
    fail("revocation snapshot head does not match the journal chain");
  }
  const normalizedEntries = context.entries.map((entry) => ({
    action: entry.action,
    admissionBundleDigest: entry.admissionBundleDigest,
    approvals: entry.approvals,
    effectiveAt: entry.effectiveAt,
    entryDigest: entry.entryDigest,
    incidentDigest: entry.incidentDigest,
    previousEntryDigest: entry.previousEntryDigest,
    proposedAt: entry.proposedAt,
    reasonDigest: entry.reasonDigest,
    releaseDigest: entry.releaseDigest,
    schemaVersion: entry.schemaVersion,
    sequence: entry.sequence,
  }));
  const body = {
    admissionBundleDigest,
    entries: normalizedEntries,
    environment: "production",
    expiresAt,
    generatedAt,
    genesisDigest,
    headDigest,
    releaseDigest,
    schemaVersion: INTERNAL_TOKEN_PRODUCTION_LAUNCH_REVOCATION_SCHEMA_VERSION,
  };
  const snapshotDigest = digest(value.snapshotDigest, "revocation snapshot digest");
  if (hash(body) !== snapshotDigest) {
    fail("revocation snapshot digest does not match");
  }
  assertDistinct(
    [
      snapshotDigest,
      genesisDigest,
      headDigest,
      releaseDigest,
      admissionBundleDigest,
      ...context.entries.map((entry) => entry.entryDigest),
    ],
    "revocation snapshot digests",
  );
  const latestAction =
    context.entries.length === 0
      ? "none"
      : context.entries[context.entries.length - 1].action;
  return Object.freeze({
    approvalCount,
    emergencyStopCount,
    entryCount: context.entries.length,
    environment: "production",
    evidenceDigestsIncluded: false,
    expiresAt,
    identifiersIncluded: false,
    latestAction,
    launchGate: state === "clear" ? "clear" : "blocked",
    revocationState: state,
    schemaVersion: INTERNAL_TOKEN_PRODUCTION_LAUNCH_REVOCATION_SCHEMA_VERSION,
    status: state,
  });
}
