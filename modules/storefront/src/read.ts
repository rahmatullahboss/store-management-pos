import {
  NeonDatabase,
  requirePermission,
  type RequestContext,
  type TransactionClient,
} from "../../../packages/foundation/src/index.js";
import type {
  StorefrontDomainStatus,
  StorefrontLifecycleStatus,
  StorefrontPublicationState,
} from "./index.js";

export interface StorefrontReadPage {
  readonly limit: number;
  readonly afterId?: string;
}

export interface StorefrontListFilter extends StorefrontReadPage {
  readonly status?: StorefrontLifecycleStatus;
}

export interface ProductPublicationListFilter extends StorefrontReadPage {
  readonly state?: StorefrontPublicationState;
}

export interface StorefrontSummary {
  readonly id: string;
  readonly legalEntityId: string;
  readonly primaryStoreId: string | null;
  readonly code: string;
  readonly displayName: string;
  readonly status: StorefrontLifecycleStatus;
  readonly defaultLocale: string;
  readonly defaultCurrency: string;
  readonly timeZone: string;
  readonly platformSubdomain: string | null;
  readonly version: bigint;
  readonly updatedAt: string;
}

export interface SalesChannelSummary {
  readonly id: string;
  readonly storefrontId: string;
  readonly code: string;
  readonly displayName: string;
  readonly status: StorefrontLifecycleStatus;
  readonly priceListId: string;
  readonly allowedCountryCodes: readonly string[];
  readonly guestCheckoutEnabled: boolean;
  readonly customerAccountsEnabled: boolean;
  readonly backorderPolicy: "deny" | "allow" | "preorder_only";
  readonly version: bigint;
  readonly updatedAt: string;
}

export interface DomainSummary {
  readonly id: string;
  readonly storefrontId: string;
  readonly hostname: string;
  readonly domainKind: "platform_subdomain" | "custom";
  readonly status: StorefrontDomainStatus;
  readonly canonical: boolean;
  readonly verificationMethod: "dns_txt" | "dns_cname" | "http" | null;
  readonly certificateStatus: "none" | "pending" | "active" | "expiring" | "failed" | "revoked";
  readonly failureCode: string | null;
  readonly version: bigint;
  readonly updatedAt: string;
}

export interface ProductPublicationSummary {
  readonly id: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly productId: string;
  readonly publicSlug: string;
  readonly state: StorefrontPublicationState;
  readonly scheduledFor: string | null;
  readonly publishedAt: string | null;
  readonly hiddenAt: string | null;
  readonly version: bigint;
  readonly updatedAt: string;
}

