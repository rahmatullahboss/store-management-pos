import assert from "node:assert/strict";
import test from "node:test";
import { DurableOfflineEngine, MemoryOfflineDurableStore } from "../../build/modules/offline/src/durable-engine.js";

function operation(index) {
  const occurredAt = new Date(Date.UTC(2026, 6, 29, 0, index * 5)).toISOString();
  return {
    operationId: `operation-${String(index + 1).padStart(4, "0")}`,
    deviceId: "device-outage-1",
    registerId: "register-outage-1",
    kind: "sale",
    payloadVersion: "1.0",
    requestHash: `hash-${index + 1}`,
    occurredAt,
    authorizationExpiresAt: "2026-07-31T00:00:00.000Z",
  };
}

class CapacityLimitedStore {
  constructor(limit) {
    this.limit = limit;
    this.inner = new MemoryOfflineDurableStore();
  }

  async transaction(work) {
    return await this.inner.transaction(async (store) => await work({
      find: (deviceId, operationId) => store.find(deviceId, operationId),
      list: () => store.list(),
      append: (record) => {
        if (store.list().length >= this.limit) throw new Error("offline storage pressure limit reached");
        store.append(record);
      },
      replace: (record) => store.replace(record),
      uploadCursor: () => store.uploadCursor(),
      setUploadCursor: (sequence) => store.setUploadCursor(sequence),
      setDownloadCursor: (cursor) => store.setDownloadCursor(cursor),
      setProjectionVersion: (version) => store.setProjectionVersion(version),
      setAppVersion: (version) => store.setAppVersion(version),
    }));
  }

  async snapshot() {
    return await this.inner.snapshot();
  }
}

test("representative 24-hour outage backlog survives restart and drains in deterministic order", async () => {
  const store = new MemoryOfflineDurableStore({ projectionVersion: "catalog-1", appVersion: "1.0.0" });
  let engine = new DurableOfflineEngine(store);
  const operationCount = 288; // one durable checkout every five minutes for 24 hours

  for (let index = 0; index < operationCount; index += 1) {
    const input = operation(index);
    const committedAt = new Date(Date.parse(input.occurredAt) + 250).toISOString();
    const committed = await engine.commit(input, committedAt);
    assert.equal(committed.record.sequence, BigInt(index + 1));
  }

  engine = new DurableOfflineEngine(store);
  const firstBatch = await engine.pendingBatch(100);
  assert.equal(firstBatch.length, 100);
  assert.equal(firstBatch[0].operationId, "operation-0001");
  assert.equal(firstBatch.at(-1).operationId, "operation-0100");

  for (const record of firstBatch) {
    await engine.recordOutcome(record.deviceId, record.operationId, {
      state: "accepted",
      serverReference: `sale-${record.sequence}`,
    });
  }
  await engine.advanceUploadCursor(100n);

  engine = new DurableOfflineEngine(store);
  const remaining = await engine.pendingBatch(1_000);
  assert.equal(remaining.length, 188);
  assert.equal(remaining[0].sequence, 101n);
  assert.equal(remaining.at(-1).sequence, 288n);
  assert.equal((await store.snapshot()).operations.length, operationCount);
});

test("storage pressure refusal rolls back atomically and preserves earlier pending operations", async () => {
  const store = new CapacityLimitedStore(2);
  const engine = new DurableOfflineEngine(store);

  await engine.commit(operation(0), "2026-07-29T00:00:00.250Z");
  await engine.commit(operation(1), "2026-07-29T00:05:00.250Z");
  await assert.rejects(
    () => engine.commit(operation(2), "2026-07-29T00:10:00.250Z"),
    /storage pressure limit reached/i,
  );

  const snapshot = await store.snapshot();
  assert.equal(snapshot.operations.length, 2);
  assert.deepEqual(
    snapshot.operations.map((record) => record.operationId),
    ["operation-0001", "operation-0002"],
  );
  assert.deepEqual(
    (await new DurableOfflineEngine(store).pendingBatch()).map((record) => record.sequence),
    [1n, 2n],
  );
});
