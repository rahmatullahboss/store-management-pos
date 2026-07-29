import test from "node:test";
import assert from "node:assert/strict";
import { OfflineOperationLog } from "../../build/modules/offline/src/domain.js";

function operation(deviceId, requestHash) {
  return {
    operationId: "local-sequence-1",
    deviceId,
    registerId: `register-${deviceId}`,
    kind: "sale",
    payloadVersion: "1.0",
    requestHash,
    occurredAt: "2026-07-29T08:30:00.000Z",
  };
}

test("MOD-D scopes offline idempotency by device and operation ID", () => {
  const log = new OfflineOperationLog();
  const firstDevice = log.append(operation("device-1", "hash-device-1"), "2026-07-29T08:30:01.000Z");
  const secondDevice = log.append(operation("device-2", "hash-device-2"), "2026-07-29T08:30:02.000Z");

  assert.equal(firstDevice.replayed, false);
  assert.equal(secondDevice.replayed, false);
  assert.equal(firstDevice.record.sequence, 1n);
  assert.equal(secondDevice.record.sequence, 2n);
  assert.equal(log.pendingCount(), 2);
  assert.throws(
    () => log.recordOutcome("local-sequence-1", { state: "accepted", serverReference: "sale-ambiguous" }),
    /ambiguous across devices/i,
  );

  const accepted = log.recordDeviceOutcome("device-1", "local-sequence-1", {
    state: "accepted",
    serverReference: "sale-device-1",
  });
  assert.equal(accepted.deviceId, "device-1");
  assert.equal(accepted.state, "accepted");
  assert.equal(log.pendingCount(), 1);
});

test("MOD-D still rejects changed replay content within one device scope", () => {
  const log = new OfflineOperationLog();
  log.append(operation("device-1", "hash-device-1"), "2026-07-29T08:30:01.000Z");
  assert.throws(
    () => log.append(operation("device-1", "changed-hash"), "2026-07-29T08:30:02.000Z"),
    /replayed with different content/i,
  );
});
