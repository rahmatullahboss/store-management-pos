import {
  evaluateInternalTokenKeyChangeApprovals,
} from "./internal-token-key-change-approval.mjs";
import {
  appendInternalTokenKeyChangeJournalEvent,
  normalizeInternalTokenKeyChangeJournalEvent,
  summarizeInternalTokenKeyChangeJournal,
} from "./internal-token-key-change-journal.mjs";

export const INTERNAL_TOKEN_KEY_CHANGE_APPEND_SQL = `SELECT
  platform.append_internal_token_key_change_journal_event(
    $1::text,
    $2::text,
    $3::smallint,
    $4::text,
    $5::text,
    $6::text,
    $7::text,
    $8::timestamptz
  ) IS NOT NULL AS recorded`;

function fail(message) {
  throw new Error(`Internal-token key change command: ${message}`);
}

function queryClient(value) {
  if (!value || typeof value.query !== "function") {
    fail("a query-capable governance client is required");
  }
  return value;
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

function approvalForStage(stage, approvalInput, changeType) {
  if (stage !== "approved") {
    if (approvalInput !== undefined) fail("approval evidence is allowed only for approved events");
    return null;
  }
  const approval = exactKeys(
    approvalInput,
    ["approvals", "now", "request"],
    "approval evidence",
  );
  const result = evaluateInternalTokenKeyChangeApprovals(
    approval.request,
    approval.approvals,
    approval.now,
  );
  if (result.changeType !== changeType) {
    fail("approval change type does not match the journal event");
  }
  return result;
}

function occurredAt(value) {
  const date = new Date(value * 1_000);
  if (!Number.isFinite(date.getTime())) fail("event timestamp is invalid");
  return date.toISOString();
}

export async function recordInternalTokenKeyChangeJournalEvent(
  clientInput,
  commandInput,
) {
  const command = exactKeys(
    commandInput,
    ["event", "history", "approval"],
    "command",
  );
  if (!Array.isArray(command.history)) fail("history is invalid");
  const event = normalizeInternalTokenKeyChangeJournalEvent(command.event);
  approvalForStage(event.stage, command.approval, event.changeType);
  const nextHistory = appendInternalTokenKeyChangeJournalEvent(command.history, event);
  const client = queryClient(clientInput);
  const result = await client.query(INTERNAL_TOKEN_KEY_CHANGE_APPEND_SQL, [
    event.changeDigest,
    event.changeType,
    event.sequence,
    event.stage,
    event.eventDigest,
    event.evidenceDigest,
    event.previousEventDigest,
    occurredAt(event.occurredAt),
  ]);
  if (result?.rows?.[0]?.recorded !== true) {
    fail("database acknowledgement is invalid");
  }
  const summary = summarizeInternalTokenKeyChangeJournal(nextHistory);
  return Object.freeze({
    ...summary,
    recorded: true,
  });
}
