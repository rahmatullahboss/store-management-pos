import assert from "node:assert/strict";
import test from "node:test";
import {
  appendInternalTokenKeyChangeJournalEvent,
  summarizeInternalTokenKeyChangeJournal,
} from "../../tooling/scripts/internal-token-key-change-journal.mjs";

const changeDigest = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const requestedDigest = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const deniedDigest = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

function event(sequence, stage, eventDigest, previousEventDigest, evidenceDigest) {
  return {
    changeDigest,
    changeType: "urgent_replacement",
    eventDigest,
    evidenceDigest,
    occurredAt: 1_800_100_000 + sequence,
    previousEventDigest,
    sequence,
    stage,
  };
}

test("a denied lifecycle change becomes terminal", () => {
  let history = appendInternalTokenKeyChangeJournalEvent(
    [],
    event(1, "requested", requestedDigest, null, "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"),
  );
  history = appendInternalTokenKeyChangeJournalEvent(
    history,
    event(2, "denied", deniedDigest, requestedDigest, "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"),
  );
  const summary = summarizeInternalTokenKeyChangeJournal(history);
  assert.equal(summary.finalStage, "denied");
  assert.equal(summary.terminal, true);
  assert.throws(
    () => appendInternalTokenKeyChangeJournalEvent(
      history,
      event(3, "applied", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", deniedDigest, "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG"),
    ),
    /already terminal/u,
  );
});

test("a failed approved change is terminal without becoming applied", () => {
  let history = appendInternalTokenKeyChangeJournalEvent(
    [],
    event(1, "requested", requestedDigest, null, "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD"),
  );
  history = appendInternalTokenKeyChangeJournalEvent(
    history,
    event(2, "approved", deniedDigest, requestedDigest, "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE"),
  );
  history = appendInternalTokenKeyChangeJournalEvent(
    history,
    event(3, "failed", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", deniedDigest, "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG"),
  );
  const summary = summarizeInternalTokenKeyChangeJournal(history);
  assert.equal(summary.finalStage, "failed");
  assert.equal(summary.terminal, true);
});
