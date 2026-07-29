import test from "node:test";
import assert from "node:assert/strict";
import { money } from "../../build/packages/foundation/src/money.js";
import { CashShiftLedger } from "../../build/modules/cash/src/domain.js";
import { OfflineOperationLog } from "../../build/modules/offline/src/domain.js";

const operation = {
  operationId: "operation-001",
  deviceId: "device-001",
  registerId: "register-001",
  kind: "sale",
  payloadVersion: "1.0",
  requestHash: "hash-operation-001",
  occurredAt: "2026-07-29T08:30:00.000Z",
};

test("offline operation log commits before upload and replays idempotently", () => {
  const log = new OfflineOperationLog();
  const first = log.append(operation, "2026-07-29T08:30:00.010Z");
  const replay = log.append(operation, "2026-07-29T08:30:00.020Z");

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(first.record.sequence, 1n);
  assert.equal(log.pendingCount(), 1);
  assert.deepEqual(log.uploadBatch(), [first.record]);
  assert.throws(
    () => log.append({ ...operation, requestHash: "different-hash" }, "2026-07-29T08:30:00.030Z"),
    /different content/i,
  );
});

test("offline outcomes are immutable and rejected receipts remain visible", () => {
  const log = new OfflineOperationLog();
  log.append(operation, "2026-07-29T08:30:00.010Z");
  const rejected = log.recordOutcome(operation.operationId, {
    state: "review_required",
    rejectionReason: "final unit was sold by another register",
  });

  assert.equal(rejected.state, "review_required");
  assert.equal(log.pendingCount(), 0);
  assert.equal(log.snapshot().length, 1);
  assert.equal(log.recordOutcome(operation.operationId, {
    state: "review_required",
    rejectionReason: "final unit was sold by another register",
  }), rejected);
  assert.throws(
    () => log.recordOutcome(operation.operationId, { state: "accepted", serverReference: "sale-001" }),
    /immutable outcome/i,
  );
});

test("cash shift expected balance is reconstructed only from append-only events", () => {
  const ledger = new CashShiftLedger("shift-001", "BDT", 2);
  const add = (eventId, kind, amountMinor) => ledger.append({
    eventId,
    shiftId: "shift-001",
    kind,
    amount: money(amountMinor, "BDT", 2),
    requestHash: `hash-${eventId}`,
    occurredAt: "2026-07-29T08:30:00.000Z",
  });

  add("event-001", "opening_float", 10_000n);
  add("event-002", "cash_sale", 2_500n);
  add("event-003", "cash_refund", 500n);
  add("event-004", "paid_out", 1_000n);
  add("event-005", "safe_drop", 3_000n);

  assert.equal(ledger.expectedCash().amountMinor, 8_000n);
  assert.equal(add("event-005", "safe_drop", 3_000n).replayed, true);
  assert.equal(ledger.events().length, 5);
});

test("cash variance requires approval and closed shifts reject new events", () => {
  const ledger = new CashShiftLedger("shift-002", "BDT", 2);
  ledger.append({
    eventId: "event-101",
    shiftId: "shift-002",
    kind: "opening_float",
    amount: money(5_000n, "BDT", 2),
    requestHash: "hash-event-101",
    occurredAt: "2026-07-29T08:30:00.000Z",
  });

  assert.throws(
    () => ledger.close(money(4_900n, "BDT", 2), "2026-07-29T17:00:00.000Z"),
    /requires approval/i,
  );
  const summary = ledger.close(money(4_900n, "BDT", 2), "2026-07-29T17:00:00.000Z", "manager-001");
  assert.equal(summary.variance.amountMinor, -100n);
  assert.equal(summary.approvedBy, "manager-001");
  assert.throws(() => ledger.append({
    eventId: "event-102",
    shiftId: "shift-002",
    kind: "cash_sale",
    amount: money(100n, "BDT", 2),
    requestHash: "hash-event-102",
    occurredAt: "2026-07-29T17:01:00.000Z",
  }), /closed/i);
});
