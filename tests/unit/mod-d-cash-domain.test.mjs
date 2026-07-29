import test from "node:test";
import assert from "node:assert/strict";
import { money } from "../../build/packages/foundation/src/money.js";
import { CashShiftLedger } from "../../build/modules/cash/src/domain.js";

const bdt = (amountMinor) => money(BigInt(amountMinor), "BDT", 2);

function event(overrides = {}) {
  return {
    eventId: "cash-event-1",
    shiftId: "shift-1",
    kind: "opening_float",
    amount: bdt(1_000),
    requestHash: "cash-hash-1",
    occurredAt: "2026-07-29T08:00:00.000Z",
    ...overrides,
  };
}

test("MOD-D reconstructs expected cash only from append-only cash events", () => {
  const ledger = new CashShiftLedger("shift-1", "BDT", 2);
  ledger.append(event());
  ledger.append(event({
    eventId: "cash-event-2",
    kind: "cash_sale",
    amount: bdt(500),
    requestHash: "cash-hash-2",
    occurredAt: "2026-07-29T08:01:00.000Z",
  }));
  ledger.append(event({
    eventId: "cash-event-3",
    kind: "cash_refund",
    amount: bdt(100),
    requestHash: "cash-hash-3",
    occurredAt: "2026-07-29T08:02:00.000Z",
  }));
  ledger.append(event({
    eventId: "cash-event-4",
    kind: "safe_drop",
    amount: bdt(200),
    requestHash: "cash-hash-4",
    occurredAt: "2026-07-29T08:03:00.000Z",
  }));

  assert.equal(ledger.expectedCash().amountMinor, 1_200n);
  assert.deepEqual(ledger.events().map((entry) => entry.sequence), [1n, 2n, 3n, 4n]);
});

test("MOD-D cash events replay idempotently and reject changed content", () => {
  const ledger = new CashShiftLedger("shift-1", "BDT", 2);
  const first = ledger.append(event());
  const replay = ledger.append(event());

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.event, first.event);
  assert.throws(() => ledger.append(event({ requestHash: "changed-hash" })), /different content/i);
});

test("MOD-D cash variance requires approval and a closed shift is immutable", () => {
  const ledger = new CashShiftLedger("shift-1", "BDT", 2);
  ledger.append(event());

  assert.throws(() => ledger.close(bdt(990), "2026-07-29T09:00:00.000Z"), /requires approval/i);
  const summary = ledger.close(bdt(990), "2026-07-29T09:00:00.000Z", "manager-1");

  assert.equal(summary.expectedCash.amountMinor, 1_000n);
  assert.equal(summary.countedCash.amountMinor, 990n);
  assert.equal(summary.variance.amountMinor, -10n);
  assert.equal(summary.approvedBy, "manager-1");
  assert.equal(ledger.close(bdt(990), "2026-07-29T09:05:00.000Z", "manager-1"), summary);
  assert.throws(() => ledger.append(event({ eventId: "cash-event-2", requestHash: "cash-hash-2" })), /closed/i);
});
