const DIGEST = /^[A-Za-z0-9_-]{43}$/u;
const MAX_EVENTS = 3;

export const INTERNAL_TOKEN_KEY_CHANGE_JOURNAL_SCHEMA_VERSION = 1;

const CHANGE_TYPES = new Set([
  "scheduled_rotation",
  "urgent_replacement",
  "previous_retirement",
]);
const STAGES = new Set(["requested", "approved", "applied", "denied", "failed"]);
const TERMINAL_STAGES = new Set(["applied", "denied", "failed"]);
const TRANSITIONS = Object.freeze({
  requested: new Set(["approved", "denied"]),
  approved: new Set(["applied", "failed"]),
});

function fail(message) {
  throw new Error(`Internal-token key change journal: ${message}`);
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

function optionalDigest(value, name) {
  if (value === null) return null;
  return digest(value, name);
}

function changeType(value) {
  if (typeof value !== "string" || !CHANGE_TYPES.has(value)) {
    fail("change type is invalid");
  }
  return value;
}

function stage(value) {
  if (typeof value !== "string" || !STAGES.has(value)) {
    fail("stage is invalid");
  }
  return value;
}

export function normalizeInternalTokenKeyChangeJournalEvent(input) {
  const value = object(input, "event");
  exactKeys(
    value,
    [
      "changeDigest",
      "changeType",
      "eventDigest",
      "evidenceDigest",
      "occurredAt",
      "previousEventDigest",
      "sequence",
      "stage",
    ],
    "event",
  );
  const sequence = positiveInteger(value.sequence, "sequence");
  const eventDigest = digest(value.eventDigest, "event digest");
  const evidenceDigest = digest(value.evidenceDigest, "evidence digest");
  const changeDigest = digest(value.changeDigest, "change digest");
  const previousEventDigest = optionalDigest(
    value.previousEventDigest,
    "previous event digest",
  );
  if (sequence === 1 && previousEventDigest !== null) {
    fail("first event cannot reference a previous event");
  }
  if (sequence > 1 && previousEventDigest === null) {
    fail("later events require a previous event digest");
  }
  if (
    eventDigest === evidenceDigest ||
    eventDigest === changeDigest ||
    previousEventDigest === eventDigest
  ) {
    fail("event digests must have distinct purposes");
  }
  return Object.freeze({
    schemaVersion: INTERNAL_TOKEN_KEY_CHANGE_JOURNAL_SCHEMA_VERSION,
    changeDigest,
    changeType: changeType(value.changeType),
    eventDigest,
    evidenceDigest,
    occurredAt: positiveInteger(value.occurredAt, "timestamp"),
    previousEventDigest,
    sequence,
    stage: stage(value.stage),
  });
}

function validateHistory(historyInput) {
  if (!Array.isArray(historyInput) || historyInput.length === 0) {
    fail("history is empty");
  }
  if (historyInput.length > MAX_EVENTS) fail("history is too long");
  const history = historyInput.map((event) =>
    normalizeInternalTokenKeyChangeJournalEvent(event),
  );
  const first = history[0];
  if (first.sequence !== 1 || first.stage !== "requested") {
    fail("history must begin with requested sequence 1");
  }
  const eventDigests = new Set();
  for (const [index, current] of history.entries()) {
    if (current.sequence !== index + 1) fail("history sequence is not contiguous");
    if (eventDigests.has(current.eventDigest)) fail("event digest is duplicated");
    eventDigests.add(current.eventDigest);
    if (
      current.changeDigest !== first.changeDigest ||
      current.changeType !== first.changeType
    ) {
      fail("history change identity is inconsistent");
    }
    if (index === 0) continue;
    const previous = history[index - 1];
    if (current.previousEventDigest !== previous.eventDigest) {
      fail("event linkage is invalid");
    }
    if (current.occurredAt < previous.occurredAt) {
      fail("event timestamp moved backwards");
    }
    if (!TRANSITIONS[previous.stage]?.has(current.stage)) {
      fail("stage transition is invalid");
    }
  }
  return Object.freeze(history);
}

export function appendInternalTokenKeyChangeJournalEvent(historyInput, eventInput) {
  if (!Array.isArray(historyInput)) fail("history is invalid");
  const event = normalizeInternalTokenKeyChangeJournalEvent(eventInput);
  if (historyInput.length === 0) {
    if (event.sequence !== 1 || event.stage !== "requested") {
      fail("history must begin with requested sequence 1");
    }
    return Object.freeze([event]);
  }
  const history = validateHistory(historyInput);
  const previous = history.at(-1);
  if (TERMINAL_STAGES.has(previous.stage)) fail("history is already terminal");
  return validateHistory([...history, event]);
}

export function summarizeInternalTokenKeyChangeJournal(historyInput) {
  const history = validateHistory(historyInput);
  const finalStage = history.at(-1).stage;
  return Object.freeze({
    schemaVersion: INTERNAL_TOKEN_KEY_CHANGE_JOURNAL_SCHEMA_VERSION,
    changeType: history[0].changeType,
    eventCount: history.length,
    finalStage,
    terminal: TERMINAL_STAGES.has(finalStage),
    chainValid: true,
    identifiersIncluded: false,
    payloadIncluded: false,
    evidenceValuesIncluded: false,
  });
}
