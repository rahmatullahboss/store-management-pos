import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateInternalTokenKeyChangeApprovals,
  summarizeInternalTokenKeyChangeApproval,
} from "../../tooling/scripts/internal-token-key-change-approval.mjs";

const now = 1_800_000_000;
const request = {
  changeReference: "SEC-CHANGE-1001",
  changeType: "scheduled_rotation",
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

test("key lifecycle changes accept two distinct required reviewers", () => {
  const result = evaluateInternalTokenKeyChangeApprovals(request, approvals, now);
  assert.equal(result.approved, true);
  assert.equal(result.approvalCount, 2);
  assert.deepEqual(summarizeInternalTokenKeyChangeApproval(result), {
    schemaVersion: 1,
    changeType: "scheduled_rotation",
    approvalCount: 2,
    approved: true,
    actorIdentifiersIncluded: false,
    changeReferenceIncluded: false,
  });
});
