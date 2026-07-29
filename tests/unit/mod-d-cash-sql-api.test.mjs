import assert from "node:assert/strict";
import test from "node:test";
import { handleCashRequest } from "../../build/apps/api/src/modules/cash/handler.js";

const IDS = Object.freeze({
  tenant: "20000000-0000-4000-8000-000000000001",
  actor: "20000000-0000-4000-8000-000000000002",
  legalEntity: "20000000-0000-4000-8000-000000000003",
  store: "20000000-0000-4000-8000-000000000004",
  register: "20000000-0000-4000-8000-000000000005",
  session: "20000000-0000-4000-8000-000000000006",
  shift: "20000000-0000-4000-8000-000000000007",
});

function context(permissions = []) {
  return {
    requestId: "request-1",
    traceId: "trace-1",
    tenantId: IDS.tenant,
    actorId: IDS.actor,
    legalEntityId: IDS.legalEntity,
    storeId: IDS.store,
    registerId: IDS.register,
    locale: "en-US",
    timeZone: "UTC",
    businessDate: "2026-07-29",
    region: "test",
    permissions: new Set(permissions),
  };
}

function database() {
  return {
    async withClientTransaction(_context, work) {
      return await work({ query: async () => ({ rows: [], rowCount: 0 }) });
    },
  };
}

function request(path, body, method = "POST") {
  return new Request(`https://example.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function openBody() {
  return {
    storeId: IDS.store,
    registerId: IDS.register,
    posSessionId: IDS.session,
    currency: "bdt",
    scale: 2,
    openingFloatMinor: "5000",
    idempotencyKey: "open-shift-1",
    requestHash: "hash-open-1",
    occurredAt: "2026-07-29T09:00:00.000Z",
  };
}

test("cash shift open requires the narrow permission and normalizes currency", async () => {
  const calls = [];
  const repository = {
    async openShift(_client, _context, input) {
      calls.push(input);
      return { id: IDS.shift, status: "open" };
    },
  };

  const denied = request("/v1/cash/shifts", openBody());
  await assert.rejects(
    handleCashRequest(denied, new URL(denied.url), context(), database(), repository),
    /cash\.shift\.open/u,
  );

  const allowed = request("/v1/cash/shifts", openBody());
  const response = await handleCashRequest(
    allowed,
    new URL(allowed.url),
    context(["cash.shift.open"]),
    database(),
    repository,
  );
  assert.equal(response.status, 201);
  assert.equal(calls[0].currency, "BDT");
  assert.equal(calls[0].posSessionId, IDS.session);
});

test("cash event route binds the shift from the path and rejects unsupported event types", async () => {
  const calls = [];
  const repository = {
    async appendEvent(_client, _context, input) {
      calls.push(input);
      return { id: "event-1" };
    },
  };
  const body = {
    eventType: "safe_drop",
    currency: "BDT",
    scale: 2,
    amountMinor: "1000",
    sourceType: "safe",
    sourceId: "safe-drop-1",
    idempotencyKey: "event-1",
    requestHash: "event-hash-1",
    occurredAt: "2026-07-29T09:10:00.000Z",
  };
  const allowed = request(`/v1/cash/shifts/${IDS.shift}/events`, body);
  const response = await handleCashRequest(
    allowed,
    new URL(allowed.url),
    context(["cash.event.append"]),
    database(),
    repository,
  );
  assert.equal(response.status, 201);
  assert.equal(calls[0].shiftId, IDS.shift);
  assert.equal(calls[0].eventType, "safe_drop");

  const invalid = request(`/v1/cash/shifts/${IDS.shift}/events`, { ...body, eventType: "opening_float" });
  await assert.rejects(
    handleCashRequest(invalid, new URL(invalid.url), context(["cash.event.append"]), database(), repository),
    /Unsupported cash event type/u,
  );
});

test("cash close and event history use separate permissions", async () => {
  const calls = [];
  const repository = {
    async closeShift(_client, _context, input) {
      calls.push({ kind: "close", input });
      return { shift_id: IDS.shift, variance_minor: "0" };
    },
    async listShiftEvents(_client, _context, shiftId, limit) {
      calls.push({ kind: "read", shiftId, limit });
      return [{ id: "event-1" }];
    },
  };
  const close = request(`/v1/cash/shifts/${IDS.shift}/close`, {
    countType: "blind_close",
    currency: "BDT",
    scale: 2,
    countedMinor: "5000",
    denominationBreakdown: { "1000": 5 },
    closedAt: "2026-07-29T10:00:00.000Z",
  });
  const closeResponse = await handleCashRequest(
    close,
    new URL(close.url),
    context(["cash.shift.close"]),
    database(),
    repository,
  );
  assert.equal(closeResponse.status, 200);
  assert.equal(calls[0].input.shiftId, IDS.shift);

  const history = request(`/v1/cash/shifts/${IDS.shift}/events?limit=25`, undefined, "GET");
  const historyResponse = await handleCashRequest(
    history,
    new URL(history.url),
    context(["cash.shift.read"]),
    database(),
    repository,
  );
  assert.equal(historyResponse.status, 200);
  assert.deepEqual(calls[1], { kind: "read", shiftId: IDS.shift, limit: 25 });
});
