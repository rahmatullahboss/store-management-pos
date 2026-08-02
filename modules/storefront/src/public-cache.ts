import { NeonDatabase } from "../../../packages/foundation/src/index.js";
import { normalizeStorefrontHostname } from "../../../packages/storefront-contracts/src/index.js";
import {
  parseStorefrontPublicCacheGenerationBundleV1,
  type StorefrontPublicCacheGenerationBundleV1,
} from "../../../packages/storefront-contracts/src/public-cache.js";

interface PublicCacheRow extends Record<string, unknown> {
  readonly tenantId: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly requestHostname: string;
  readonly canonicalHostname: string;
  readonly locale: string;
  readonly currency: string;
  readonly priceListRevision: string;
  readonly publicationGeneration: string;
  readonly generationDocuments: Readonly<Record<string, unknown>>;
}

export interface StorefrontPublicCacheRepository {
  resolveGenerations(
    hostname: string,
  ): Promise<StorefrontPublicCacheGenerationBundleV1 | null>;
}

export class SqlStorefrontPublicCacheRepository
  implements StorefrontPublicCacheRepository {
  public constructor(private readonly database: NeonDatabase) {}

  public async resolveGenerations(
    hostname: string,
  ): Promise<StorefrontPublicCacheGenerationBundleV1 | null> {
    const normalized = normalizeStorefrontHostname(hostname);
    const rows = await this.database.httpQuery<PublicCacheRow>(
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
        generation_documents AS "generationDocuments"
      FROM storefront.resolve_public_cache_generations($1::text)`,
      [normalized],
    );
    const row = rows[0];
    if (!row) return null;
    const bundle = parseStorefrontPublicCacheGenerationBundleV1({
      contractVersion: "storefront-public-cache-generations.v1",
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
      generations: row.generationDocuments,
    });
    if (bundle.context.requestHostname !== normalized) {
      throw new Error("Public cache generation resolution returned a mismatched hostname.");
    }
    return bundle;
  }
}
