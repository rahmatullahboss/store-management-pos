import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERNAL_TOKEN_KEY_CHANGE_APPEND_SQL,
  recordInternalTokenKeyChangeJournalEvent,
} from "../../tooling/scripts/internal-token-key-change-command.mjs";
import {
  appendInternalTokenKeyChangeJournalEvent,
} from "../../tooling/scripts/internal-token-key-change-journal.mjs";

const changeDigest = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const requested = {
  changeDigest,
  changeType: "scheduled_rotation",
  eventDigest: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  evidenceDigest: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  occurredAt: 1_800_000_001,
  previousEventDigest: null,
  sequence: 1,
  stage: "requested",
};
const approved = {
  changeDigest,
  changeType: "scheduled_rotation",
  eventDigest: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
  evidenceDigest: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
  occurredAt: 1_800_000_002,
  previousEventDigest: requested.eventDigest,
  sequence: 2,
  stage: "approved",
};

function approval(changeType = "scheduled_rotation") {
  return {
    request: {
      changeReference: "CHANGE-0002",
      changeType,
      requestedAt: 1_800_000_000,
      expiresAt: 1_800_001_800,
      proposerDigest: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    },
    approvals: [
      {
        actorDigest: "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
        role: "security_owner",
        approvedAt: 1_800_000_010,
      },
      {
        actorDigest: "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
        role: "platform_owner",
        approvedAt: 1_800_000_020,
      },
    ],
    now: 1_800_000_030,
  };
}

test("approval and transition validation finish before the database command", async () => {
  let queries = 0;
  const client = { query: async () => { queries += 1; return { rows: [{ recorded: true }] }; } };
  const history = appendInternalTokenKeyChangeJournalEvent([], requested);

  await assert.rejects(
    recordInternalTokenKeyChangeJournalEvent(client, {
      history,
      event: approved,
      approval: approval("urgent_replacement"),
    }),
    /approval change type does not match/u,
  );
  await assert.rejects(
    recordInternalTokenKeyChangeJournalEvent(client, {
      history: [],
      event: requested,
      approval: approval(),
    }),
    /approval evidence is allowed only for approved events/u,
  );
  await assert.rejects(
    recordInternalTokenKeyChangeJournalEvent(client, {
      history,
      event: { ...approved, previousEventDigest: null },
      approval: approval(),
    }),
    /later events require a previous event digest/u,
  );
  assert.equal(queries, 0);
});

test("database acknowledgement is boolean and the command SQL cannot write the table directly", async () => {
  assert.match(INTERNAL_TOKEN_KEY_CHANGE_APPEND_SQL, /^SELECT\s+/u);
  assert.match(INTERNAL_TOKEN_KEY_CHANGE_APPEND_SQL, /append_internal_token_key_change_journal_event/u);
  assert.doesNotMatch(
    INTERNAL_TOKEN_KEY_CHANGE_APPEND_SQL,
    /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?platform\.internal_token_key_change_journal/iu,
  );
  const history = appendInternalTokenKeyChangeJournalEvent([], requested);
  let queries = 0;
  await assert.rejects(
    recordInternalTokenKeyChangeJournalEvent(
      { query: async () => { queries += 1; return { rows: [{ recorded: false }] }; } },
      { history, event: approved, approval: approval() },
    ),
    /database acknowledgement is invalid/u,
  );
  assert.equal(queries, 1);
});
