import assert from "node:assert/strict";
import test from "node:test";
import {
  isCloudflareWorkerQuotaError,
  isOwnedStorefrontPreviewWorker,
  selectStaleStorefrontPreviewWorkers,
} from "../../tooling/scripts/cloudflare-preview-retention.mjs";

const nowMs = Date.parse("2026-07-30T12:00:00.000Z");

function worker(id, modifiedOn) {
  return { id, modified_on: modifiedOn, created_on: modifiedOn };
}

test("Cloudflare preview retention accepts only repository-owned worker names", () => {
  assert.equal(isOwnedStorefrontPreviewWorker("store-pos-fnd-30533903525"), true);
  assert.equal(isOwnedStorefrontPreviewWorker("store-pos-fnd-1"), true);
  assert.equal(isOwnedStorefrontPreviewWorker("store-pos-fnd-"), false);
  assert.equal(isOwnedStorefrontPreviewWorker("store-pos-prod-30533903525"), false);
  assert.equal(isOwnedStorefrontPreviewWorker("store-pos-fnd-30533903525-extra"), false);
  assert.equal(isOwnedStorefrontPreviewWorker("another-worker"), false);
});

test("Cloudflare preview retention excludes current, recent, malformed and unrelated workers", () => {
  const selected = selectStaleStorefrontPreviewWorkers([
    worker("store-pos-fnd-100", "2026-07-29T00:00:00.000Z"),
    worker("store-pos-fnd-200", "2026-07-30T09:00:00.000Z"),
    worker("store-pos-fnd-300", "not-a-date"),
    worker("store-pos-fnd-400", "2026-07-29T01:00:00.000Z"),
    worker("merchant-production-worker", "2026-01-01T00:00:00.000Z"),
  ], {
    currentWorkerName: "store-pos-fnd-400",
    nowMs,
    minimumAgeMs: 6 * 60 * 60 * 1000,
    maxDeletions: 10,
  });

  assert.deepEqual(selected.map(({ id }) => id), ["store-pos-fnd-100"]);
});

test("Cloudflare preview retention deletes oldest eligible workers within a hard bound", () => {
  const selected = selectStaleStorefrontPreviewWorkers([
    worker("store-pos-fnd-300", "2026-07-29T03:00:00.000Z"),
    worker("store-pos-fnd-100", "2026-07-29T01:00:00.000Z"),
    worker("store-pos-fnd-200", "2026-07-29T02:00:00.000Z"),
  ], {
    nowMs,
    minimumAgeMs: 6 * 60 * 60 * 1000,
    maxDeletions: 2,
  });

  assert.deepEqual(selected.map(({ id }) => id), [
    "store-pos-fnd-100",
    "store-pos-fnd-200",
  ]);
});

test("Cloudflare quota detection is limited to the documented worker limit failure", () => {
  assert.equal(isCloudflareWorkerQuotaError({ error: "Cloudflare API code 10037" }), true);
  assert.equal(isCloudflareWorkerQuotaError({
    commandOutput: "You have exceeded the limit of 100 Workers on your account.",
  }), true);
  assert.equal(isCloudflareWorkerQuotaError({ error: "Cloudflare API code 10007" }), false);
  assert.equal(isCloudflareWorkerQuotaError({ error: "authentication failed" }), false);
});
