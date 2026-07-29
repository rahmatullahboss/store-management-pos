import assert from "node:assert/strict";
import test from "node:test";
import { CashSqlRepository } from "../../build/modules/cash/src/sql-repository.js";

const IDS = Object.freeze({
  tenant: "21000000-0000-4000-8000-000000000001",
  actor: "21000000-0000-4000-8000-000000000002",
  store: "21000000-0000-4000-8000-000000000003",
  register: "21000000-0000-4000-8000-000000000004",
  session: "21000000-0000-4000-8000-000000000005",
  shift: "21000000-0000-4000-8000-000000000006",
  event: "21000000-0000-4000-8000-000000000007",
  count: "21000000-0000-4000-8000-000000000008",
  closure: "21000000-0000-4000-8000-000000000009",
});

const context = Object.freeze({
  requestId: "cash-request-1",
  traceId: "cash-trace-1",
  tenantId: IDS.tenant,
  actorId: IDS.actor,
  businessDate: "2026-07-29",
  region: "test",
  permissions: new Set(),
});

function result(rows = []) {
  return { rows, rowCount: rows.length };
}

test("cash open delegates one exact command and generates an opening event ID", async () => {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      return result([{ id: IDS.shift, status: "open", replayed: false }]);
    },
  };
  const repository = new CashSqlRepository();
  const opened = await repository.openShift(client, context, {
    id: IDS.shift,
    storeId: IDS.store,
    registerId: IDS.register,
    posSessionId: IDS.session,
    currency: "BDT",
    scale: 2,
    openingFloatMinor: "50000",
    idempotencyKey: "open-1",
    requestHash: "open-hash-1",
    occurredAt: "2026-07-29T08:00:00.000Z",
  });

  assert.equal(opened.id, IDS.shift);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /cash\.open_shift_v1/u);
  assert.match(calls[0].values[7], /^[0-9a-f-]{36}$/u);
  assert.equal(calls.some(({ text }) => /INSERT INTO cash\./u.test(text)), false);
});

test("cash event rejects zero before any database command", async () => {
  let queryCount = 0;
  const client = { async query() { queryCount += 1; return result(); } };
  const repository = new CashSqlRepository();
  await assert.rejects(
    repository.appendEvent(client, context, {
      id: IDS.event,
      shiftId: IDS.shift,
      eventType: "cash_sale",
      currency: "BDT",
      scale: 2,
      amountMinor: "0",
      sourceType: "checkout",
      sourceId: "checkout-1",
      idempotencyKey: "event-1",
      requestHash: "event-hash-1",
      occurredAt: "2026-07-29T08:01:00.000Z",
    }),
    /must be positive/u,
  );
  assert.equal(queryCount, 0);
});

test("cash close delegates count, breakdown and approval to one command", async () => {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      return result([{
        id: IDS.closure,
        shift_id: IDS.shift,
        expected_minor: "50000",
        counted_minor: "50000",
        variance_minor: "0",
        replayed: false,
      }]);
    },
  };
  const repository = new CashSqlRepository();
  const closed = await repository.closeShift(client, context, {
    shiftId: IDS.shift,
    cashCountId: IDS.count,
    closureId: IDS.closure,
    countType: "blind_close",
    currency: "BDT",
    scale: 2,
    countedMinor: "50000",
    denominationBreakdown: { "1000": 50 },
    closedAt: "2026-07-29T09:00:00.000Z",
  });

  assert.equal(closed.variance_minor, "0");
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /cash\.close_shift_v1/u);
  assert.equal(calls[0].values[6], "50000");
  assert.equal(calls.some(({ text }) => /UPDATE cash\./u.test(text)), false);
});
