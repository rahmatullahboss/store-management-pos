import {
  NeonDatabase,
  requirePermission,
  type RequestContext,
  type TransactionClient,
} from "../../../packages/foundation/src/index.js";
import type { StorefrontPublicationState } from "./index.js";
import type {
  ContentPageStatus,
  HomepageStatus,
  NavigationPlacement,
  VariantPublicationState,
} from "./publishing.js";

export interface PublishingReadPage {
  readonly limit: number;
  readonly afterId?: string;
}

export interface PublicationReadFilter extends PublishingReadPage {
  readonly state?: StorefrontPublicationState;
}

export interface VariantPublicationReadFilter extends PublishingReadPage {
  readonly state?: VariantPublicationState;
}

export interface VariantPublicationSummary {
  readonly id: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly productId: string;
  readonly variantId: string;
  readonly state: VariantPublicationState;
  readonly publicSlugSuffix: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly version: bigint;
  readonly updatedAt: string;
}

export interface CategoryPublicationSummary {
  readonly id: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly categoryId: string;
  readonly parentCategoryId: string | null;
  readonly state: StorefrontPublicationState;
  readonly publicSlug: string;
  readonly sortOrder: number;
  readonly scheduledFor: string | null;
  readonly publishedAt: string | null;
  readonly version: bigint;
  readonly updatedAt: string;
}

export interface CollectionSummary {
  readonly id: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly code: string;
  readonly publicSlug: string;
  readonly title: string;
  readonly description: string | null;
  readonly state: StorefrontPublicationState;
  readonly scheduledFor: string | null;
  readonly publishedAt: string | null;
  readonly version: bigint;
  readonly updatedAt: string;
}

export interface CollectionMemberSummary {
  readonly id: string;
  readonly collectionId: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly sortOrder: number;
  readonly createdAt: string;
}

export interface NavigationRevisionSummary {
  readonly id: string;
  readonly storefrontId: string;
  readonly placement: NavigationPlacement;
  readonly revision: bigint;
  readonly status: "draft" | "published" | "archived";
  readonly navigationDocument: Readonly<Record<string, unknown>>;
  readonly documentHash: string;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

export interface ContentPageRevisionSummary {
  readonly id: string;
  readonly storefrontId: string;
  readonly publicSlug: string;
  readonly revision: bigint;
  readonly title: string;
  readonly status: ContentPageStatus | "draft";
  readonly contentDocument: Readonly<Record<string, unknown>>;
  readonly seoDocument: Readonly<Record<string, unknown>>;
  readonly documentHash: string;
  readonly scheduledFor: string | null;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

export interface HomepageRevisionSummary {
  readonly id: string;
  readonly storefrontId: string;
  readonly revision: bigint;
  readonly status: HomepageStatus | "draft";
  readonly homepageDocument: Readonly<Record<string, unknown>>;
  readonly seoDocument: Readonly<Record<string, unknown>>;
  readonly documentHash: string;
  readonly scheduledFor: string | null;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

export interface StorefrontPublishingReadRepository {
  listVariantPublications(
    context: RequestContext,
    salesChannelId: string,
    filter: VariantPublicationReadFilter,
  ): Promise<readonly VariantPublicationSummary[]>;
  listCategoryPublications(
    context: RequestContext,
    salesChannelId: string,
    filter: PublicationReadFilter,
  ): Promise<readonly CategoryPublicationSummary[]>;
  listCollections(
    context: RequestContext,
    salesChannelId: string,
    filter: PublicationReadFilter,
  ): Promise<readonly CollectionSummary[]>;
  listCollectionMembers(
    context: RequestContext,
    collectionId: string,
    page: PublishingReadPage,
  ): Promise<readonly CollectionMemberSummary[]>;
  listNavigationRevisions(
    context: RequestContext,
    storefrontId: string,
    page: PublishingReadPage,
  ): Promise<readonly NavigationRevisionSummary[]>;
  listContentPageRevisions(
    context: RequestContext,
    storefrontId: string,
    page: PublishingReadPage,
  ): Promise<readonly ContentPageRevisionSummary[]>;
  listHomepageRevisions(
    context: RequestContext,
    storefrontId: string,
    page: PublishingReadPage,
  ): Promise<readonly HomepageRevisionSummary[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function uuid(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID.test(normalized)) throw new Error(`${label} must be a UUID.`);
  return normalized;
}

function page(value: PublishingReadPage): PublishingReadPage {
  if (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100) {
    throw new Error("Read limit must be between 1 and 100.");
  }
  return {
    limit: value.limit,
    ...(value.afterId === undefined ? {} : { afterId: uuid(value.afterId, "Read cursor") }),
  };
}

function iso(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Storefront publishing read returned an invalid timestamp.");
  return parsed.toISOString();
}

function nullableIso(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}

function document(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.freeze({ ...value });
}

export class StorefrontPublishingReadService {
  public constructor(private readonly repository: StorefrontPublishingReadRepository) {}

