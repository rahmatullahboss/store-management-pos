import test from "node:test";
import assert from "node:assert/strict";
import { handlePosRequest } from "../../build/apps/api/src/modules/pos/handler.js";
import { PosSqlRepository } from "../../build/modules/pos/src/sql-repository.js";

const IDS = Object.freeze({
  tenant: "10000000-0000-4000-8000-000000000001",
  actor: "10000000-0000-4000-8000-000000000002",
  legalEntity: "10000000-0000-4000-8000-000000000003",
  store: "10000000-0000-4000-8000-000000000004",
  register: "10000000-0000-4000-8000-000000000005",
  device: "10000000-0000-4000-8000-000000000006",
  session: "10000000-0000-4000-8000-000000000007",
  cart: "10000000-0000-4000-8000-000000000008",
  authorization: "10000000-0000-4000-8000-000000000009",
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
    deviceId: IDS.device,
    locale: "en-US",
    timeZone: "UTC",
    businessDate: "2026-07-29",
    region: "test",
    permissions: new Set(permissions),
  };
}

function result(rows = []) {
  return { rows, rowCount: rows.length };
}

function checkoutBody(mode = "online") {
  return {
    storeId: IDS.store,
    registerId: IDS.register,
    deviceId: IDS.device,
    sessionId: IDS.session,
    cartId: IDS.cart,
    operationId: "operation-1",
    requestHash: "request-hash-1",
    mode,
    currency: "BDT",
    scale: 2,
    subtotalMinor: "1000",
    discountMinor: "0",
    taxMinor: "0",
    totalMinor: "1000",
    paymentState: "accepted",
    cartSnapshot: { version: "1" },
    tenderSnapshot: [{ kind: "cash", amountMinor: "1000" }],
    occurredAt: "2026-07-29T08:00:00.000Z",
    committedAt: "2026-07-29T08:00:00.001Z",
  };
}

test("MOD-D cart repository preserves an arbitrarily large exact decimal quantity", async () => {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes("FROM pos.register_sessions")) return result([{
        id: IDS.session,
        store_id: IDS.store,
        register_id: IDS.register,
        device_id: IDS.device,
        status: "open",
        business_date: "2026-07-29",
        version: "1",
      }]);
      if (text.includes("FROM pos.carts")) return result();
      return result();
    },
  };

  const repository = new PosSqlRepository();
  const quantity = "999999999999999999999999999999.000000000001";
  const created = await repository.createCart(client, context(), {
    id: IDS.cart,
    sessionId: IDS.session,
    currency: "BDT",
    scale: 2,
    lines: [{
      lineNumber: 1,
      variantReference: "variant-1",
      quantity,
      unitPriceMinor: "1000",
      discountMinor: "0",
      taxMinor: "0",
      priceSnapshot: { version: "price-1" },
      taxSnapshot: { version: "tax-1" },
    }],
  });

  assert.equal(created.id, IDS.cart);
  const lineInsert = calls.find(({ text }) => text.includes("INSERT INTO pos.cart_lines"));
  assert.ok(lineInsert);
  assert.equal(lineInsert.values[5], quantity);
});

test("MOD-D checkout rejects inconsistent exact totals before database access", async () => {
  let queryCount = 0;
  const client = { async query() { queryCount += 1; return result(); } };
  const repository = new PosSqlRepository();

  await assert.rejects(
    repository.recordCheckout(client, context(), {
      ...checkoutBody(),
      subtotalMinor: "1000",
      discountMinor: "100",
      taxMinor: "50",
      totalMinor: "1000",
    }),
    /exact totals are inconsistent/u,
  );
  assert.equal(queryCount, 0);
});

test("MOD-D checkout idempotency rejects a changed replay hash", async () => {
  const client = {
    async query(text) {
      if (text.includes("FROM pos.checkout_operations")) return result([{
        id: "checkout-1",
        operation_id: "operation-1",
        request_hash: "original-hash",
        payment_state: "accepted",
        status: "pending",
        version: "1",
      }]);
      return result();
    },
  };
  const repository = new PosSqlRepository();

  await assert.rejects(
    repository.recordCheckout(client, context(), checkoutBody()),
    /replayed with different content/u,
  );
});

