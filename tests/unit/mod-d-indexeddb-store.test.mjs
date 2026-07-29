import assert from "node:assert/strict";
import test from "node:test";
import {
  deserializeOfflineOperation,
  serializeOfflineOperation,
} from "../../build/modules/offline/src/indexeddb-store.js";

function record(overrides = {}) {
  return Object.freeze({
    operationId: "operation-idb-1",
    deviceId: "device-idb-1",
    registerId: "register-idb-1",
    kind: "sale",
    payloadVersion: "1.0",
    requestHash: "sha256:idb-1",
    occurredAt: "2026-07-29T09:00:00.000Z",
    authorizationExpiresAt: "2026-07-30T09:00:00.000Z",
    sequence: 9_007_199_254_740_993n,
    state: "pending",
    committedAt: "2026-07-29T09:00:00.250Z",
    ...overrides,
  });
}

test("IndexedDB serialization preserves exact bigint sequence and optional evidence", () => {
  const original = record({
    state: "rejected",
    serverReference: "server-operation-1",
    rejectionReason: "FINAL_UNIT_STOCK_CONFLICT",
  });
  const stored = serializeOfflineOperation(original);
  assert.equal(stored.key, "device-idb-1:operation-idb-1");
  assert.equal(stored.sequence, "9007199254740993");

  const restored = deserializeOfflineOperation(stored);
  assert.deepEqual(restored, original);
  assert.equal(typeof restored.sequence, "bigint");
  assert.equal(Object.isFrozen(restored), true);
});

test("IndexedDB serialization omits absent optional values instead of persisting undefined", () => {
  const original = record({ authorizationExpiresAt: undefined });
  const stored = serializeOfflineOperation(original);
  assert.equal(Object.hasOwn(stored, "authorizationExpiresAt"), false);
  assert.equal(Object.hasOwn(stored, "serverReference"), false);
  assert.equal(Object.hasOwn(stored, "rejectionReason"), false);

  const restored = deserializeOfflineOperation(stored);
  assert.equal(Object.hasOwn(restored, "authorizationExpiresAt"), false);
  assert.equal(Object.hasOwn(restored, "serverReference"), false);
  assert.equal(Object.hasOwn(restored, "rejectionReason"), false);
});

test("IndexedDB deserialization rejects non-positive or corrupt operation sequences", () => {
  const stored = serializeOfflineOperation(record());
  assert.throws(
    () => deserializeOfflineOperation({ ...stored, sequence: "0" }),
    /sequence must be positive/i,
  );
  assert.throws(
    () => deserializeOfflineOperation({ ...stored, sequence: "not-an-integer" }),
    /cannot convert|bigint/i,
  );
});
