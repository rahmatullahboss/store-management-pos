import assert from "node:assert/strict";
import test from "node:test";
import { DurableOfflineEngine, MemoryOfflineDurableStore } from "../../build/modules/offline/src/durable-engine.js";

function operation(index) {
  const occurredAt = new Date(Date.UTC(2026, 6, 29, 0, index * 5)).toISOString();
  return {
    operationId: `operation-${String(index + 1).padStart(4, "0")}`,
    deviceId: "device-storage-1",
    registerId: "register-storage-1",
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
