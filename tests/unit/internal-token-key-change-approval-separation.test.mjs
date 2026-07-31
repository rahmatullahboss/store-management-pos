import assert from "node:assert/strict";
import test from "node:test";
import { evaluateInternalTokenKeyChangeApprovals } from "../../tooling/scripts/internal-token-key-change-approval.mjs";

const now = 1_800_000_000;
const proposer = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const request = {
  changeReference: "SEC-CHANGE-1002",
  changeType: "urgent_replacement",
  requestedAt: now - 60,
  expiresAt: now + 600,
  proposerDigest: proposer,
};

function review(actorDigest, role, approvedAt = now - 20) {
  return { actorDigest, role, approvedAt };
}

test("the requester and reviewers must be separate", () => {
  assert.throws(
    () => evaluateInternalTokenKeyChangeApprovals(
      request,
      [
        review(proposer, "security_owner"),
        review("CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", "platform_owner"),
      ],
      now,
    ),
    /proposer cannot approve/u,
  );
  assert.throws(
    () => evaluateInternalTokenKeyChangeApprovals(
      request,
      [
        review("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "security_owner"),
        review("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "platform_owner"),
      ],
      now,
    ),
    /actors must be distinct/u,
  );
});

test("both required review roles must be represented", () => {
  assert.throws(
    () => evaluateInternalTokenKeyChangeApprovals(
      request,
      [
        review("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "security_owner"),
        review("CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", "security_owner"),
      ],
      now,
    ),
    /roles are incomplete/u,
  );
});
