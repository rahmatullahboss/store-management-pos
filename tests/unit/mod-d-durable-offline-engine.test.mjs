import assert from "node:assert/strict";
import test from "node:test";
import { DurableOfflineEngine, MemoryOfflineDurableStore } from "../../build/modules/offline/src/durable-engine.js";

function operation(overrides = {}) {
  return {
    operationId: "operation-1",
    deviceId: "device-1",
    registerId: "register-1",
    kind: "sale",
    payloadVersion: "1.0",
    requestHash: "hash-1",
    occurredAt: "2026-07-29T08:00:00.000Z",
    authorizationExpiresAt: "2026-07-30T08:00:00.000Z",
    ...overrides,
  };
}

test("durable commit survives engine restart before server acknowledgement", async () => {
  const store = new MemoryOfflineDurableStore({ projectionVersion: "catalog-1", appVersion: "1.0.0" });
  const firstEngine = new DurableOfflineEngine(store);
  const committed = await firstEngine.commit(operation(), "2026-07-29T08:00:01.000Z");
  assert.equal(committed.record.state, "pending");
  assert.equal(committed.record.sequence, 1n);

  const restartedEngine = new DurableOfflineEngine(store);
  const pending = await restartedEngine.pendingBatch();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].operationId, "operation-1");
  assert.equal(pending[0].committedAt, "2026-07-29T08:00:01.000Z");
});

test("device-scoped replay is idempotent and changed content is rejected", async () => {
  const store = new MemoryOfflineDurableStore();
  const engine = new DurableOfflineEngine(store);
  const first = await engine.commit(operation(), "2026-07-29T08:00:01.000Z");
  const replay = await engine.commit(operation(), "2026-07-29T08:00:02.000Z");
  assert.equal(replay.replayed, true);
  assert.equal(replay.record, first.record);

  const secondDevice = await engine.commit(operation({ deviceId: "device-2" }), "2026-07-29T08:00:03.000Z");
  assert.equal(secondDevice.record.sequence, 2n);
  await assert.rejects(() => engine.commit(operation({ requestHash: "changed" }), "2026-07-29T08:00:04.000Z"), /different content/i);
});

test("out-of-order outcomes preserve deterministic pending upload order", async () => {
  const engine = new DurableOfflineEngine(new MemoryOfflineDurableStore());
  await engine.commit(operation(), "2026-07-29T08:00:01.000Z");
  await engine.commit(operation({ operationId: "operation-2", requestHash: "hash-2" }), "2026-07-29T08:00:02.000Z");
  await engine.commit(operation({ operationId: "operation-3", requestHash: "hash-3" }), "2026-07-29T08:00:03.000Z");

  await engine.recordOutcome("device-1", "operation-2", { state: "accepted", serverReference: "sale-2" });
  const pending = await engine.pendingBatch();
  assert.deepEqual(pending.map((record) => record.operationId), ["operation-1", "operation-3"]);

  const replay = await engine.recordOutcome("device-1", "operation-2", { state: "accepted", serverReference: "sale-2" });
  assert.equal(replay.serverReference, "sale-2");
  await assert.rejects(() => engine.recordOutcome("device-1", "operation-2", { state: "rejected", rejectionReason: "conflict" }), /immutable outcome/i);
});

test("projection rebuild never deletes pending operations", async () => {
  const store = new MemoryOfflineDurableStore({ projectionVersion: "catalog-1" });
  const engine = new DurableOfflineEngine(store);
  await engine.commit(operation(), "2026-07-29T08:00:01.000Z");
  await engine.rebuildProjection("catalog-2");
  const snapshot = await store.snapshot();
  assert.equal(snapshot.projectionVersion, "catalog-2");
  assert.equal(snapshot.operations.length, 1);
  assert.equal(snapshot.operations[0].state, "pending");
});

test("application upgrade blocks unsupported pending payload versions", async () => {
  const store = new MemoryOfflineDurableStore({ appVersion: "1.0.0" });
  const engine = new DurableOfflineEngine(store);
  await engine.commit(operation({ payloadVersion: "1.0" }), "2026-07-29T08:00:01.000Z");
  await assert.rejects(() => engine.assertUpgradeSafe("2.0.0", new Set(["2.0"])), /unsupported payload version/i);
  assert.equal((await store.snapshot()).appVersion, "1.0.0");

  await engine.assertUpgradeSafe("1.1.0", new Set(["1.0"]));
  assert.equal((await store.snapshot()).appVersion, "1.1.0");
});

test("failed local transaction rolls back without stranding an operation", async () => {
  const store = new MemoryOfflineDurableStore();
  await assert.rejects(() => store.transaction((transaction) => {
    transaction.append(Object.freeze({
      ...operation(),
      sequence: 1n,
      state: "pending",
      committedAt: "2026-07-29T08:00:01.000Z",
    }));
    throw new Error("simulated storage failure");
  }), /simulated storage failure/i);
  assert.equal((await store.snapshot()).operations.length, 0);
});
