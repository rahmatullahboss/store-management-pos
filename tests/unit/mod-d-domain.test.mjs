import test from "node:test";
import assert from "node:assert/strict";
import { money } from "../../build/packages/foundation/src/money.js";
import { assertCheckoutReady, calculateCartTotals } from "../../build/modules/pos/src/domain.js";
import { OfflineOperationLog } from "../../build/modules/offline/src/domain.js";

const bdt = (amountMinor) => money(BigInt(amountMinor), "BDT", 2);

function offlineInput(overrides = {}) {
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

test("MOD-D cart totals preserve exact money across quantity, discount and tax", () => {
  const totals = calculateCartTotals([
    {
      lineId: "line-1",
      variantId: "variant-1",
      quantity: 2n,
      unitPrice: bdt(1_000),
      discountTotal: bdt(100),
      taxTotal: bdt(190),
    },
  ], "BDT", 2);

  assert.equal(totals.gross.amountMinor, 2_000n);
  assert.equal(totals.discount.amountMinor, 100n);
  assert.equal(totals.tax.amountMinor, 190n);
  assert.equal(totals.payable.amountMinor, 2_090n);
});

test("MOD-D checkout blocks blind retry for an unknown provider state", () => {
  assert.throws(() => assertCheckoutReady(bdt(2_090), [
    { tenderId: "card-1", kind: "external_card", amount: bdt(2_090), state: "unknown" },
  ]), /unknown/i);
});

test("MOD-D checkout accepts an exact split tender and rejects a value mismatch", () => {
  const ready = assertCheckoutReady(bdt(2_090), [
    { tenderId: "cash-1", kind: "cash", amount: bdt(1_000), state: "accepted" },
    { tenderId: "card-1", kind: "external_card", amount: bdt(1_090), state: "captured" },
  ]);
  assert.equal(ready.ready, true);
  assert.equal(ready.tendered.amountMinor, 2_090n);

  assert.throws(() => assertCheckoutReady(bdt(2_090), [
    { tenderId: "cash-2", kind: "cash", amount: bdt(2_000), state: "accepted" },
  ]), /must equal/i);
});

test("MOD-D offline log commits before acknowledgement and replays identical operations idempotently", () => {
  const log = new OfflineOperationLog();
  const first = log.append(offlineInput(), "2026-07-29T08:00:01.000Z");
  const replay = log.append(offlineInput(), "2026-07-29T08:00:02.000Z");

  assert.equal(first.replayed, false);
  assert.equal(first.record.sequence, 1n);
  assert.equal(first.record.state, "pending");
  assert.equal(first.record.committedAt, "2026-07-29T08:00:01.000Z");
  assert.equal(replay.replayed, true);
  assert.equal(replay.record, first.record);
  assert.equal(log.pendingCount(), 1);

  assert.throws(() => log.append(offlineInput({ requestHash: "changed-hash" }), "2026-07-29T08:00:03.000Z"), /different content/i);
});

test("MOD-D offline outcomes are immutable and pending upload order remains deterministic", () => {
  const log = new OfflineOperationLog();
  log.append(offlineInput(), "2026-07-29T08:00:01.000Z");
  log.append(offlineInput({ operationId: "operation-2", requestHash: "hash-2" }), "2026-07-29T08:00:02.000Z");

  const accepted = log.recordOutcome("operation-1", { state: "accepted", serverReference: "sale-1" });
  assert.equal(accepted.state, "accepted");
  assert.equal(log.recordOutcome("operation-1", { state: "accepted", serverReference: "sale-1" }), accepted);
  assert.throws(() => log.recordOutcome("operation-1", { state: "rejected", rejectionReason: "stock conflict" }), /immutable outcome/i);

  const pending = log.uploadBatch();
  assert.deepEqual(pending.map((record) => record.operationId), ["operation-2"]);
  assert.equal(log.pendingCount(), 1);
});
