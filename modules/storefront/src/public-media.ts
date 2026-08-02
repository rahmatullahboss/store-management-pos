import { NeonDatabase } from "../../../packages/foundation/src/index.js";
import {
  normalizeStorefrontHostname,
} from "../../../packages/storefront-contracts/src/index.js";
import {
  parseStorefrontPublicMediaManifestV1,
  type StorefrontPublicMediaManifestV1,
} from "../../../packages/storefront-contracts/src/public-media.js";

interface PublicMediaRow extends Record<string, unknown> {
  readonly tenantId: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly requestHostname: string;
  readonly canonicalHostname: string;
  readonly locale: string;
  readonly currency: string;
  readonly priceListRevision: string;
  readonly publicationGeneration: string;
  readonly productId: string;
  readonly publicSlug: string;
  readonly mediaRevision: string;
  readonly mediaDocuments: readonly unknown[];
}

const SLUG = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u;

function normalizeSlug(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SLUG.test(normalized) || normalized === "." || normalized === "..") {
    throw new TypeError("Public media product slug is invalid.");
  }
  return normalized;
}

export interface StorefrontPublicMediaRepository {
  resolveProductMedia(
    hostname: string,
    publicSlug: string,
  ): Promise<StorefrontPublicMediaManifestV1 | null>;
}

export class SqlStorefrontPublicMediaRepository
  implements StorefrontPublicMediaRepository {
  public constructor(private readonly database: NeonDatabase) {}

  public async resolveProductMedia(
    hostname: string,
    publicSlug: string,
  ): Promise<StorefrontPublicMediaManifestV1 | null> {
    const normalizedHostname = normalizeStorefrontHostname(hostname);
    const normalizedSlug = normalizeSlug(publicSlug);
    const rows = await this.database.httpQuery<PublicMediaRow>(
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
        product_id::text AS "productId",
        public_slug AS "publicSlug",
        media_revision AS "mediaRevision",
        media_documents AS "mediaDocuments"
      FROM storefront.resolve_public_product_media($1::text, $2::text)`,
      [normalizedHostname, normalizedSlug],
    );
    const row = rows[0];
    if (!row) return null;
    const manifest = parseStorefrontPublicMediaManifestV1({
      contractVersion: "storefront-public-media.v1",
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
      productId: row.productId,
      slug: row.publicSlug,
      revision: row.mediaRevision,
      items: row.mediaDocuments,
    });
    if (
      manifest.context.requestHostname !== normalizedHostname ||
      manifest.slug !== normalizedSlug
    ) {
      throw new Error("Public media resolution returned a mismatched storefront scope.");
    }
    return manifest;
  }
}