  public async listVariantPublications(
    context: RequestContext,
    salesChannelId: string,
    filter: VariantPublicationReadFilter,
  ): Promise<readonly VariantPublicationSummary[]> {
    requirePermission(context, "storefront.storefront.read");
    return await this.repository.listVariantPublications(
      context,
      uuid(salesChannelId, "Sales channel"),
      { ...page(filter), ...(filter.state === undefined ? {} : { state: filter.state }) },
    );
  }

  public async listCategoryPublications(
    context: RequestContext,
    salesChannelId: string,
    filter: PublicationReadFilter,
  ): Promise<readonly CategoryPublicationSummary[]> {
    requirePermission(context, "storefront.storefront.read");
    return await this.repository.listCategoryPublications(
      context,
      uuid(salesChannelId, "Sales channel"),
      { ...page(filter), ...(filter.state === undefined ? {} : { state: filter.state }) },
    );
  }

  public async listCollections(
    context: RequestContext,
    salesChannelId: string,
    filter: PublicationReadFilter,
  ): Promise<readonly CollectionSummary[]> {
    requirePermission(context, "storefront.storefront.read");
    return await this.repository.listCollections(
      context,
      uuid(salesChannelId, "Sales channel"),
      { ...page(filter), ...(filter.state === undefined ? {} : { state: filter.state }) },
    );
  }

  public async listCollectionMembers(
    context: RequestContext,
    collectionId: string,
    requestedPage: PublishingReadPage,
  ): Promise<readonly CollectionMemberSummary[]> {
    requirePermission(context, "storefront.storefront.read");
    return await this.repository.listCollectionMembers(
      context,
      uuid(collectionId, "Collection"),
      page(requestedPage),
    );
  }

  public async listNavigationRevisions(
    context: RequestContext,
    storefrontId: string,
    requestedPage: PublishingReadPage,
  ): Promise<readonly NavigationRevisionSummary[]> {
    requirePermission(context, "storefront.storefront.read");
    return await this.repository.listNavigationRevisions(
      context,
      uuid(storefrontId, "Storefront"),
      page(requestedPage),
    );
  }

  public async listContentPageRevisions(
    context: RequestContext,
    storefrontId: string,
    requestedPage: PublishingReadPage,
  ): Promise<readonly ContentPageRevisionSummary[]> {
    requirePermission(context, "storefront.storefront.read");
    return await this.repository.listContentPageRevisions(
      context,
      uuid(storefrontId, "Storefront"),
      page(requestedPage),
    );
  }

  public async listHomepageRevisions(
    context: RequestContext,
    storefrontId: string,
    requestedPage: PublishingReadPage,
  ): Promise<readonly HomepageRevisionSummary[]> {
    requirePermission(context, "storefront.storefront.read");
    return await this.repository.listHomepageRevisions(
      context,
      uuid(storefrontId, "Storefront"),
      page(requestedPage),
    );
  }
}

interface VariantRow extends Record<string, unknown> {
  readonly id: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly productId: string;
  readonly variantId: string;
  readonly state: VariantPublicationState;
  readonly publicSlugSuffix: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly version: string | number | bigint;
  readonly updatedAt: string | Date;
}

interface CategoryRow extends Record<string, unknown> {
  readonly id: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly categoryId: string;
  readonly parentCategoryId: string | null;
  readonly state: StorefrontPublicationState;
  readonly publicSlug: string;
  readonly sortOrder: number;
  readonly scheduledFor: string | Date | null;
  readonly publishedAt: string | Date | null;
  readonly version: string | number | bigint;
  readonly updatedAt: string | Date;
}

interface CollectionRow extends Record<string, unknown> {
  readonly id: string;
  readonly storefrontId: string;
  readonly salesChannelId: string;
  readonly code: string;
  readonly publicSlug: string;
  readonly title: string;
  readonly description: string | null;
  readonly state: StorefrontPublicationState;
  readonly scheduledFor: string | Date | null;
  readonly publishedAt: string | Date | null;
  readonly version: string | number | bigint;
  readonly updatedAt: string | Date;
}

interface MemberRow extends Record<string, unknown> {
  readonly id: string;
  readonly collectionId: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly sortOrder: number;
  readonly createdAt: string | Date;
}

interface NavigationRow extends Record<string, unknown> {
  readonly id: string;
  readonly storefrontId: string;
  readonly placement: NavigationPlacement;
  readonly revision: string | number | bigint;
  readonly status: "draft" | "published" | "archived";
  readonly navigationDocument: Readonly<Record<string, unknown>>;
  readonly documentHash: string;
  readonly createdAt: string | Date;
  readonly publishedAt: string | Date | null;
}

interface ContentRow extends Record<string, unknown> {
  readonly id: string;
  readonly storefrontId: string;
  readonly publicSlug: string;
  readonly revision: string | number | bigint;
  readonly title: string;
  readonly status: ContentPageStatus | "draft";
  readonly contentDocument: Readonly<Record<string, unknown>>;
  readonly seoDocument: Readonly<Record<string, unknown>>;
  readonly documentHash: string;
  readonly scheduledFor: string | Date | null;
  readonly createdAt: string | Date;
  readonly publishedAt: string | Date | null;
}

interface HomepageRow extends Record<string, unknown> {
  readonly id: string;
  readonly storefrontId: string;
  readonly revision: string | number | bigint;
  readonly status: HomepageStatus | "draft";
  readonly homepageDocument: Readonly<Record<string, unknown>>;
  readonly seoDocument: Readonly<Record<string, unknown>>;
  readonly documentHash: string;
  readonly scheduledFor: string | Date | null;
  readonly createdAt: string | Date;
  readonly publishedAt: string | Date | null;
}

export class SqlStorefrontPublishingReadRepository implements StorefrontPublishingReadRepository {
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

