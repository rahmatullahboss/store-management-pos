import type { RequestContext } from "../../../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import {
  SqlStorefrontPublishingReadRepository,
  StorefrontPublishingReadService,
  type CategoryPublicationSummary,
  type CollectionMemberSummary,
  type CollectionSummary,
  type ContentPageRevisionSummary,
  type HomepageRevisionSummary,
  type NavigationRevisionSummary,
  type PublicationReadFilter,
  type PublishingReadPage,
  type VariantPublicationReadFilter,
  type VariantPublicationSummary,
} from "../../../../../modules/storefront/src/publishing-read.js";
import type {
  StorefrontPublicationState,
} from "../../../../../modules/storefront/src/index.js";
import type {
  VariantPublicationState,
} from "../../../../../modules/storefront/src/publishing.js";
import { dataResponse, pathUuid } from "../../finance-handler-utils.js";

const publicationStates = new Set<StorefrontPublicationState>([
  "draft",
  "scheduled",
  "published",
  "hidden",
  "archived",
]);
const variantStates = new Set<VariantPublicationState>([
  "published",
  "hidden",
  "archived",
]);

export interface StorefrontPublishingReads {
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

function reads(database: NeonDatabase): StorefrontPublishingReads {
  return new StorefrontPublishingReadService(
    new SqlStorefrontPublishingReadRepository(database),
  );
}

function limit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 50;
  if (!/^\d+$/u.test(raw)) {
    throw new PlatformError("VALIDATION_FAILED", "limit must be an integer", 400);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new PlatformError(
      "VALIDATION_FAILED",
      "limit must be between 1 and 100",
      400,
    );
  }
  return parsed;
}

function afterId(url: URL): string | undefined {
  const value = url.searchParams.get("afterId")?.trim();
  return value ? pathUuid(value, "afterId") : undefined;
}

function page(url: URL): PublishingReadPage {
  const cursor = afterId(url);
  return {
    limit: limit(url),
    ...(cursor === undefined ? {} : { afterId: cursor }),
  };
}

function publicationState(url: URL): StorefrontPublicationState | undefined {
  const value = url.searchParams.get("state")?.trim();
  if (!value) return undefined;
  if (!publicationStates.has(value as StorefrontPublicationState)) {
    throw new PlatformError("VALIDATION_FAILED", "state is invalid", 400);
  }
  return value as StorefrontPublicationState;
}

function variantState(url: URL): VariantPublicationState | undefined {
  const value = url.searchParams.get("state")?.trim();
  if (!value) return undefined;
  if (!variantStates.has(value as VariantPublicationState)) {
    throw new PlatformError("VALIDATION_FAILED", "state is invalid", 400);
  }
  return value as VariantPublicationState;
}

function pageResponse<T extends { readonly id: string }>(
  items: readonly T[],
  requestedLimit: number,
): Response {
  const last = items.at(-1);
  return dataResponse({
    items,
    nextAfterId:
      items.length === requestedLimit && last !== undefined ? last.id : null,
  });
}

async function listVariantPublications(
  url: URL,
  context: RequestContext,
  service: StorefrontPublishingReads,
  salesChannelId: string,
): Promise<Response> {
  const requestedLimit = limit(url);
  const cursor = afterId(url);
  const state = variantState(url);
  const filter: VariantPublicationReadFilter = {
    limit: requestedLimit,
    ...(cursor === undefined ? {} : { afterId: cursor }),
    ...(state === undefined ? {} : { state }),
  };
  return pageResponse(
    await service.listVariantPublications(
      context,
      pathUuid(salesChannelId, "salesChannelId"),
      filter,
    ),
    requestedLimit,
  );
}

async function listCategoryPublications(
  url: URL,
  context: RequestContext,
  service: StorefrontPublishingReads,
  salesChannelId: string,
): Promise<Response> {
  const requestedLimit = limit(url);
  const cursor = afterId(url);
  const state = publicationState(url);
  const filter: PublicationReadFilter = {
    limit: requestedLimit,
    ...(cursor === undefined ? {} : { afterId: cursor }),
    ...(state === undefined ? {} : { state }),
  };
  return pageResponse(
    await service.listCategoryPublications(
      context,
      pathUuid(salesChannelId, "salesChannelId"),
      filter,
    ),
    requestedLimit,
  );
}

