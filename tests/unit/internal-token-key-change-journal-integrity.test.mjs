import assert from "node:assert/strict";
import test from "node:test";
import {
  appendInternalTokenKeyChangeJournalEvent,
  summarizeInternalTokenKeyChangeJournal,
} from "../../tooling/scripts/internal-token-key-change-journal.mjs";

const A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const C = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const D = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
const E = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";

function event(overrides = {}) {
  return {
    changeDigest: A,
    changeType: "previous_retirement",
    eventDigest: B,
    evidenceDigest: C,
    occurredAt: 1_800_200_001,
    previousEventDigest: null,
    sequence: 1,
    stage: "requested",
    ...overrides,
  };
}

test("journal linkage and sequence tampering fail closed", () => {
  const first = appendInternalTokenKeyChangeJournalEvent([], event());
  assert.throws(
    () => appendInternalTokenKeyChangeJournalEvent(
      first,
      event({
        eventDigest: D,
        evidenceDigest: E,
        previousEventDigest: C,
        sequence: 2,
        stage: "approved",
        occurredAt: 1_800_200_002,
      }),
    ),
    /event linkage is invalid/u,
  );
  assert.throws(
    () => appendInternalTokenKeyChangeJournalEvent(
      first,
      event({
        eventDigest: D,
        evidenceDigest: E,
        previousEventDigest: B,
        sequence: 3,
        stage: "approved",
        occurredAt: 1_800_200_002,
      }),
    ),
    /sequence is not contiguous/u,
  );
});

test("journal time, identity and transition tampering fail closed", () => {
  const first = appendInternalTokenKeyChangeJournalEvent([], event());
  assert.throws(
    () => appendInternalTokenKeyChangeJournalEvent(
      first,
      event({
        eventDigest: D,
        evidenceDigest: E,
        previousEventDigest: B,
        sequence: 2,
        stage: "applied",
        occurredAt: 1_800_200_002,
      }),
    ),
    /stage transition is invalid/u,
  );
  assert.throws(
    () => appendInternalTokenKeyChangeJournalEvent(
      first,
      event({
        changeDigest: E,
        eventDigest: D,
        evidenceDigest: A,
        previousEventDigest: B,
        sequence: 2,
        stage: "approved",
        occurredAt: 1_800_200_002,
      }),
    ),
    /change identity is inconsistent/u,
  );
  assert.throws(
    () => summarizeInternalTokenKeyChangeJournal([
      event(),
      event({
        eventDigest: D,
        evidenceDigest: E,
        previousEventDigest: B,
        sequence: 2,
        stage: "approved",
        occurredAt: 1_800_200_000,
      }),
    ]),
    /timestamp moved backwards/u,
  );
});

test("event digests cannot be reused for another purpose", () => {
  assert.throws(
    () => appendInternalTokenKeyChangeJournalEvent(
      [],
      event({ evidenceDigest: B }),
    ),
    /distinct purposes/u,
  );
});
