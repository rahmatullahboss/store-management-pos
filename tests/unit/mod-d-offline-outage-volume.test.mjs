import assert from "node:assert/strict";
import test from "node:test";
import { DurableOfflineEngine, MemoryOfflineDurableStore } from "../../build/modules/offline/src/durable-engine.js";

const outageStart = Date.parse("2026-07-29T00:00:00.000Z");

function operation(index) {
  const occurredAt = new Date(outageStart + index * 60_000).toISOString();
  return {
    operationId: `outage-operation-${String(index + 1).padStart(4, "0")}`,
    deviceId: "outage-device-1",
    registerId: "outage-register-1",
    kind: index % 12 === 0 ? "cash_event" : "sale",
    payloadVersion: "1.0",
    requestHash: `outage-hash-${index + 1}`,
    occurredAt,
    authorizationExpiresAt: "2026-07-30T23:59:59.000Z",
  };
}

test("24-hour representative outage survives restart and uploads in bounded ordered batches", async () => {
  const operationCount = 1_440;
  const store = new MemoryOfflineDurableStore({
    projectionVersion: "catalog-outage-start",
    appVersion: "1.0.0",
  });
  const engine = new DurableOfflineEngine(store);

  for (let index = 0; index < operationCount; index += 1) {
    const input = operation(index);
    const committedAt = new Date(Date.parse(input.occurredAt) + 250).toISOString();
    const result = await engine.commit(input, committedAt);
    assert.equal(result.replayed, false);
    assert.equal(result.record.sequence, BigInt(index + 1));
  }

  const afterOutage = await store.snapshot();
  assert.equal(afterOutage.operations.length, operationCount);
  assert.equal(afterOutage.uploadCursor, 0n);
  assert.equal(afterOutage.operations.every((record) => record.state === "pending"), true);

  const restarted = new DurableOfflineEngine(store);
  const firstBatch = await restarted.pendingBatch(1_000);
  assert.equal(firstBatch.length, 1_000);
  assert.equal(firstBatch[0].sequence, 1n);
  assert.equal(firstBatch.at(-1).sequence, 1_000n);

  for (const record of firstBatch) {
    await restarted.recordOutcome(record.deviceId, record.operationId, {
      state: "accepted",
      serverReference: `server-${record.sequence}`,
    });
  }
  await restarted.advanceUploadCursor(1_000n);

  const secondBatch = await restarted.pendingBatch(1_000);
  assert.equal(secondBatch.length, 440);
  assert.equal(secondBatch[0].sequence, 1_001n);
  assert.equal(secondBatch.at(-1).sequence, 1_440n);
  assert.deepEqual(
    secondBatch.map((record) => record.operationId),
    Array.from({ length: 440 }, (_, index) => operation(index + 1_000).operationId),
  );

  const finalSnapshot = await store.snapshot();
  assert.equal(finalSnapshot.operations.length, operationCount);
  assert.equal(finalSnapshot.uploadCursor, 1_000n);
  assert.equal(finalSnapshot.operations.slice(0, 1_000).every((record) => record.state === "accepted"), true);
  assert.equal(finalSnapshot.operations.slice(1_000).every((record) => record.state === "pending"), true);
});
