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
const proposerDigest = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const securityDigest = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const platformDigest = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

function event(sequence, stage, eventDigest, previousEventDigest, evidenceDigest) {
  return {
    changeDigest,
    changeType: "scheduled_rotation",
    eventDigest,
    evidenceDigest,
    occurredAt: 1_800_000_000 + sequence,
    previousEventDigest,
    sequence,
    stage,
  };
}

function governanceClient(calls) {
  return {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ recorded: true }] };
    },
  };
}

test("durable journal command records a validated lifecycle without exposing identifiers", async () => {
  const calls = [];
  const client = governanceClient(calls);
  const requested = event(
    1,
    "requested",
    "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
    null,
    "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
  );
  const requestedResult = await recordInternalTokenKeyChangeJournalEvent(client, {
    history: [],
    event: requested,
    approval: undefined,
  });
  const requestedHistory = appendInternalTokenKeyChangeJournalEvent([], requested);

  const approved = event(
    2,
    "approved",
    "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    requested.eventDigest,
    "HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
  );
  const approvedResult = await recordInternalTokenKeyChangeJournalEvent(client, {
    history: requestedHistory,
    event: approved,
    approval: {
      request: {
        changeReference: "CHANGE-0001",
        changeType: "scheduled_rotation",
        requestedAt: 1_800_000_000,
        expiresAt: 1_800_001_800,
        proposerDigest,
      },
      approvals: [
        { actorDigest: securityDigest, role: "security_owner", approvedAt: 1_800_000_010 },
        { actorDigest: platformDigest, role: "platform_owner", approvedAt: 1_800_000_020 },
      ],
      now: 1_800_000_030,
    },
  });
  const approvedHistory = appendInternalTokenKeyChangeJournalEvent(requestedHistory, approved);

  const applied = event(
    3,
    "applied",
    "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII",
    approved.eventDigest,
    "JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ",
  );
  const appliedResult = await recordInternalTokenKeyChangeJournalEvent(client, {
    history: approvedHistory,
    event: applied,
    approval: undefined,
  });

  assert.deepEqual(requestedResult, {
    schemaVersion: 1,
    changeType: "scheduled_rotation",
    eventCount: 1,
    finalStage: "requested",
    terminal: false,
    chainValid: true,
    identifiersIncluded: false,
    payloadIncluded: false,
    evidenceValuesIncluded: false,
    recorded: true,
  });
  assert.equal(approvedResult.finalStage, "approved");
  assert.equal(approvedResult.eventCount, 2);
  assert.equal(appliedResult.finalStage, "applied");
  assert.equal(appliedResult.terminal, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.sql === INTERNAL_TOKEN_KEY_CHANGE_APPEND_SQL));
  assert.deepEqual(calls[2].params, [
    changeDigest,
    "scheduled_rotation",
    3,
    "applied",
    applied.eventDigest,
    applied.evidenceDigest,
    approved.eventDigest,
    "2027-01-15T08:00:03.000Z",
  ]);
  assert.doesNotMatch(JSON.stringify(appliedResult), /AAAA|EEEE|IIII|CHANGE-0001/u);
});
