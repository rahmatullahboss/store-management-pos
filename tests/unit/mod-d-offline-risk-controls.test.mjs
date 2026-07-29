import assert from "node:assert/strict";
import test from "node:test";
import {
  ScopedOfflineReceiptAllocator,
  assessProjectionFreshness,
  reconcileOfflineStockClaims,
} from "../../build/modules/offline/src/risk-controls.js";

test("stale price tax and promotion are explicit review while permission staleness blocks checkout", () => {
  const review = assessProjectionFreshness([
    { projection: "price", requiredVersion: "price-12", localVersion: "price-11", stalePolicy: "review" },
    { projection: "tax", requiredVersion: "tax-8", localVersion: "tax-7", stalePolicy: "review" },
    { projection: "promotion", requiredVersion: "promotion-4", localVersion: "promotion-3", stalePolicy: "review" },
    { projection: "permission", requiredVersion: "permission-20", localVersion: "permission-20", stalePolicy: "block" },
  ]);
  assert.equal(review.allowed, true);
  assert.equal(review.reviewRequired, true);
  assert.deepEqual(review.stale.map((entry) => entry.projection), ["price", "tax", "promotion"]);

  const blocked = assessProjectionFreshness([
    { projection: "price", requiredVersion: "price-12", localVersion: "price-12", stalePolicy: "review" },
    { projection: "permission", requiredVersion: "permission-21", localVersion: "permission-20", stalePolicy: "block" },
    { projection: "country_capability", requiredVersion: "country-6", stalePolicy: "block" },
  ]);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reviewRequired, false);
  assert.deepEqual(blocked.stale.map((entry) => entry.projection), ["permission", "country_capability"]);
});

test("final physical unit is accepted once and the competing register receipt remains immutable evidence", () => {
  const outcomes = reconcileOfflineStockClaims([
    {
      operationId: "sale-register-b",
      deviceId: "device-b",
      registerId: "register-b",
      variantId: "variant-final-unit",
      quantity: 1n,
      serverOrder: 2n,
      localReceiptSnapshotId: "receipt-b",
    },
    {
      operationId: "sale-register-a",
      deviceId: "device-a",
      registerId: "register-a",
      variantId: "variant-final-unit",
      quantity: 1n,
      serverOrder: 1n,
      localReceiptSnapshotId: "receipt-a",
    },
  ], new Map([["variant-final-unit", 1n]]));

  assert.deepEqual(outcomes.map((outcome) => outcome.operationId), ["sale-register-a", "sale-register-b"]);
  assert.equal(outcomes[0].state, "accepted");
  assert.equal(outcomes[0].remainingQuantity, 0n);
  assert.equal(outcomes[1].state, "rejected");
  assert.equal(outcomes[1].reasonCode, "FINAL_UNIT_STOCK_CONFLICT");
  assert.equal(outcomes[1].localReceiptSnapshotId, "receipt-b");
});

function allocation(overrides = {}) {
  return {
    allocationId: "allocation-1",
    tenantId: "tenant-1",
    storeId: "store-1",
    registerId: "register-1",
    deviceId: "device-1",
    prefix: "BD-DHK-",
    start: 9001n,
    end: 9002n,
    next: 9001n,
    expiresAt: "2026-07-30T00:00:00.000Z",
    countryAllowsOfflineReceipt: true,
    requiresOnlineFiscalization: false,
    ...overrides,
  };
}

const scope = Object.freeze({
  tenantId: "tenant-1",
  storeId: "store-1",
  registerId: "register-1",
  deviceId: "device-1",
});

test("offline receipt allocation is unique, scoped and refuses exhaustion", () => {
  const allocator = new ScopedOfflineReceiptAllocator(allocation());
  const first = allocator.allocate(scope, "2026-07-29T10:00:00.000Z");
  const second = allocator.allocate(scope, "2026-07-29T10:01:00.000Z");
  assert.equal(first.receiptNumber, "BD-DHK-9001");
  assert.equal(first.remaining, 1n);
  assert.equal(second.receiptNumber, "BD-DHK-9002");
  assert.equal(second.remaining, 0n);
  assert.throws(
    () => allocator.allocate(scope, "2026-07-29T10:02:00.000Z"),
    /allocation is exhausted/i,
  );
  assert.equal(allocator.snapshot().next, 9003n);
});

test("receipt allocation rejects another device, expiry and country online-fiscal restriction", () => {
  const scoped = new ScopedOfflineReceiptAllocator(allocation());
  assert.throws(
    () => scoped.allocate({ ...scope, deviceId: "device-2" }, "2026-07-29T10:00:00.000Z"),
    /outside the current tenant\/store\/register\/device scope/i,
  );

  const expired = new ScopedOfflineReceiptAllocator(allocation({ expiresAt: "2026-07-29T10:00:00.000Z" }));
  assert.throws(
    () => expired.allocate(scope, "2026-07-29T10:00:00.000Z"),
    /allocation has expired/i,
  );

  const fiscalOnlineOnly = new ScopedOfflineReceiptAllocator(allocation({ requiresOnlineFiscalization: true }));
  assert.throws(
    () => fiscalOnlineOnly.allocate(scope, "2026-07-29T09:59:59.000Z"),
    /requires online receipt fiscalization/i,
  );
  assert.equal(fiscalOnlineOnly.snapshot().next, 9001n);
});