test("MOD-D offline upload returns an explicit rejection for invalid authorization", async () => {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes("FROM pos.offline_operations")) return result();
      if (text.includes("FROM pos.offline_authorizations")) return result();
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const repository = new PosSqlRepository();
  const outcomes = await repository.uploadOfflineOperations(client, context(), [{
    deviceId: IDS.device,
    registerId: IDS.register,
    authorizationId: IDS.authorization,
    operationId: "operation-1",
    deviceSequence: "1",
    operationType: "checkout",
    aggregateId: IDS.cart,
    aggregateVersion: "1",
    payload: { checkoutId: "checkout-1" },
    payloadHash: "payload-hash-1",
    recordedAt: "2026-07-29T08:00:00.000Z",
    localSchemaVersion: "1",
    appVersion: "1.0.0",
  }]);

  assert.deepEqual(outcomes, [{
    operationId: "operation-1",
    status: "rejected",
    reasonCode: "OFFLINE_AUTHORIZATION_INVALID",
  }]);
  assert.equal(calls.some(({ text }) => text.includes("INSERT INTO pos.offline_operations")), false);
});

test("MOD-D offline duplicate replay returns the original operation without another insert", async () => {
  const client = {
    async query(text) {
      if (text.includes("FROM pos.offline_operations")) return result([{ id: "offline-1", payload_hash: "payload-hash-1" }]);
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const repository = new PosSqlRepository();
  const outcomes = await repository.uploadOfflineOperations(client, context(), [{
    deviceId: IDS.device,
    registerId: IDS.register,
    authorizationId: IDS.authorization,
    operationId: "operation-1",
    deviceSequence: "1",
    operationType: "checkout",
    aggregateId: IDS.cart,
    aggregateVersion: "1",
    payload: { checkoutId: "checkout-1" },
    payloadHash: "payload-hash-1",
    recordedAt: "2026-07-29T08:00:00.000Z",
    localSchemaVersion: "1",
    appVersion: "1.0.0",
  }]);

  assert.deepEqual(outcomes, [{ operationId: "operation-1", status: "duplicate", offlineOperationId: "offline-1" }]);
});

test("MOD-D API uses separate online and offline checkout permissions", async () => {
  const calls = [];
  const repository = {
    async recordCheckout(_client, _context, input) {
      calls.push(input);
      return { id: "checkout-1", status: "pending" };
    },
  };
  const database = {
    async withClientTransaction(_context, work) {
      return await work({ query: async () => result() });
    },
  };

  const onlineRequest = new Request("https://example.test/v1/pos/checkouts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(checkoutBody("online")),
  });
  const onlineResponse = await handlePosRequest(
    onlineRequest,
    new URL(onlineRequest.url),
    context(["pos.checkout.execute"]),
    database,
    repository,
  );
  assert.equal(onlineResponse.status, 202);
  assert.equal(calls[0].mode, "online");

  const deniedOfflineRequest = new Request("https://example.test/v1/pos/checkouts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(checkoutBody("offline")),
  });
  await assert.rejects(
    handlePosRequest(
      deniedOfflineRequest,
      new URL(deniedOfflineRequest.url),
      context(["pos.checkout.execute"]),
      database,
      repository,
    ),
    /pos\.checkout\.offline/u,
  );

  const allowedOfflineRequest = new Request("https://example.test/v1/pos/checkouts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(checkoutBody("offline")),
  });
  const offlineResponse = await handlePosRequest(
    allowedOfflineRequest,
    new URL(allowedOfflineRequest.url),
    context(["pos.checkout.offline"]),
    database,
    repository,
  );
  assert.equal(offlineResponse.status, 202);
  assert.equal(calls[1].mode, "offline");
});
