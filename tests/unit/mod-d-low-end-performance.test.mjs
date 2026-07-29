import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { renderRegisterWorkspace } from "../../build/apps/pos-web/src/modules/register/surface.js";
import {
  ScopedOfflineReceiptAllocator,
  reconcileOfflineStockClaims,
} from "../../build/modules/offline/src/risk-controls.js";

function elapsed(work) {
  const started = performance.now();
  const result = work();
  return { result, milliseconds: performance.now() - started };
}

test("large cashier cart renders inside the low-end regression budget", () => {
  const lines = Array.from({ length: 500 }, (_, index) => ({
    lineId: `line-${index + 1}`,
    name: `Representative product ${index + 1}`,
    variant: `Variant ${index % 12}`,
    quantity: String((index % 5) + 1),
    lineTotalMinor: BigInt((index + 1) * 125),
  }));
  const { result: html, milliseconds } = elapsed(() => renderRegisterWorkspace({
    locale: "en-US",
    currency: "USD",
    scale: 2,
    online: false,
    pendingOperations: 48,
    registerLabel: "Low-end register",
    shiftStatus: "open",
    cashierName: "Performance fixture",
    cartReference: "PERF-500",
    lines,
    subtotalMinor: 15_656_250n,
    discountMinor: 0n,
    taxMinor: 0n,
    payableMinor: 15_656_250n,
    tenders: [],
    canCheckout: true,
  }));

  assert.match(html, /Representative product 500/u);
  assert.ok(html.length > 100_000);
  assert.ok(milliseconds < 1_500, `500-line register render took ${milliseconds.toFixed(2)}ms`);
});

test("ten thousand offline stock claims reconcile deterministically inside the sync budget", () => {
  const claims = Array.from({ length: 10_000 }, (_, index) => ({
    operationId: `operation-${String(index + 1).padStart(5, "0")}`,
    deviceId: `device-${index % 20}`,
    registerId: `register-${index % 20}`,
    variantId: `variant-${index % 100}`,
    quantity: 1n,
    serverOrder: BigInt(index + 1),
    localReceiptSnapshotId: `receipt-${index + 1}`,
  }));
  const availability = new Map(
    Array.from({ length: 100 }, (_, index) => [`variant-${index}`, 50n]),
  );
  const { result: outcomes, milliseconds } = elapsed(
    () => reconcileOfflineStockClaims(claims, availability),
  );

  assert.equal(outcomes.length, 10_000);
  assert.equal(outcomes.filter((outcome) => outcome.state === "accepted").length, 5_000);
  assert.equal(outcomes.filter((outcome) => outcome.state === "rejected").length, 5_000);
  assert.ok(milliseconds < 2_000, `10,000 stock claims took ${milliseconds.toFixed(2)}ms`);
});

test("five thousand scoped receipt numbers allocate without duplication inside the local budget", () => {
  const allocator = new ScopedOfflineReceiptAllocator({
    allocationId: "performance-allocation",
    tenantId: "tenant-performance",
    storeId: "store-performance",
    registerId: "register-performance",
    deviceId: "device-performance",
    prefix: "PERF-",
    start: 1n,
    end: 5_000n,
    next: 1n,
    expiresAt: "2026-07-30T00:00:00.000Z",
    countryAllowsOfflineReceipt: true,
    requiresOnlineFiscalization: false,
  });
  const scope = {
    tenantId: "tenant-performance",
    storeId: "store-performance",
    registerId: "register-performance",
    deviceId: "device-performance",
  };
  const { result: numbers, milliseconds } = elapsed(() => Array.from(
    { length: 5_000 },
    () => allocator.allocate(scope, "2026-07-29T12:00:00.000Z").receiptNumber,
  ));

  assert.equal(new Set(numbers).size, 5_000);
  assert.equal(numbers[0], "PERF-1");
  assert.equal(numbers.at(-1), "PERF-5000");
  assert.equal(allocator.snapshot().next, 5_001n);
  assert.ok(milliseconds < 1_000, `5,000 receipt allocations took ${milliseconds.toFixed(2)}ms`);
});
