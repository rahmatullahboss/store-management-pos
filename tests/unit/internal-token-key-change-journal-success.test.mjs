import assert from "node:assert/strict";
import test from "node:test";
import {
  appendInternalTokenKeyChangeJournalEvent,
  summarizeInternalTokenKeyChangeJournal,
} from "../../tooling/scripts/internal-token-key-change-journal.mjs";

const changeDigest = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const requestedDigest = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const approvedDigest = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const appliedDigest = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

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

test("approved lifecycle changes form a contiguous applied journal", () => {
  let history = appendInternalTokenKeyChangeJournalEvent(
    [],
    event(1, "requested", requestedDigest, null, "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"),
  );
  history = appendInternalTokenKeyChangeJournalEvent(
    history,
    event(2, "approved", approvedDigest, requestedDigest, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"),
  );
  history = appendInternalTokenKeyChangeJournalEvent(
    history,
    event(3, "applied", appliedDigest, approvedDigest, "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG"),
  );
  assert.deepEqual(summarizeInternalTokenKeyChangeJournal(history), {
    schemaVersion: 1,
    changeType: "scheduled_rotation",
    eventCount: 3,
    finalStage: "applied",
    terminal: true,
    chainValid: true,
    identifiersIncluded: false,
    payloadIncluded: false,
    evidenceValuesIncluded: false,
  });
});