  public async listVariantPublications(context: RequestContext, salesChannelId: string, filter: VariantPublicationReadFilter): Promise<readonly VariantPublicationSummary[]> {
    const rows = await this.query<VariantRow>(context,
      `SELECT id, storefront_id AS "storefrontId", sales_channel_id AS "salesChannelId",
        product_id AS "productId", variant_id AS "variantId", publication_state AS state,
        public_slug_suffix AS "publicSlugSuffix", metadata, version, updated_at AS "updatedAt"
       FROM storefront.variant_publications
       WHERE tenant_id = $1::uuid AND sales_channel_id = $2::uuid
         AND ($3::text IS NULL OR publication_state = $3::text)
         AND ($4::uuid IS NULL OR id > $4::uuid)
       ORDER BY id LIMIT $5::integer`,
      [context.tenantId, salesChannelId, filter.state ?? null, filter.afterId ?? null, filter.limit]);
    return Object.freeze(rows.map((row) => Object.freeze({ ...row, metadata: document(row.metadata), version: BigInt(row.version), updatedAt: iso(row.updatedAt) })));
  }

  public async listCategoryPublications(context: RequestContext, salesChannelId: string, filter: PublicationReadFilter): Promise<readonly CategoryPublicationSummary[]> {
    const rows = await this.query<CategoryRow>(context,
      `SELECT id, storefront_id AS "storefrontId", sales_channel_id AS "salesChannelId",
        category_id AS "categoryId", parent_category_id AS "parentCategoryId",
        publication_state AS state, public_slug AS "publicSlug", sort_order AS "sortOrder",
        scheduled_for AS "scheduledFor", published_at AS "publishedAt", version,
        updated_at AS "updatedAt"
       FROM storefront.category_publications
       WHERE tenant_id = $1::uuid AND sales_channel_id = $2::uuid
         AND ($3::text IS NULL OR publication_state = $3::text)
         AND ($4::uuid IS NULL OR id > $4::uuid)
       ORDER BY id LIMIT $5::integer`,
      [context.tenantId, salesChannelId, filter.state ?? null, filter.afterId ?? null, filter.limit]);
    return Object.freeze(rows.map((row) => Object.freeze({ ...row, scheduledFor: nullableIso(row.scheduledFor), publishedAt: nullableIso(row.publishedAt), version: BigInt(row.version), updatedAt: iso(row.updatedAt) })));
  }

  public async listCollections(context: RequestContext, salesChannelId: string, filter: PublicationReadFilter): Promise<readonly CollectionSummary[]> {
    const rows = await this.query<CollectionRow>(context,
      `SELECT id, storefront_id AS "storefrontId", sales_channel_id AS "salesChannelId",
        code, public_slug AS "publicSlug", title, description, publication_state AS state,
        scheduled_for AS "scheduledFor", published_at AS "publishedAt", version,
        updated_at AS "updatedAt"
       FROM storefront.collections
       WHERE tenant_id = $1::uuid AND sales_channel_id = $2::uuid
         AND ($3::text IS NULL OR publication_state = $3::text)
         AND ($4::uuid IS NULL OR id > $4::uuid)
       ORDER BY id LIMIT $5::integer`,
      [context.tenantId, salesChannelId, filter.state ?? null, filter.afterId ?? null, filter.limit]);
    return Object.freeze(rows.map((row) => Object.freeze({ ...row, scheduledFor: nullableIso(row.scheduledFor), publishedAt: nullableIso(row.publishedAt), version: BigInt(row.version), updatedAt: iso(row.updatedAt) })));
  }

