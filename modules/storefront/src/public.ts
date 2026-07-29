import { NeonDatabase } from "../../../packages/foundation/src/index.js";
import {
  normalizeStorefrontHostname,
  parseStorefrontBootstrapV1,
  type StorefrontBootstrapV1,
} from "../../../packages/storefront-contracts/src/index.js";

interface PublicHostRow extends Record<string, unknown> {
  readonly tenantId: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly requestHostname: string;
  readonly canonicalHostname: string;
  readonly locale: string;
  readonly currency: string;
  readonly priceListRevision: string;
  readonly publicationGeneration: string;
  readonly themeRevision: string;
  readonly layoutRevision: string;
  readonly capabilities: readonly string[];
}

export interface StorefrontPublicRepository {
  resolveBootstrap(hostname: string): Promise<StorefrontBootstrapV1 | null>;
}

export class SqlStorefrontPublicRepository implements StorefrontPublicRepository {
  public constructor(private readonly database: NeonDatabase) {}

  public async resolveBootstrap(hostname: string): Promise<StorefrontBootstrapV1 | null> {
    const normalized = normalizeStorefrontHostname(hostname);
    const rows = await this.database.httpQuery<PublicHostRow>(
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
        theme_revision AS "themeRevision",
        layout_revision AS "layoutRevision",
        capabilities
      FROM storefront.resolve_public_host($1::text)`,
      [normalized],
    );
    const row = rows[0];
    if (!row) return null;
    const bootstrap = parseStorefrontBootstrapV1({
      contractVersion: "storefront-bootstrap.v1",
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
      themeRevision: row.themeRevision,
      layoutRevision: row.layoutRevision,
      capabilities: row.capabilities,
    });
    if (bootstrap.context.requestHostname !== normalized) {
      throw new Error("Public storefront host resolution returned a mismatched hostname.");
    }
    return bootstrap;
  }
}