async function listCollections(
  url: URL,
  context: RequestContext,
  service: StorefrontPublishingReads,
  salesChannelId: string,
): Promise<Response> {
  const requestedLimit = limit(url);
  const cursor = afterId(url);
  const state = publicationState(url);
  const filter: PublicationReadFilter = {
    limit: requestedLimit,
    ...(cursor === undefined ? {} : { afterId: cursor }),
    ...(state === undefined ? {} : { state }),
  };
  return pageResponse(
    await service.listCollections(
      context,
      pathUuid(salesChannelId, "salesChannelId"),
      filter,
    ),
    requestedLimit,
  );
}

async function listCollectionMembers(
  url: URL,
  context: RequestContext,
  service: StorefrontPublishingReads,
  collectionId: string,
): Promise<Response> {
  const requestedPage = page(url);
  return pageResponse(
    await service.listCollectionMembers(
      context,
      pathUuid(collectionId, "collectionId"),
      requestedPage,
    ),
    requestedPage.limit,
  );
}

async function listNavigationRevisions(
  url: URL,
  context: RequestContext,
  service: StorefrontPublishingReads,
  storefrontId: string,
): Promise<Response> {
  const requestedPage = page(url);
  return pageResponse(
    await service.listNavigationRevisions(
      context,
      pathUuid(storefrontId, "storefrontId"),
      requestedPage,
    ),
    requestedPage.limit,
  );
}

async function listContentPageRevisions(
  url: URL,
  context: RequestContext,
  service: StorefrontPublishingReads,
  storefrontId: string,
): Promise<Response> {
  const requestedPage = page(url);
  return pageResponse(
    await service.listContentPageRevisions(
      context,
      pathUuid(storefrontId, "storefrontId"),
      requestedPage,
    ),
    requestedPage.limit,
  );
}

async function listHomepageRevisions(
  url: URL,
  context: RequestContext,
  service: StorefrontPublishingReads,
  storefrontId: string,
): Promise<Response> {
  const requestedPage = page(url);
  return pageResponse(
    await service.listHomepageRevisions(
      context,
      pathUuid(storefrontId, "storefrontId"),
      requestedPage,
    ),
    requestedPage.limit,
  );
}

export async function handleStorefrontPublishingReadRequest(
  request: Request,
  url: URL,
  context: RequestContext,
  database: NeonDatabase,
  readService: StorefrontPublishingReads = reads(database),
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  const variantPublications = url.pathname.match(
    /^\/v1\/storefront\/sales-channels\/([^/]+)\/variant-publications$/u,
  );
  if (variantPublications?.[1]) {
    return await listVariantPublications(
      url,
      context,
      readService,
      variantPublications[1],
    );
  }

  const categoryPublications = url.pathname.match(
    /^\/v1\/storefront\/sales-channels\/([^/]+)\/category-publications$/u,
  );
  if (categoryPublications?.[1]) {
    return await listCategoryPublications(
      url,
      context,
      readService,
      categoryPublications[1],
    );
  }

  const collections = url.pathname.match(
    /^\/v1\/storefront\/sales-channels\/([^/]+)\/collections$/u,
  );
  if (collections?.[1]) {
    return await listCollections(url, context, readService, collections[1]);
  }

  const collectionMembers = url.pathname.match(
    /^\/v1\/storefront\/collections\/([^/]+)\/members$/u,
  );
  if (collectionMembers?.[1]) {
    return await listCollectionMembers(
      url,
      context,
      readService,
      collectionMembers[1],
    );
  }

  const navigationRevisions = url.pathname.match(
    /^\/v1\/storefront\/storefronts\/([^/]+)\/navigation-revisions$/u,
  );
  if (navigationRevisions?.[1]) {
    return await listNavigationRevisions(
      url,
      context,
      readService,
      navigationRevisions[1],
    );
  }

  const contentPageRevisions = url.pathname.match(
    /^\/v1\/storefront\/storefronts\/([^/]+)\/content-page-revisions$/u,
  );
  if (contentPageRevisions?.[1]) {
    return await listContentPageRevisions(
      url,
      context,
      readService,
      contentPageRevisions[1],
    );
  }

  const homepageRevisions = url.pathname.match(
    /^\/v1\/storefront\/storefronts\/([^/]+)\/homepage-revisions$/u,
  );
  if (homepageRevisions?.[1]) {
    return await listHomepageRevisions(
      url,
      context,
      readService,
      homepageRevisions[1],
    );
  }

  return null;
}
