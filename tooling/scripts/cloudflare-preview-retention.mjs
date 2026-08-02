export const STOREFRONT_PREVIEW_WORKER_PATTERN = /^store-pos-fnd-\d{1,14}$/u;
export const DEFAULT_STALE_PREVIEW_AGE_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_MAX_PREVIEW_DELETIONS = 20;

export function isOwnedStorefrontPreviewWorker(workerName) {
  return typeof workerName === "string" && STOREFRONT_PREVIEW_WORKER_PATTERN.test(workerName);
}

function workerTimestamp(worker) {
  const raw = worker?.modified_on ?? worker?.created_on;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function selectStaleStorefrontPreviewWorkers(
  workers,
  {
    currentWorkerName = null,
    nowMs = Date.now(),
    minimumAgeMs = DEFAULT_STALE_PREVIEW_AGE_MS,
    maxDeletions = DEFAULT_MAX_PREVIEW_DELETIONS,
  } = {},
) {
  if (!Array.isArray(workers)) return [];
  if (!Number.isFinite(nowMs)) throw new TypeError("Cloudflare retention nowMs is invalid");
  if (!Number.isFinite(minimumAgeMs) || minimumAgeMs < 0) {
    throw new TypeError("Cloudflare retention minimumAgeMs is invalid");
  }
  if (!Number.isInteger(maxDeletions) || maxDeletions < 1 || maxDeletions > 50) {
    throw new TypeError("Cloudflare retention maxDeletions is invalid");
  }

  return workers
    .map((worker) => ({
      id: typeof worker?.id === "string" ? worker.id : "",
      createdOn: typeof worker?.created_on === "string" ? worker.created_on : null,
      modifiedOn: typeof worker?.modified_on === "string" ? worker.modified_on : null,
      timestamp: workerTimestamp(worker),
    }))
    .filter((worker) =>
      isOwnedStorefrontPreviewWorker(worker.id) &&
      worker.id !== currentWorkerName &&
      worker.timestamp !== null &&
      nowMs - worker.timestamp >= minimumAgeMs
    )
    .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id))
    .slice(0, maxDeletions)
    .map(({ timestamp: _timestamp, ...worker }) => Object.freeze(worker));
}

export function isCloudflareWorkerQuotaError(report) {
  const text = `${report?.error ?? ""}\n${report?.commandOutput ?? ""}`.toLowerCase();
  return text.includes("10037") || text.includes("exceeded the limit of 100 workers");
}
