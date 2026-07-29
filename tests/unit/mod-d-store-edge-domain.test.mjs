import assert from "node:assert/strict";
import test from "node:test";
import { appendCashEvent, reconcileCash, reconstructExpectedCash } from "../../build/modules/cash/src/ledger.js";
import { applySyncOutcome, markUploading, pendingOperations, registerPendingOperation } from "../../build/modules/offline/src/operation-log.js";
import { assertCheckoutReady, calculateCartTotals } from "../../build/modules/pos/src/domain.js";
import { money } from "../../build/packages/foundation/src/money.js";

function isPlatformError(code) {
  return (error) => error instanceof Error && error.code === code;
}

test("POS totals remain exact and require fully confirmed tenders", () => {
  const totals = calculateCartTotals([
    {
      lineId: "line-1",
      variantId: "variant-1",
      quantity: 2n,
      unitPrice: money(1_000n, "USD"),
      discountTotal: money(100n, "USD"),
      taxTotal: money(150n, "USD"),
    },
  ], "USD");

  assert.equal(totals.gross.amountMinor, 2_000n);
  assert.equal(totals.payable.amountMinor, 2_050n);
  const readiness = assertCheckoutReady(totals.payable, [
    { tenderId: "cash-1", kind: "cash", amount: money(1_000n, "USD"), state: "accepted" },
    { tenderId: "card-1", kind: "external_card", amount: money(1_050n, "USD"), state: "captured" },
  ]);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.tendered.amountMinor, 2_050n);

  assert.throws(() => assertCheckoutReady(totals.payable, [
    { tenderId: "card-unknown", kind: "external_card", amount: totals.payable, state: "unknown" },
  ]), isPlatformError("CONFLICT"));
});

test("cash expectation reconstructs entirely from append-only events", () => {
  let events = [];
  events = appendCashEvent(events, {
    eventId: "event-open",
    shiftId: "shift-1",
    registerId: "register-1",
    type: "opening_float",
    amount: money(5_000n, "USD"),
    occurredAt: "2026-07-29T08:00:00Z",
    sourceReference: "shift-open",
  });
  events = appendCashEvent(events, {
    eventId: "event-sale",
    shiftId: "shift-1",
    registerId: "register-1",
    type: "cash_sale",
    amount: money(2_500n, "USD"),
    occurredAt: "2026-07-29T08:05:00Z",
    sourceReference: "receipt-1",
  });
  events = appendCashEvent(events, {
    eventId: "event-drop",
    shiftId: "shift-1",
    registerId: "register-1",
    type: "safe_drop",
    amount: money(1_000n, "USD"),
    occurredAt: "2026-07-29T08:10:00Z",
    sourceReference: "safe-drop-1",
  });

  const expected = reconstructExpectedCash(events, "USD");
  assert.equal(expected.amountMinor, 6_500n);
  const reconciliation = reconcileCash(expected, money(6_450n, "USD"));
  assert.equal(reconciliation.variance.amountMinor, -50n);
  assert.equal(reconciliation.balanced, false);
  assert.throws(() => appendCashEvent(events, events[0]), isPlatformError("IDEMPOTENCY_CONFLICT"));
});

test("offline operation IDs replay idempotently and accepted receipts remain terminal", () => {
  const operation = {
    deviceId: "device-1",
    operationId: "operation-1",
    operationType: "pos.checkout",
    payloadHash: "sha256:checkout-1",
    localCommittedAt: "2026-07-29T08:00:00Z",
    receiptSnapshotId: "receipt-local-1",
    status: "pending",
    serverReference: null,
    rejectionCode: null,
  };

  const registered = registerPendingOperation([], operation);
  assert.equal(registered.disposition, "appended");
  assert.equal(pendingOperations(registered.log).length, 1);
  const duplicate = registerPendingOperation(registered.log, operation);
  assert.equal(duplicate.disposition, "duplicate");
  assert.equal(duplicate.log.length, 1);

  assert.throws(() => registerPendingOperation(registered.log, { ...operation, payloadHash: "sha256:different" }), isPlatformError("IDEMPOTENCY_CONFLICT"));

  const uploading = markUploading(registered.log, operation.deviceId, operation.operationId);
  const accepted = applySyncOutcome(uploading, operation.deviceId, operation.operationId, {
    status: "accepted",
    serverReference: "sale-1",
    rejectionCode: null,
  });
  assert.equal(accepted[0].status, "accepted");
  assert.equal(pendingOperations(accepted).length, 0);
  assert.throws(() => applySyncOutcome(accepted, operation.deviceId, operation.operationId, {
    status: "rejected",
    serverReference: null,
    rejectionCode: "STALE_PRICE",
  }), isPlatformError("CONFLICT"));
});
