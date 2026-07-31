import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERNAL_TOKEN_KEY_CHANGE_APPEND_SQL,
  INTERNAL_TOKEN_KEY_CHANGE_HISTORY_SQL,
  recordInternalTokenKeyChangeJournalEvent,
} from "../../tooling/scripts/internal-token-key-change-command.mjs";

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

function requestedRow() {
  return {
    change_digest: requested.changeDigest,
    change_type: requested.changeType,
    event_digest: requested.eventDigest,
    evidence_digest: requested.evidenceDigest,
    occurred_at: String(requested.occurredAt),
    previous_event_digest: null,
    sequence: 1,
    stage: "requested",
  };
}

test("approval and event validation finish before authoritative history access", async () => {
  let queries = 0;
  const client = { query: async () => { queries += 1; return { rows: [] }; } };

  await assert.rejects(
    recordInternalTokenKeyChangeJournalEvent(client, {
      event: approved,
      approval: approval("urgent_replacement"),
    }),
    /approval change type does not match/u,
  );
  await assert.rejects(
    recordInternalTokenKeyChangeJournalEvent(client, {
      event: requested,
      approval: approval(),
    }),
    /approval evidence is allowed only for approved events/u,
  );
  await assert.rejects(
    recordInternalTokenKeyChangeJournalEvent(client, {
      event: { ...approved, previousEventDigest: null },
      approval: approval(),
    }),
    /later events require a previous event digest/u,
  );
  await assert.rejects(
    recordInternalTokenKeyChangeJournalEvent(client, {
      event: requested,
      approval: undefined,
      history: [],
    }),
    /command fields are invalid/u,
  );
  assert.equal(queries, 0);
});

test("authoritative history is bounded and malformed rows block the append", async () => {
  assert.match(INTERNAL_TOKEN_KEY_CHANGE_HISTORY_SQL, /^SELECT\s+/u);
  assert.match(INTERNAL_TOKEN_KEY_CHANGE_HISTORY_SQL, /ORDER BY sequence ASC\s+LIMIT 4$/u);
  assert.doesNotMatch(INTERNAL_TOKEN_KEY_CHANGE_HISTORY_SQL, /\bid\b|recorded_at|payload|actor/iu);
  let queries = 0;
  await assert.rejects(
    recordInternalTokenKeyChangeJournalEvent(
      {
        async query(sql) {
          queries += 1;
          assert.equal(sql, INTERNAL_TOKEN_KEY_CHANGE_HISTORY_SQL);
          return { rows: [{ ...requestedRow(), unexpected: true }] };
        },
      },
      { event: approved, approval: approval() },
    ),
    /database history row 1 fields are invalid/u,
  );
  assert.equal(queries, 1);
});

test("database acknowledgement is boolean and append SQL cannot write the table directly", async () => {
  assert.match(INTERNAL_TOKEN_KEY_CHANGE_APPEND_SQL, /^SELECT\s+/u);
  assert.match(INTERNAL_TOKEN_KEY_CHANGE_APPEND_SQL, /append_internal_token_key_change_journal_event/u);
  assert.doesNotMatch(
    INTERNAL_TOKEN_KEY_CHANGE_APPEND_SQL,
    /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?platform\.internal_token_key_change_journal/iu,
  );
  let queries = 0;
  await assert.rejects(
    recordInternalTokenKeyChangeJournalEvent(
      {
        async query(sql) {
          queries += 1;
          if (sql === INTERNAL_TOKEN_KEY_CHANGE_HISTORY_SQL) {
            return { rows: [requestedRow()] };
          }
          assert.equal(sql, INTERNAL_TOKEN_KEY_CHANGE_APPEND_SQL);
          return { rows: [{ recorded: false }] };
        },
      },
      { event: approved, approval: approval() },
    ),
    /database acknowledgement is invalid/u,
  );
  assert.equal(queries, 2);
});
