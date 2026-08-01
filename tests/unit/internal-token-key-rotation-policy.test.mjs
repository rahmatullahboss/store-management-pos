import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeInternalTokenKeyState,
  planScheduledInternalTokenKeyRotation,
  retireExpiredPreviousInternalTokenKey,
  summarizeInternalTokenKeyGovernance,
} from "../../tooling/scripts/internal-token-key-governance.mjs";

const now = 1_800_000_000;

function key(kid, overrides = {}) {
  return {
    kid,
    algorithm: "RS256",
    notBefore: now - 60,
    signUntil: now + 3_600,
    verifyUntil: now + 3_900,
    ...overrides,
  };
}

const rotation = (state, candidate, overrides = {}) => ({
  state,
  candidate,
  now,
  maximumTokenLifetimeSeconds: 300,
  clockSkewSeconds: 60,
  overlapSeconds: 600,
  ...overrides,
});

test("scheduled key rotation preserves one bounded previous verification key", () => {
  const current = normalizeInternalTokenKeyState({
    active: key("active-key-0001"),
    previous: null,
    revokedKids: [],
  });
  const next = planScheduledInternalTokenKeyRotation(
    rotation(current, key("active-key-0002")),
  );
  assert.equal(next.active.kid, "active-key-0002");
  assert.equal(next.previous?.kid, "active-key-0001");
  assert.deepEqual(summarizeInternalTokenKeyGovernance(next, now), {
    schemaVersion: 1,
    algorithm: "RS256",
    activeSigningKeyCount: 1,
    activeVerificationKeyCount: 1,
    previousVerificationKeyCount: 1,
    publishedKeyCount: 2,
    revokedKeyCount: 0,
    privateKeyMaterialIncluded: false,
    keyIdentifiersIncluded: false,
  });
});

test("scheduled rotation fails closed for overlapping or undersized windows", () => {
  const withPrevious = normalizeInternalTokenKeyState({
    active: key("active-key-0001"),
    previous: key("previous-key-01", {
      notBefore: now - 7_200,
      signUntil: now - 3_600,
      verifyUntil: now + 600,
    }),
    revokedKids: [],
  });
  assert.throws(
    () => planScheduledInternalTokenKeyRotation(
      rotation(withPrevious, key("active-key-0002")),
    ),
    /unexpired previous key/u,
  );
  assert.throws(
    () => planScheduledInternalTokenKeyRotation(
      rotation(
        { active: key("active-key-0001"), previous: null, revokedKids: [] },
        key("active-key-0002"),
        { overlapSeconds: 359 },
      ),
    ),
    /shorter than token lifetime plus clock skew/u,
  );
});

test("expired previous verification keys retire deterministically", () => {
  const current = normalizeInternalTokenKeyState({
    active: key("active-key-0001"),
    previous: key("previous-key-01", {
      notBefore: now - 7_200,
      signUntil: now - 3_600,
      verifyUntil: now - 1,
    }),
    revokedKids: ["retired-key-001"],
  });
  const retired = retireExpiredPreviousInternalTokenKey(current, now);
  assert.equal(retired.previous, null);
  assert.equal(retired.active.kid, "active-key-0001");
  assert.deepEqual(retired.revokedKids, ["retired-key-001"]);
});
