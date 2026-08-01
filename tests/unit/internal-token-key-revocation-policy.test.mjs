import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeInternalTokenKeyState,
  planEmergencyInternalTokenKeyRotation,
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

function options(state, candidate, affectedKid) {
  return {
    state,
    candidate,
    compromisedKid: affectedKid,
    now,
    maximumTokenLifetimeSeconds: 300,
    clockSkewSeconds: 60,
    overlapSeconds: 600,
  };
}

test("incident rotation excludes the affected active key from publication", () => {
  const current = normalizeInternalTokenKeyState({
    active: key("active-key-0001"),
    previous: key("previous-key-01", {
      notBefore: now - 7_200,
      signUntil: now - 3_600,
      verifyUntil: now + 600,
    }),
    revokedKids: [],
  });
  const next = planEmergencyInternalTokenKeyRotation(
    options(current, key("active-key-0002"), "active-key-0001"),
  );
  assert.deepEqual(next.revokedKids, ["active-key-0001"]);
  assert.equal(next.active.kid, "active-key-0002");
  assert.equal(next.previous?.kid, "previous-key-01");
  assert.equal(summarizeInternalTokenKeyGovernance(next, now).publishedKeyCount, 2);
});

test("incident rotation of the previous key keeps the prior active for overlap", () => {
  const current = normalizeInternalTokenKeyState({
    active: key("active-key-0001"),
    previous: key("previous-key-01", {
      notBefore: now - 7_200,
      signUntil: now - 3_600,
      verifyUntil: now + 600,
    }),
    revokedKids: [],
  });
  const next = planEmergencyInternalTokenKeyRotation(
    options(current, key("active-key-0002"), "previous-key-01"),
  );
  assert.deepEqual(next.revokedKids, ["previous-key-01"]);
  assert.equal(next.previous?.kid, "active-key-0001");
});

test("unknown or already revoked incident keys fail closed", () => {
  const current = normalizeInternalTokenKeyState({
    active: key("active-key-0001"),
    previous: null,
    revokedKids: ["retired-key-001"],
  });
  assert.throws(
    () => planEmergencyInternalTokenKeyRotation(
      options(current, key("active-key-0002"), "unknown-key-001"),
    ),
    /not active or previous/u,
  );
  assert.throws(
    () => normalizeInternalTokenKeyState({
      active: key("active-key-0001"),
      previous: null,
      revokedKids: ["active-key-0001"],
    }),
    /active key cannot be revoked/u,
  );
});
