import { NeonDatabase } from "../../../packages/foundation/src/index.js";
import { normalizeStorefrontHostname } from "../../../packages/storefront-contracts/src/index.js";
import {
  parseStorefrontPublicSeoBundleV1,
  type StorefrontPublicSeoBundleV1,
} from "../../../packages/storefront-contracts/src/public-seo.js";

interface PublicSeoRow extends Record<string, unknown> {
  readonly tenantId: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly requestHostname: string;
  readonly canonicalHostname: string;
  readonly locale: string;
  readonly currency: string;
  readonly priceListRevision: string;
  readonly publicationGeneration: string;
  readonly indexable: boolean;
  readonly sitemapPath: string;
  readonly disallowPaths: readonly string[];
  readonly entryDocuments: readonly unknown[];
}

export async function resolveStorefrontPublicSeo(
  database: NeonDatabase,
  hostname: string,
): Promise<StorefrontPublicSeoBundleV1 | null> {
  const normalized = normalizeStorefrontHostname(hostname);
  const rows = await database.httpQuery<PublicSeoRow>(
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
      indexable,
      sitemap_path AS "sitemapPath",
      disallow_paths AS "disallowPaths",
      entry_documents AS "entryDocuments"
    FROM storefront.resolve_public_seo($1::text)`,
    [normalized],
  );
  const row = rows[0];
  if (!row) return null;

  const bundle = parseStorefrontPublicSeoBundleV1({
    contractVersion: "storefront-public-seo.v1",
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
    indexable: row.indexable,
    sitemapPath: row.sitemapPath,
    disallow: row.disallowPaths,
    entries: row.entryDocuments,
  });
  if (bundle.context.requestHostname !== normalized) {
    throw new Error("Public storefront SEO resolution returned a mismatched hostname.");
  }
  return bundle;
}
