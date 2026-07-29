import type { RequestContext } from "../../../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import type {
  ProductPublicationListFilter,
  ProductPublicationSummary,
  SalesChannelSummary,
  StorefrontListFilter,
  StorefrontReadPage,
  StorefrontSummary,
  DomainSummary,
  ThemeRevisionSummary,
} from "../../../../../modules/storefront/src/read.js";
import {
  SqlStorefrontManagementReadRepository,
  StorefrontManagementReadService,
} from "../../../../../modules/storefront/src/read.js";
import type {
  StorefrontLifecycleStatus,
  StorefrontPublicationState,
} from "../../../../../modules/storefront/src/index.js";
import { dataResponse, pathUuid } from "../../finance-handler-utils.js";

const lifecycleStatuses = new Set<StorefrontLifecycleStatus>(["draft", "active", "suspended", "archived"]);
const publicationStates = new Set<StorefrontPublicationState>([
  "draft",
  "scheduled",
  "published",
  "hidden",
  "archived",
]);

export interface StorefrontReads {
  listStorefronts(context: RequestContext, filter: StorefrontListFilter): Promise<readonly StorefrontSummary[]>;
  getStorefront(context: RequestContext, storefrontId: string): Promise<StorefrontSummary | null>;
  listSalesChannels(
    context: RequestContext,
    storefrontId: string,
    page: StorefrontReadPage,
  ): Promise<readonly SalesChannelSummary[]>;
  listDomains(
    context: RequestContext,
    storefrontId: string,
    page: StorefrontReadPage,
  ): Promise<readonly DomainSummary[]>;
  listProductPublications(
    context: RequestContext,
    salesChannelId: string,
    filter: ProductPublicationListFilter,
  ): Promise<readonly ProductPublicationSummary[]>;
  listThemeRevisions(
    context: RequestContext,
    storefrontId: string,
    page: StorefrontReadPage,
  ): Promise<readonly ThemeRevisionSummary[]>;
}

function reads(database: NeonDatabase): StorefrontReads {
  return new StorefrontManagementReadService(new SqlStorefrontManagementReadRepository(database));
}

function limit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return 50;
  if (!/^\d+$/u.test(raw)) throw new PlatformError("VALIDATION_FAILED", "limit must be an integer", 400);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new PlatformError("VALIDATION_FAILED", "limit must be between 1 and 100", 400);
  }
  return parsed;
}

function afterId(url: URL): string | undefined {
  const value = url.searchParams.get("afterId")?.trim();
  return value ? pathUuid(value, "afterId") : undefined;
}

function page(url: URL): StorefrontReadPage {
  const after = afterId(url);
  return {
    limit: limit(url),
    ...(after === undefined ? {} : { afterId: after }),
  };
}

function lifecycleStatus(url: URL): StorefrontLifecycleStatus | undefined {
  const value = url.searchParams.get("status")?.trim();
  if (!value) return undefined;
  if (!lifecycleStatuses.has(value as StorefrontLifecycleStatus)) {
    throw new PlatformError("VALIDATION_FAILED", "status is invalid", 400);
  }
  return value as StorefrontLifecycleStatus;
}

function publicationState(url: URL): StorefrontPublicationState | undefined {
  const value = url.searchParams.get("state")?.trim();
  if (!value) return undefined;
  if (!publicationStates.has(value as StorefrontPublicationState)) {
    throw new PlatformError("VALIDATION_FAILED", "state is invalid", 400);
  }
  return value as StorefrontPublicationState;
}

function pageResponse<T extends { readonly id: string }>(items: readonly T[], requestedLimit: number): Response {
  const last = items.at(-1);
  return dataResponse({
    items,
    nextAfterId: items.length === requestedLimit && last ? last.id : null,
  });
}

