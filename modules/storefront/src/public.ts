import { NeonDatabase } from "../../../packages/foundation/src/index.js";
import {
  normalizeStorefrontHostname,
  parseStorefrontBootstrapV1,
  type StorefrontBootstrapV1,
} from "../../../packages/storefront-contracts/src/index.js";
import {
  parseStorefrontPublicContentBundleV1,
  type StorefrontPublicContentBundleV1,
} from "../../../packages/storefront-contracts/src/public-content.js";

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

interface PublicContentRow extends PublicHostRow {
  readonly themeDocument: Readonly<Record<string, unknown>>;
  readonly navigationDocument: Readonly<Record<string, unknown>>;
  readonly homepageDocument: Readonly<Record<string, unknown>>;
  readonly homepageSeoDocument: Readonly<Record<string, unknown>>;
  readonly contentPageSlug: string | null;
  readonly contentPageTitle: string | null;
  readonly contentPageRevision: string | null;
  readonly contentPageDocument: Readonly<Record<string, unknown>> | null;
  readonly contentPageSeoDocument: Readonly<Record<string, unknown>> | null;
}

export interface StorefrontPublicRepository {
  resolveBootstrap(hostname: string): Promise<StorefrontBootstrapV1 | null>;
  resolveContentBundle(
    hostname: string,
    contentSlug?: string,
  ): Promise<StorefrontPublicContentBundleV1 | null>;
}

const PUBLIC_SLUG = /^[a-z0-9](?:[a-z0-9._~-]{0,178}[a-z0-9])?$/u;

function normalizeContentSlug(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (!PUBLIC_SLUG.test(normalized) || normalized === "." || normalized === "..") {
    throw new TypeError("Public content slug is invalid.");
  }
  return normalized;
}

function context(row: PublicHostRow): Record<string, string> {
  return {
    tenantId: row.tenantId,
    storefrontId: row.storefrontId,
    salesChannelId: row.salesChannelId,
    requestHostname: row.requestHostname,
    canonicalHostname: row.canonicalHostname,
    locale: row.locale,
    currency: row.currency,
    priceListRevision: row.priceListRevision,
    publicationGeneration: row.publicationGeneration,
  };
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
      context: context(row),
      themeRevision: row.themeRevision,
      layoutRevision: row.layoutRevision,
      capabilities: row.capabilities,
    });
    if (bootstrap.context.requestHostname !== normalized) {
      throw new Error("Public storefront host resolution returned a mismatched hostname.");
    }
    return bootstrap;
  }

  public async resolveContentBundle(
    hostname: string,
    contentSlug?: string,
  ): Promise<StorefrontPublicContentBundleV1 | null> {
    const normalized = normalizeStorefrontHostname(hostname);
    const normalizedSlug = normalizeContentSlug(contentSlug);
    const rows = await this.database.httpQuery<PublicContentRow>(
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
        theme_document AS "themeDocument",
        navigation_document AS "navigationDocument",
        homepage_document AS "homepageDocument",
        homepage_seo_document AS "homepageSeoDocument",
        content_page_slug AS "contentPageSlug",
        content_page_title AS "contentPageTitle",
        content_page_revision AS "contentPageRevision",
        content_page_document AS "contentPageDocument",
        content_page_seo_document AS "contentPageSeoDocument"
      FROM storefront.resolve_public_content_bundle($1::text, $2::text)`,
      [normalized, normalizedSlug],
    );
    const row = rows[0];
    if (!row) return null;
    const bundle = parseStorefrontPublicContentBundleV1({
      contractVersion: "storefront-public-content.v1",
      context: context(row),
      themeRevision: row.themeRevision,
      layoutRevision: row.layoutRevision,
      theme: row.themeDocument,
      navigation: row.navigationDocument,
      homepage: row.homepageDocument,
      homepageSeo: row.homepageSeoDocument,
      page: row.contentPageSlug === null
        ? null
        : {
            slug: row.contentPageSlug,
            title: row.contentPageTitle,
            revision: row.contentPageRevision,
            content: row.contentPageDocument,
            seo: row.contentPageSeoDocument ?? {},
          },
    });
    if (bundle.context.requestHostname !== normalized) {
      throw new Error("Public storefront content resolution returned a mismatched hostname.");
    }
    return bundle;
  }
}