  public async listCollectionMembers(context: RequestContext, collectionId: string, requestedPage: PublishingReadPage): Promise<readonly CollectionMemberSummary[]> {
    const rows = await this.query<MemberRow>(context,
      `SELECT id, collection_id AS "collectionId", product_id AS "productId",
        variant_id AS "variantId", sort_order AS "sortOrder", created_at AS "createdAt"
       FROM storefront.collection_members
       WHERE tenant_id = $1::uuid AND collection_id = $2::uuid
         AND ($3::uuid IS NULL OR id > $3::uuid)
       ORDER BY id LIMIT $4::integer`,
      [context.tenantId, collectionId, requestedPage.afterId ?? null, requestedPage.limit]);
    return Object.freeze(rows.map((row) => Object.freeze({ ...row, createdAt: iso(row.createdAt) })));
  }

  public async listNavigationRevisions(context: RequestContext, storefrontId: string, requestedPage: PublishingReadPage): Promise<readonly NavigationRevisionSummary[]> {
    const rows = await this.query<NavigationRow>(context,
      `SELECT id, storefront_id AS "storefrontId", placement, revision, status,
        navigation_document AS "navigationDocument", document_hash AS "documentHash",
        created_at AS "createdAt", published_at AS "publishedAt"
       FROM storefront.navigation_documents
       WHERE tenant_id = $1::uuid AND storefront_id = $2::uuid
         AND ($3::uuid IS NULL OR id > $3::uuid)
       ORDER BY id LIMIT $4::integer`,
      [context.tenantId, storefrontId, requestedPage.afterId ?? null, requestedPage.limit]);
    return Object.freeze(rows.map((row) => Object.freeze({ ...row, navigationDocument: document(row.navigationDocument), revision: BigInt(row.revision), createdAt: iso(row.createdAt), publishedAt: nullableIso(row.publishedAt) })));
  }

  public async listContentPageRevisions(context: RequestContext, storefrontId: string, requestedPage: PublishingReadPage): Promise<readonly ContentPageRevisionSummary[]> {
    const rows = await this.query<ContentRow>(context,
      `SELECT id, storefront_id AS "storefrontId", public_slug AS "publicSlug", revision,
        title, status, content_document AS "contentDocument", seo_document AS "seoDocument",
        document_hash AS "documentHash", scheduled_for AS "scheduledFor",
        created_at AS "createdAt", published_at AS "publishedAt"
       FROM storefront.content_pages
       WHERE tenant_id = $1::uuid AND storefront_id = $2::uuid
         AND ($3::uuid IS NULL OR id > $3::uuid)
       ORDER BY id LIMIT $4::integer`,
      [context.tenantId, storefrontId, requestedPage.afterId ?? null, requestedPage.limit]);
    return Object.freeze(rows.map((row) => Object.freeze({ ...row, contentDocument: document(row.contentDocument), seoDocument: document(row.seoDocument), revision: BigInt(row.revision), scheduledFor: nullableIso(row.scheduledFor), createdAt: iso(row.createdAt), publishedAt: nullableIso(row.publishedAt) })));
  }

  public async listHomepageRevisions(context: RequestContext, storefrontId: string, requestedPage: PublishingReadPage): Promise<readonly HomepageRevisionSummary[]> {
    const rows = await this.query<HomepageRow>(context,
      `SELECT id, storefront_id AS "storefrontId", revision, status,
        homepage_document AS "homepageDocument", seo_document AS "seoDocument",
        document_hash AS "documentHash", scheduled_for AS "scheduledFor",
        created_at AS "createdAt", published_at AS "publishedAt"
       FROM storefront.homepage_revisions
       WHERE tenant_id = $1::uuid AND storefront_id = $2::uuid
         AND ($3::uuid IS NULL OR id > $3::uuid)
       ORDER BY id LIMIT $4::integer`,
      [context.tenantId, storefrontId, requestedPage.afterId ?? null, requestedPage.limit]);
    return Object.freeze(rows.map((row) => Object.freeze({ ...row, homepageDocument: document(row.homepageDocument), seoDocument: document(row.seoDocument), revision: BigInt(row.revision), scheduledFor: nullableIso(row.scheduledFor), createdAt: iso(row.createdAt), publishedAt: nullableIso(row.publishedAt) })));
  }
}
