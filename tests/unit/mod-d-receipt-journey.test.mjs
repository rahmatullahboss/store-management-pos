import assert from "node:assert/strict";
import test from "node:test";
import { handlePosReceiptRequest } from "../../build/apps/api/src/modules/pos/receipt-handler.js";
import { PosReceiptRepository } from "../../build/modules/pos/src/receipt-repository.js";

const IDS = Object.freeze({
  tenant: "10000000-0000-4000-8000-000000000001",
  actor: "10000000-0000-4000-8000-000000000002",
  receipt: "10000000-0000-4000-8000-000000000003",
  checkout: "10000000-0000-4000-8000-000000000004",
});

function context(permissions = []) {
  return {
    requestId: "request-receipt-1",
    traceId: "trace-receipt-1",
    tenantId: IDS.tenant,
    actorId: IDS.actor,
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

function database() {
  return {
    async withClientTransaction(_context, work) {
      return await work({ query: async () => result() });
    },
  };
}

test("MOD-D receipt lookup is tenant-scoped and preserves exact money", async () => {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      return result([{
        id: IDS.receipt,
        checkout_operation_id: IDS.checkout,
        receipt_number: "R-20260729-0001",
        business_date: "2026-07-29",
        currency: "BDT",
        scale: 2,
        total_minor: "999999999999999999",
        semantic_payload: { lines: [{ quantity: "1.25" }] },
        content_hash: "hash-1",
        render_status: "rendered",
        created_at: "2026-07-29T09:00:00.000Z",
      }]);
    },
  };

  const receipt = await new PosReceiptRepository().findReceipt(client, context(), "R-20260729-0001");
  assert.equal(receipt.totalMinor, "999999999999999999");
  assert.equal(receipt.receiptNumber, "R-20260729-0001");
  assert.match(calls[0].text, /WHERE tenant_id=\$1::uuid AND receipt_number=\$2/u);
  assert.deepEqual(calls[0].values, [IDS.tenant, "R-20260729-0001"]);
});

test("MOD-D receipt delivery validates masked destinations before database access", async () => {
  let queryCount = 0;
  const client = { async query() { queryCount += 1; return result(); } };
  const repository = new PosReceiptRepository();

  await assert.rejects(
    repository.requestDelivery(client, context(), {
      receiptSnapshotId: IDS.receipt,
      channel: "email",
      reason: "Customer requested a copy",
    }),
    /masked destination/u,
  );
  await assert.rejects(
    repository.requestDelivery(client, context(), {
      receiptSnapshotId: IDS.receipt,
      channel: "print",
      destinationMasked: "counter@example.test",
      reason: "Reprint",
    }),
    /must not include a destination/u,
  );
  assert.equal(queryCount, 0);
});

test("MOD-D receipt API separates lookup, print and remote-delivery permissions", async () => {
  const calls = [];
  const repository = {
    async findReceipt(_client, _context, reference) {
      calls.push({ kind: "lookup", reference });
      return { id: IDS.receipt, receiptNumber: reference, totalMinor: "1000" };
    },
    async requestDelivery(_client, _context, input) {
      calls.push({ kind: "delivery", input });
      return { id: "delivery-1", receiptSnapshotId: input.receiptSnapshotId, channel: input.channel, replayed: false };
    },
  };
  const db = database();

  const lookup = new Request("https://example.test/v1/pos/receipts/R-0001");
  const lookupResponse = await handlePosReceiptRequest(
    lookup,
    new URL(lookup.url),
    context(["pos.checkout.read"]),
    db,
    repository,
  );
  assert.equal(lookupResponse.status, 200);
  assert.equal(calls[0].reference, "R-0001");

  const print = new Request(`https://example.test/v1/pos/receipts/${IDS.receipt}/deliveries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel: "print", reason: "Customer requested a duplicate" }),
  });
  const printResponse = await handlePosReceiptRequest(
    print,
    new URL(print.url),
    context(["pos.receipt.reprint"]),
    db,
    repository,
  );
  assert.equal(printResponse.status, 202);
  assert.equal(calls[1].input.channel, "print");

  const email = new Request(`https://example.test/v1/pos/receipts/${IDS.receipt}/deliveries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channel: "email", destinationMasked: "r***@example.test", reason: "Email copy" }),
  });
  await assert.rejects(
    handlePosReceiptRequest(
      email,
      new URL(email.url),
      context(["pos.receipt.reprint"]),
      db,
      repository,
    ),
    /pos\.receipt\.deliver/u,
  );
});
