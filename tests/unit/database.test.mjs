import test from "node:test";
import assert from "node:assert/strict";
import { NeonDatabase } from "../../build/packages/foundation/src/db.js";
import { createFakeNeonLoader } from "../../build/packages/testing/src/neon-fake.js";

const context = {
  requestId: "018f0000-0000-7000-8000-000000000001",
  traceId: "trace-1",
  tenantId: "018f0000-0000-7000-8000-000000000002",
  actorId: "018f0000-0000-7000-8000-000000000003",
  locale: "en-GB",
  timeZone: "UTC",
  businessDate: "2026-07-28",
  region: "test",
  permissions: new Set(),
};

test("Request-scoped Client transaction sets RLS context and closes", async () => {
  const calls = [];
  const database = new NeonDatabase({ connectionString: "postgresql://example.invalid/db", loader: createFakeNeonLoader(calls) });
  await database.withClientTransaction(context, async (client) => {
    await client.query("SELECT 1");
  });
  assert.equal(calls[0].text, "<connect>");
  assert.ok(calls.some((call) => call.text.includes("platform.set_request_context")));
  assert.ok(calls.some((call) => call.text === "COMMIT"));
  assert.equal(calls.at(-1).text, "<end>");
});

test("Request-scoped Client rolls back and closes on failure", async () => {
  const calls = [];
  const database = new NeonDatabase({ connectionString: "postgresql://example.invalid/db", loader: createFakeNeonLoader(calls) });
  await assert.rejects(() => database.withClientTransaction(context, async () => { throw new Error("failure"); }), /failure/);
  assert.ok(calls.some((call) => call.text === "ROLLBACK"));
  assert.equal(calls.at(-1).text, "<end>");
});
