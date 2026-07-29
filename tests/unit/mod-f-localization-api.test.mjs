import assert from "node:assert/strict";
import test from "node:test";
import { handleLocalizationRequest } from "../../build/apps/api/src/modules/localization/handler.js";

const context = {
  requestId: "018f0000-0000-7000-8000-000000000001",
  traceId: "trace-localization-api",
  tenantId: "018f0000-0000-7000-8000-000000000002",
  actorId: "018f0000-0000-7000-8000-000000000003",
  legalEntityId: "018f0000-0000-7000-8000-000000000004",
  storeId: "018f0000-0000-7000-8000-000000000005",
  deviceId: "018f0000-0000-7000-8000-000000000006",
  locale: "bn-BD",
  timeZone: "Asia/Dhaka",
  businessDate: "2026-07-29",
  region: "test",
  permissions: new Set([
    "localization.pack.read",
    "localization.pack.activate",
    "localization.number.allocate",
  ]),
};

function fakeDatabase() {
  return {
    async withClientTransaction(_context, work) {
      return await work({
        async query(text, values) {
          if (text.includes("activate_country_pack")) {
            return { rows: [{ activation_id: values[0], replayed: false }], rowCount: 1 };
          }
          if (text.includes("allocate_legal_number")) {
            return { rows: [{ allocation_id: values[0], legal_number: "BD-000001", numeric_value: "1", replayed: false }], rowCount: 1 };
          }
          return {
            rows: [{
              activation_id: "028f0000-0000-7000-8000-000000000010",
              pack_version_id: "028f0000-0000-7000-8000-000000000011",
              pack_id: "country.bd",
              country_code: "BD",
              pack_version: "1.0.0",
              support_level: "limited",
              default_locale: "bn-BD",
              effective_from: "2026-01-01",
              effective_to: null,
              capabilities: { legalReceipts: true },
              currencies: [{
                currency: "BDT",
                accountingScale: 2,
                cashIncrementMinor: "100",
                cashRoundingMode: "nearest",
                metadataVersion: "bdt-2026-v1",
              }],
              boundaries: [{ timeZone: "Asia/Dhaka", localStartTime: "06:00:00", boundaryVersion: "bd-boundary-v1" }],
            }],
            rowCount: 1,
          };
        },
      });
    },
  };
}

async function json(response) {
  return await response.json();
}

test("localization API activates packs and allocates legal numbers idempotently", async () => {
  const database = fakeDatabase();
  const activationRequest = new Request("https://api.test/v1/localization/activations", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "localization-activation-001" },
    body: JSON.stringify({
      activationId: "028f0000-0000-7000-8000-000000000001",
      packVersionId: "028f0000-0000-7000-8000-000000000002",
      effectiveFrom: "2026-08-01",
      reason: "Approved rollout",
    }),
  });
  const activation = await handleLocalizationRequest(activationRequest, new URL(activationRequest.url), context, database);
  assert.equal(activation.status, 201);
  assert.equal((await json(activation)).data.activationId, "028f0000-0000-7000-8000-000000000001");

  const allocationRequest = new Request("https://api.test/v1/localization/legal-number-scopes/028f0000-0000-7000-8000-000000000003/allocations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      allocationId: "028f0000-0000-7000-8000-000000000004",
      operationId: "receipt-operation-001",
      allocationMode: "offline_block",
    }),
  });
  const allocation = await handleLocalizationRequest(allocationRequest, new URL(allocationRequest.url), context, database);
  assert.equal(allocation.status, 201);
  assert.equal((await json(allocation)).data.legalNumber, "BD-000001");
});

test("localization API returns effective pack configuration and validates routing inputs", async () => {
  const database = fakeDatabase();
  const request = new Request("https://api.test/v1/localization/effective-configuration?onDate=2026-07-29");
  const response = await handleLocalizationRequest(request, new URL(request.url), context, database);
  assert.equal(response.status, 200);
  const body = await json(response);
  assert.equal(body.data.packId, "country.bd");
  assert.equal(body.data.currencies[0].currency, "BDT");

  const unrelated = new Request("https://api.test/v1/localization/unknown");
  assert.equal(await handleLocalizationRequest(unrelated, new URL(unrelated.url), context, database), null);

  const invalid = new Request("https://api.test/v1/localization/activations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      packVersionId: "028f0000-0000-7000-8000-000000000002",
      effectiveFrom: "2026-08-01",
      reason: "Missing idempotency key",
    }),
  });
  await assert.rejects(
    () => handleLocalizationRequest(invalid, new URL(invalid.url), context, database),
    /idempotency-key header is required/i,
  );
});