export interface ThemeRevisionSummary {
  readonly id: string;
  readonly storefrontId: string;
  readonly revision: bigint;
  readonly status: "draft" | "published" | "archived";
  readonly documentHash: string;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

export interface StorefrontManagementReadRepository {
  listStorefronts(context: RequestContext, filter: StorefrontListFilter): Promise<readonly StorefrontSummary[]>;
  getStorefront(context: RequestContext, storefrontId: string): Promise<StorefrontSummary | null>;
  listSalesChannels(context: RequestContext, storefrontId: string, page: StorefrontReadPage): Promise<readonly SalesChannelSummary[]>;
  listDomains(context: RequestContext, storefrontId: string, page: StorefrontReadPage): Promise<readonly DomainSummary[]>;
  listProductPublications(
    context: RequestContext,
    salesChannelId: string,
    filter: ProductPublicationListFilter,
  ): Promise<readonly ProductPublicationSummary[]>;
  listThemeRevisions(context: RequestContext, storefrontId: string, page: StorefrontReadPage): Promise<readonly ThemeRevisionSummary[]>;
}

interface StorefrontRow extends Record<string, unknown> {
  readonly id: string;
  readonly legalEntityId: string;
  readonly primaryStoreId: string | null;
  readonly code: string;
  readonly displayName: string;
  readonly status: StorefrontLifecycleStatus;
  readonly defaultLocale: string;
  readonly defaultCurrency: string;
  readonly timeZone: string;
  readonly platformSubdomain: string | null;
  readonly version: string | number | bigint;
  readonly updatedAt: string | Date;
}

interface SalesChannelRow extends Record<string, unknown> {
  readonly id: string;
  readonly storefrontId: string;
  readonly code: string;
  readonly displayName: string;
  readonly status: StorefrontLifecycleStatus;
  readonly priceListId: string;
  readonly allowedCountryCodes: readonly string[];
  readonly guestCheckoutEnabled: boolean;
  readonly customerAccountsEnabled: boolean;
  readonly backorderPolicy: "deny" | "allow" | "preorder_only";
  readonly version: string | number | bigint;
  readonly updatedAt: string | Date;
}

interface DomainRow extends Record<string, unknown> {
  readonly id: string;
  readonly storefrontId: string;
  readonly hostname: string;
  readonly domainKind: "platform_subdomain" | "custom";
  readonly status: StorefrontDomainStatus;
  readonly canonical: boolean;
  readonly verificationMethod: "dns_txt" | "dns_cname" | "http" | null;
  readonly certificateStatus: DomainSummary["certificateStatus"];
  readonly failureCode: string | null;
  readonly version: string | number | bigint;
  readonly updatedAt: string | Date;
}

interface PublicationRow extends Record<string, unknown> {
  readonly id: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly productId: string;
  readonly publicSlug: string;
  readonly state: StorefrontPublicationState;
  readonly scheduledFor: string | Date | null;
  readonly publishedAt: string | Date | null;
  readonly hiddenAt: string | Date | null;
  readonly version: string | number | bigint;
  readonly updatedAt: string | Date;
}

interface ThemeRow extends Record<string, unknown> {
  readonly id: string;
  readonly storefrontId: string;
  readonly revision: string | number | bigint;
  readonly status: "draft" | "published" | "archived";
  readonly documentHash: string;
  readonly createdAt: string | Date;
  readonly publishedAt: string | Date | null;
}

function iso(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Storefront read returned an invalid timestamp.");
  return parsed.toISOString();
}

function nullableIso(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}

function storefront(row: StorefrontRow): StorefrontSummary {
  return Object.freeze({
    ...row,
    version: BigInt(row.version),
    updatedAt: iso(row.updatedAt),
  });
}

function salesChannel(row: SalesChannelRow): SalesChannelSummary {
  return Object.freeze({
    ...row,
    allowedCountryCodes: Object.freeze([...row.allowedCountryCodes]),
    version: BigInt(row.version),
    updatedAt: iso(row.updatedAt),
  });
}

function domain(row: DomainRow): DomainSummary {
  return Object.freeze({
    ...row,
    version: BigInt(row.version),
    updatedAt: iso(row.updatedAt),
  });
}

function publication(row: PublicationRow): ProductPublicationSummary {
  return Object.freeze({
    ...row,
    scheduledFor: nullableIso(row.scheduledFor),
    publishedAt: nullableIso(row.publishedAt),
    hiddenAt: nullableIso(row.hiddenAt),
    version: BigInt(row.version),
    updatedAt: iso(row.updatedAt),
  });
}

function theme(row: ThemeRow): ThemeRevisionSummary {
  return Object.freeze({
    ...row,
    revision: BigInt(row.revision),
    createdAt: iso(row.createdAt),
    publishedAt: nullableIso(row.publishedAt),
  });
}

export class SqlStorefrontManagementReadRepository implements StorefrontManagementReadRepository {
  public constructor(private readonly database: NeonDatabase) {}

  private async query<Row extends Record<string, unknown>>(
    context: RequestContext,
    text: string,
    values: readonly unknown[],
  ): Promise<readonly Row[]> {
    return await this.database.withClientTransaction(context, async (client: TransactionClient) =>
      (await client.query<Row>(text, values)).rows,
    );
  }

  public async listStorefronts(
    context: RequestContext,
    filter: StorefrontListFilter,
  ): Promise<readonly StorefrontSummary[]> {
    const rows = await this.query<StorefrontRow>(
      context,
      `SELECT id, legal_entity_id AS "legalEntityId", primary_store_id AS "primaryStoreId", code,
        display_name AS "displayName", status, default_locale AS "defaultLocale",
        default_currency AS "defaultCurrency", time_zone AS "timeZone",
        platform_subdomain AS "platformSubdomain", version, updated_at AS "updatedAt"
       FROM storefront.storefronts
       WHERE tenant_id = $1::uuid
         AND ($2::text IS NULL OR status = $2::text)
         AND ($3::uuid IS NULL OR id > $3::uuid)
       ORDER BY id
       LIMIT $4::integer`,
      [context.tenantId, filter.status ?? null, filter.afterId ?? null, filter.limit],
    );
    return Object.freeze(rows.map(storefront));
  }

