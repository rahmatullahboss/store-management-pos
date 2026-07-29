import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const baseUrl = new URL(
  "../../database/modules/pos/migrations/POS-0003-offline-sync-security.sql",
  import.meta.url,
);
const deliveryUrl = new URL(
  "../../database/modules/pos/migrations/POS-0008-receipt-delivery.sql",
  import.meta.url,
);

async function sources() {
  const [base, delivery] = await Promise.all([
    readFile(baseUrl, "utf8"),
    readFile(deliveryUrl, "utf8"),
  ]);
  return { base, delivery };
}

test("receipt delivery request storage is created once and upgraded additively", async () => {
  const { base, delivery } = await sources();
  assert.match(base, /CREATE TABLE pos\.receipt_delivery_requests/u);
  assert.doesNotMatch(delivery, /CREATE TABLE pos\.receipt_delivery_requests/u);
  assert.match(delivery, /ALTER TABLE pos\.receipt_delivery_requests/u);
  assert.match(delivery, /ADD COLUMN reason text NOT NULL/u);
  assert.match(delivery, /VALIDATE CONSTRAINT receipt_delivery_requests_masked_destination/u);
});

test("receipt delivery command preserves the original immutable idempotency columns", async () => {
  const { delivery } = await sources();
  assert.match(delivery, /request\.idempotency_key = v_request_id/u);
  assert.match(delivery, /request_hash IS DISTINCT FROM v_request_hash/u);
  assert.match(delivery, /INSERT INTO pos\.receipt_delivery_requests/u);
  assert.match(delivery, /idempotency_key, request_hash, reason/u);
  assert.match(delivery, /receipt delivery request ID was reused with different content/u);
  assert.match(delivery, /pos\.receipt\.delivery\.requested\.v1/u);
  assert.match(delivery, /REVOKE ALL ON FUNCTION pos\.request_receipt_delivery_v1/u);
  assert.match(delivery, /VALUES \('POS-0008'/u);
});
