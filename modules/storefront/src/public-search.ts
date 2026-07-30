import type { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { StorefrontContractError } from "../../../packages/storefront-contracts/src/index.js";
import {
  parseStorefrontPublicSearchPageV1,
  type StorefrontPublicAvailabilityFacetValueV1,
  type StorefrontPublicSearchPageV1,
} from "../../../packages/storefront-contracts/src/public-discovery.js";

export interface StorefrontPublicSearchRequestOptions {
  readonly category?: string;
  readonly availability?: StorefrontPublicAvailabilityFacetValueV1;
  readonly limit?: number;
  readonly cursor?: string;
}

interface StorefrontPublicSearchRow extends Record<string, unknown> {
  readonly tenantId: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly requestHostname: string;
  readonly canonicalHostname: string;
  readonly locale: string;
  readonly currency: string;
  readonly priceListRevision: string;
  readonly publicationGeneration: string;
  readonly normalizedQuery: string;
  readonly productDocuments: unknown;
  readonly facetsDocument: unknown;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const AVAILABILITY = new Set<StorefrontPublicAvailabilityFacetValueV1>([
  "available",
  "limited",
  "unavailable",
  "preorder",
  "unknown",
]);

function normalizeHostname(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.$/u, "");
  if (!HOSTNAME_PATTERN.test(normalized)) {
    throw new StorefrontContractError("Storefront search hostname is invalid.");
  }
  return normalized;
}

function normalizeQuery(value: string): string {
  const normalized = value.trim();
  if (
    [...normalized].length < 2 ||
    [...normalized].length > 120 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new StorefrontContractError("Storefront search query is invalid.");
  }
  return normalized;
}

function normalizeCategory(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();
  if (!SLUG_PATTERN.test(normalized) || normalized === "." || normalized === "..") {
    throw new StorefrontContractError("Storefront search category is invalid.");
  }
  return normalized;
}

function normalizeAvailability(
  value: StorefrontPublicAvailabilityFacetValueV1 | undefined,
): StorefrontPublicAvailabilityFacetValueV1 | null {
  if (value === undefined) return null;
  if (!AVAILABILITY.has(value)) {
    throw new StorefrontContractError("Storefront search availability is invalid.");
  }
  return value;
}

function normalizeLimit(value: number | undefined): number {
  const normalized = value ?? 24;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 48) {
    throw new StorefrontContractError("Storefront search limit is invalid.");
  }
  return normalized;
}

function normalizeCursor(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new StorefrontContractError("Storefront search cursor is invalid.");
  }
  return normalized;
}

export async function resolveStorefrontPublicSearch(
  database: NeonDatabase,
  hostname: string,
  query: string,
  options: StorefrontPublicSearchRequestOptions = {},
): Promise<StorefrontPublicSearchPageV1 | null> {
  const normalizedHostname = normalizeHostname(hostname);
  const normalizedQuery = normalizeQuery(query);
  const category = normalizeCategory(options.category);
  const availability = normalizeAvailability(options.availability);
  const limit = normalizeLimit(options.limit);
  const cursor = normalizeCursor(options.cursor);
  const rows = await database.httpQuery<StorefrontPublicSearchRow>(
    `SELECT
       tenant_id AS "tenantId",
       storefront_id AS "storefrontId",
       sales_channel_id AS "salesChannelId",
       request_hostname AS "requestHostname",
       canonical_hostname AS "canonicalHostname",
       locale,
       currency,
       price_list_revision AS "priceListRevision",
       publication_generation AS "publicationGeneration",
       normalized_query AS "normalizedQuery",
       product_documents AS "productDocuments",
       facets_document AS "facetsDocument",
       next_cursor AS "nextCursor",
       has_more AS "hasMore"
     FROM storefront.resolve_public_search($1, $2, $3, $4, $5, $6)`,
    [normalizedHostname, normalizedQuery, category, availability, limit, cursor],
  );
  const row = rows[0];
  if (!row) return null;
  return parseStorefrontPublicSearchPageV1({
    contractVersion: "storefront-public-search.v1",
    context: {
      tenantId: row.tenantId,
      storefrontId: row.storefrontId,
      salesChannelId: row.salesChannelId,
      requestHostname: row.requestHostname,
      canonicalHostname: row.canonicalHostname,
      locale: row.locale,
      currency: row.currency,
      priceListRevision: row.priceListRevision,
      publicationGeneration: row.publicationGeneration,
    },
    query: row.normalizedQuery,
    items: row.productDocuments,
    facets: row.facetsDocument,
    nextCursor: row.nextCursor,
    hasMore: row.hasMore,
  });
}
