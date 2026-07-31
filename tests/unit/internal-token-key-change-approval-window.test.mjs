import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateInternalTokenKeyChangeApprovals,
  normalizeInternalTokenKeyChangeRequest,
} from "../../tooling/scripts/internal-token-key-change-approval.mjs";

const now = 1_800_000_000;
const base = {
  changeReference: "SEC-CHANGE-1003",
  changeType: "previous_retirement",
  requestedAt: now - 60,
  expiresAt: now + 600,
  proposerDigest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};
const approvals = [
  {
    actorDigest: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    role: "security_owner",
    approvedAt: now - 30,
  },
  {
    actorDigest: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    role: "platform_owner",
    approvedAt: now - 20,
  },
];

test("approval windows are bounded and evaluated against the current clock", () => {
  assert.throws(
    () => normalizeInternalTokenKeyChangeRequest({
      ...base,
      expiresAt: now + 1_801,
    }),
    /approval window is invalid/u,
  );
  assert.throws(
    () => evaluateInternalTokenKeyChangeApprovals(
      { ...base, expiresAt: now - 1 },
      approvals,
      now,
    ),
    /outside its approval window/u,
  );
  assert.throws(
    () => evaluateInternalTokenKeyChangeApprovals(
      { ...base, requestedAt: now + 1, expiresAt: now + 600 },
      approvals,
      now,
    ),
    /outside its approval window/u,
  );
});

test("unexpected request fields and malformed reviewer digests fail closed", () => {
  assert.throws(
    () => normalizeInternalTokenKeyChangeRequest({ ...base, extra: true }),
    /fields are invalid/u,
  );
  assert.throws(
    () => evaluateInternalTokenKeyChangeApprovals(
      base,
      [{ ...approvals[0], actorDigest: "reviewer-name" }, approvals[1]],
      now,
    ),
    /actor digest is invalid/u,
  );
});
