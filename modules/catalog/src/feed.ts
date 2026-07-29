export interface CatalogFeedCursor {
  readonly updatedAt: string;
  readonly variantId: string;
}

export interface CatalogFeedEntry {
  readonly productId: string;
  readonly variantId: string;
  readonly productCode: string;
  readonly sku: string;
  readonly displayName: string;
  readonly variantTitle: string;
  readonly status: string;
  readonly unitCode: string;
  readonly taxCode?: string;
  readonly barcodes: readonly string[];
  readonly version: bigint;
  readonly updatedAt: string;
}

export interface CatalogFeedPage {
  readonly schemaVersion: "1.0";
  readonly snapshotAt: string;
  readonly entries: readonly CatalogFeedEntry[];
  readonly nextCursor?: string;
  readonly hasMore: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedInstant(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError(`${field} is invalid`);
  return date.toISOString();
}

export function encodeCatalogFeedCursor(cursor: CatalogFeedCursor): string {
  const updatedAt = normalizedInstant(cursor.updatedAt, "Catalog feed cursor updatedAt");
  if (!UUID_PATTERN.test(cursor.variantId)) throw new TypeError("Catalog feed cursor variantId is invalid");
  return `${updatedAt}|${cursor.variantId.toLowerCase()}`;
}

export function decodeCatalogFeedCursor(value: string): CatalogFeedCursor {
  const separator = value.lastIndexOf("|");
  if (separator <= 0 || separator === value.length - 1) throw new TypeError("Catalog feed cursor is invalid");
  const updatedAt = normalizedInstant(value.slice(0, separator), "Catalog feed cursor updatedAt");
  const variantId = value.slice(separator + 1);
  if (!UUID_PATTERN.test(variantId)) throw new TypeError("Catalog feed cursor variantId is invalid");
  return Object.freeze({ updatedAt, variantId: variantId.toLowerCase() });
}

function compareEntry(left: CatalogFeedEntry, right: CatalogFeedEntry): number {
  const updated = left.updatedAt.localeCompare(right.updatedAt);
  return updated !== 0 ? updated : left.variantId.localeCompare(right.variantId);
}

export function buildCatalogFeedPage(input: {
  readonly entries: readonly CatalogFeedEntry[];
  readonly snapshotAt: string;
  readonly cursor?: string;
  readonly limit?: number;
}): CatalogFeedPage {
  const snapshotAt = normalizedInstant(input.snapshotAt, "Catalog feed snapshotAt");
  const limit = input.limit ?? 500;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError("Catalog feed limit must be between 1 and 500");
  const cursor = input.cursor === undefined ? undefined : decodeCatalogFeedCursor(input.cursor);
  const sorted = input.entries
    .map((entry) => Object.freeze({ ...entry, updatedAt: normalizedInstant(entry.updatedAt, "Catalog feed entry updatedAt"), barcodes: Object.freeze([...entry.barcodes]) }))
    .filter((entry) => entry.updatedAt <= snapshotAt)
    .filter((entry) => cursor === undefined || entry.updatedAt > cursor.updatedAt || (entry.updatedAt === cursor.updatedAt && entry.variantId > cursor.variantId))
    .sort(compareEntry);
  const hasMore = sorted.length > limit;
  const entries = Object.freeze(sorted.slice(0, limit));
  const last = entries.at(-1);
  return Object.freeze({
    schemaVersion: "1.0",
    snapshotAt,
    entries,
    ...(hasMore && last !== undefined ? { nextCursor: encodeCatalogFeedCursor({ updatedAt: last.updatedAt, variantId: last.variantId }) } : {}),
    hasMore,
  });
}