async function listStorefronts(
  url: URL,
  context: RequestContext,
  service: StorefrontReads,
): Promise<Response> {
  const requestedLimit = limit(url);
  const after = afterId(url);
  const status = lifecycleStatus(url);
  const filter: StorefrontListFilter = {
    limit: requestedLimit,
    ...(after === undefined ? {} : { afterId: after }),
    ...(status === undefined ? {} : { status }),
  };
  return pageResponse(await service.listStorefronts(context, filter), requestedLimit);
}

async function getStorefront(
  context: RequestContext,
  service: StorefrontReads,
  storefrontId: string,
): Promise<Response> {
  const item = await service.getStorefront(context, pathUuid(storefrontId, "storefrontId"));
  if (!item) throw new PlatformError("NOT_FOUND", "Storefront not found", 404);
  return dataResponse(item);
}

async function listSalesChannels(
  url: URL,
  context: RequestContext,
  service: StorefrontReads,
  storefrontId: string,
): Promise<Response> {
  const requestedPage = page(url);
  return pageResponse(
    await service.listSalesChannels(context, pathUuid(storefrontId, "storefrontId"), requestedPage),
    requestedPage.limit,
  );
}

async function listDomains(
  url: URL,
  context: RequestContext,
  service: StorefrontReads,
  storefrontId: string,
): Promise<Response> {
  const requestedPage = page(url);
  return pageResponse(
    await service.listDomains(context, pathUuid(storefrontId, "storefrontId"), requestedPage),
    requestedPage.limit,
  );
}

async function listProductPublications(
  url: URL,
  context: RequestContext,
  service: StorefrontReads,
  salesChannelId: string,
): Promise<Response> {
  const requestedLimit = limit(url);
  const after = afterId(url);
  const state = publicationState(url);
  const filter: ProductPublicationListFilter = {
    limit: requestedLimit,
    ...(after === undefined ? {} : { afterId: after }),
    ...(state === undefined ? {} : { state }),
  };
  return pageResponse(
    await service.listProductPublications(context, pathUuid(salesChannelId, "salesChannelId"), filter),
    requestedLimit,
  );
}

async function listThemeRevisions(
  url: URL,
  context: RequestContext,
  service: StorefrontReads,
  storefrontId: string,
): Promise<Response> {
  const requestedPage = page(url);
  return pageResponse(
    await service.listThemeRevisions(context, pathUuid(storefrontId, "storefrontId"), requestedPage),
    requestedPage.limit,
  );
}

export async function handleStorefrontReadRequest(
  request: Request,
  url: URL,
  context: RequestContext,
  database: NeonDatabase,
  readService: StorefrontReads = reads(database),
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  if (url.pathname === "/v1/storefront/storefronts") {
    return await listStorefronts(url, context, readService);
  }

  const storefrontChannels = url.pathname.match(/^\/v1\/storefront\/storefronts\/([^/]+)\/sales-channels$/u);
  if (storefrontChannels?.[1]) {
    return await listSalesChannels(url, context, readService, storefrontChannels[1]);
  }

  const storefrontDomains = url.pathname.match(/^\/v1\/storefront\/storefronts\/([^/]+)\/domains$/u);
  if (storefrontDomains?.[1]) {
    return await listDomains(url, context, readService, storefrontDomains[1]);
  }

  const themeRevisions = url.pathname.match(/^\/v1\/storefront\/storefronts\/([^/]+)\/theme-revisions$/u);
  if (themeRevisions?.[1]) {
    return await listThemeRevisions(url, context, readService, themeRevisions[1]);
  }

  const productPublications = url.pathname.match(
    /^\/v1\/storefront\/sales-channels\/([^/]+)\/product-publications$/u,
  );
  if (productPublications?.[1]) {
    return await listProductPublications(url, context, readService, productPublications[1]);
  }

  const storefrontDetail = url.pathname.match(/^\/v1\/storefront\/storefronts\/([^/]+)$/u);
  if (storefrontDetail?.[1]) {
    return await getStorefront(context, readService, storefrontDetail[1]);
  }

  return null;
}