  public async getStorefront(context: RequestContext, storefrontId: string): Promise<StorefrontSummary | null> {
    const rows = await this.query<StorefrontRow>(
      context,
      `SELECT id, legal_entity_id AS "legalEntityId", primary_store_id AS "primaryStoreId", code,
        display_name AS "displayName", status, default_locale AS "defaultLocale",
        default_currency AS "defaultCurrency", time_zone AS "timeZone",
        platform_subdomain AS "platformSubdomain", version, updated_at AS "updatedAt"
       FROM storefront.storefronts
       WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [context.tenantId, storefrontId],
    );
    const row = rows[0];
    return row ? storefront(row) : null;
  }

  public async listSalesChannels(
    context: RequestContext,
    storefrontId: string,
    page: StorefrontReadPage,
  ): Promise<readonly SalesChannelSummary[]> {
    const rows = await this.query<SalesChannelRow>(
      context,
      `SELECT id, storefront_id AS "storefrontId", code, display_name AS "displayName", status,
        price_list_id AS "priceListId", allowed_country_codes AS "allowedCountryCodes",
        guest_checkout_enabled AS "guestCheckoutEnabled",
        customer_accounts_enabled AS "customerAccountsEnabled",
        backorder_policy AS "backorderPolicy", version, updated_at AS "updatedAt"
       FROM storefront.sales_channels
       WHERE tenant_id = $1::uuid AND storefront_id = $2::uuid
         AND ($3::uuid IS NULL OR id > $3::uuid)
       ORDER BY id
       LIMIT $4::integer`,
      [context.tenantId, storefrontId, page.afterId ?? null, page.limit],
    );
    return Object.freeze(rows.map(salesChannel));
  }

  public async listDomains(
    context: RequestContext,
    storefrontId: string,
    page: StorefrontReadPage,
  ): Promise<readonly DomainSummary[]> {
    const rows = await this.query<DomainRow>(
      context,
      `SELECT id, storefront_id AS "storefrontId", hostname, domain_kind AS "domainKind", status,
        is_canonical AS canonical, verification_method AS "verificationMethod",
        certificate_status AS "certificateStatus", failure_code AS "failureCode", version,
        updated_at AS "updatedAt"
       FROM storefront.domains
       WHERE tenant_id = $1::uuid AND storefront_id = $2::uuid
         AND ($3::uuid IS NULL OR id > $3::uuid)
       ORDER BY id
       LIMIT $4::integer`,
      [context.tenantId, storefrontId, page.afterId ?? null, page.limit],
    );
    return Object.freeze(rows.map(domain));
  }

  public async listProductPublications(
    context: RequestContext,
    salesChannelId: string,
    filter: ProductPublicationListFilter,
  ): Promise<readonly ProductPublicationSummary[]> {
    const rows = await this.query<PublicationRow>(
      context,
      `SELECT id, storefront_id AS "storefrontId", sales_channel_id AS "salesChannelId",
        product_id AS "productId", public_slug AS "publicSlug", publication_state AS state,
        scheduled_for AS "scheduledFor", published_at AS "publishedAt", hidden_at AS "hiddenAt",
        version, updated_at AS "updatedAt"
       FROM storefront.product_publications
       WHERE tenant_id = $1::uuid AND sales_channel_id = $2::uuid
         AND ($3::text IS NULL OR publication_state = $3::text)
         AND ($4::uuid IS NULL OR id > $4::uuid)
       ORDER BY id
       LIMIT $5::integer`,
      [context.tenantId, salesChannelId, filter.state ?? null, filter.afterId ?? null, filter.limit],
    );
    return Object.freeze(rows.map(publication));
  }

  public async listThemeRevisions(
    context: RequestContext,
    storefrontId: string,
    page: StorefrontReadPage,
  ): Promise<readonly ThemeRevisionSummary[]> {
    const rows = await this.query<ThemeRow>(
      context,
      `SELECT id, storefront_id AS "storefrontId", revision, status, document_hash AS "documentHash",
        created_at AS "createdAt", published_at AS "publishedAt"
       FROM storefront.theme_revisions
       WHERE tenant_id = $1::uuid AND storefront_id = $2::uuid
         AND ($3::uuid IS NULL OR id > $3::uuid)
       ORDER BY id
       LIMIT $4::integer`,
      [context.tenantId, storefrontId, page.afterId ?? null, page.limit],
    );
    return Object.freeze(rows.map(theme));
  }
}

export class StorefrontManagementReadService {
  public constructor(private readonly repository: StorefrontManagementReadRepository) {}

  private authorize(context: RequestContext): void {
    requirePermission(context, "storefront.storefront.read");
  }

  public async listStorefronts(
    context: RequestContext,
    filter: StorefrontListFilter,
  ): Promise<readonly StorefrontSummary[]> {
    this.authorize(context);
    return await this.repository.listStorefronts(context, filter);
  }

  public async getStorefront(context: RequestContext, storefrontId: string): Promise<StorefrontSummary | null> {
    this.authorize(context);
    return await this.repository.getStorefront(context, storefrontId);
  }

  public async listSalesChannels(
    context: RequestContext,
    storefrontId: string,
    page: StorefrontReadPage,
  ): Promise<readonly SalesChannelSummary[]> {
    this.authorize(context);
    return await this.repository.listSalesChannels(context, storefrontId, page);
  }

  public async listDomains(
    context: RequestContext,
    storefrontId: string,
    page: StorefrontReadPage,
  ): Promise<readonly DomainSummary[]> {
    this.authorize(context);
    return await this.repository.listDomains(context, storefrontId, page);
  }

  public async listProductPublications(
    context: RequestContext,
    salesChannelId: string,
    filter: ProductPublicationListFilter,
  ): Promise<readonly ProductPublicationSummary[]> {
    this.authorize(context);
    return await this.repository.listProductPublications(context, salesChannelId, filter);
  }

  public async listThemeRevisions(
    context: RequestContext,
    storefrontId: string,
    page: StorefrontReadPage,
  ): Promise<readonly ThemeRevisionSummary[]> {
    this.authorize(context);
    return await this.repository.listThemeRevisions(context, storefrontId, page);
  }
}
