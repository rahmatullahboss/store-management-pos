import type { RequestContext } from "../../../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import {
  SqlStorefrontPublishingRepository,
  StorefrontPublishingService,
  type CollectionMemberInput,
  type CollectionMembersCommandResult,
  type ContentPageStatus,
  type HomepageStatus,
  type NavigationPlacement,
  type PublishContentPageInput,
  type PublishHomepageInput,
  type PublishNavigationInput,
  type ReplaceCollectionMembersInput,
  type RevisionCommandResult,
  type SetCategoryPublicationInput,
  type SetCollectionInput,
  type SetVariantPublicationInput,
  type StatusRevisionCommandResult,
  type StorefrontPublishingRepository,
  type VariantPublicationState,
} from "../../../../../modules/storefront/src/publishing.js";
import type { PublicationCommandResult, StorefrontPublicationState } from "../../../../../modules/storefront/src/index.js";
import {
  bodyRecord,
  dataResponse,
  idempotencyKey,
  optionalRecord,
  optionalString,
  optionalUuid,
  pathUuid,
  requiredArray,
  requiredEnum,
  requiredRecord,
  requiredString,
  requiredUuid,
} from "../../finance-handler-utils.js";

const variantStates = ["published", "hidden", "archived"] as const satisfies readonly VariantPublicationState[];
const publicationStates = ["draft", "scheduled", "published", "hidden", "archived"] as const satisfies readonly StorefrontPublicationState[];
const placements = ["header", "footer", "utility"] as const satisfies readonly NavigationPlacement[];
const contentStatuses = ["scheduled", "published", "hidden", "archived"] as const satisfies readonly ContentPageStatus[];
const homepageStatuses = ["scheduled", "published", "archived"] as const satisfies readonly HomepageStatus[];

export interface StorefrontPublishingCommands {
  setVariantPublication(context: RequestContext, input: SetVariantPublicationInput): Promise<PublicationCommandResult>;
  setCategoryPublication(context: RequestContext, input: SetCategoryPublicationInput): Promise<PublicationCommandResult>;
  setCollection(context: RequestContext, input: SetCollectionInput): Promise<PublicationCommandResult>;
  replaceCollectionMembers(context: RequestContext, input: ReplaceCollectionMembersInput): Promise<CollectionMembersCommandResult>;
  publishNavigation(context: RequestContext, input: PublishNavigationInput): Promise<RevisionCommandResult>;
  publishContentPage(context: RequestContext, input: PublishContentPageInput): Promise<StatusRevisionCommandResult>;
  publishHomepage(context: RequestContext, input: PublishHomepageInput): Promise<StatusRevisionCommandResult>;
}

function commands(database: NeonDatabase): StorefrontPublishingCommands {
  const repository: StorefrontPublishingRepository = new SqlStorefrontPublishingRepository(database);
  return new StorefrontPublishingService(repository);
}

function optionalInteger(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be an integer`, 400);
  return value as number;
}

function members(record: Record<string, unknown>): readonly CollectionMemberInput[] {
  return requiredArray(record, "members").map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new PlatformError("VALIDATION_FAILED", `members[${index}] must be an object`, 400);
    }
    const item = value as Record<string, unknown>;
    const variantId = optionalUuid(item, "variantId");
    const sortOrder = optionalInteger(item, "sortOrder");
    return {
      memberId: requiredUuid(item, "memberId"),
      productId: requiredUuid(item, "productId"),
      ...(variantId === undefined ? {} : { variantId }),
      ...(sortOrder === undefined ? {} : { sortOrder }),
    };
  });
}

async function setVariantPublication(
  request: Request,
  context: RequestContext,
  service: StorefrontPublishingCommands,
  salesChannelId: string,
  productId: string,
  variantId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const suffix = optionalString(body, "publicSlugSuffix", 180);
  const metadata = optionalRecord(body, "metadata");
  const input: SetVariantPublicationInput = {
    storefrontId: requiredUuid(body, "storefrontId"),
    salesChannelId: pathUuid(salesChannelId, "salesChannelId"),
    productId: pathUuid(productId, "productId"),
    variantId: pathUuid(variantId, "variantId"),
    state: requiredEnum(body, "state", variantStates),
    ...(suffix === undefined ? {} : { publicSlugSuffix: suffix }),
    ...(metadata === undefined ? {} : { metadata }),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.setVariantPublication(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function setCategoryPublication(
  request: Request,
  context: RequestContext,
  service: StorefrontPublishingCommands,
  salesChannelId: string,
  categoryId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const parentCategoryId = optionalUuid(body, "parentCategoryId");
  const sortOrder = optionalInteger(body, "sortOrder");
  const scheduledFor = optionalString(body, "scheduledFor", 64);
  const input: SetCategoryPublicationInput = {
    storefrontId: requiredUuid(body, "storefrontId"),
    salesChannelId: pathUuid(salesChannelId, "salesChannelId"),
    categoryId: pathUuid(categoryId, "categoryId"),
    ...(parentCategoryId === undefined ? {} : { parentCategoryId }),
    publicSlug: requiredString(body, "publicSlug", 180),
    ...(sortOrder === undefined ? {} : { sortOrder }),
    state: requiredEnum(body, "state", publicationStates),
    ...(scheduledFor === undefined ? {} : { scheduledFor }),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.setCategoryPublication(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function setCollection(
  request: Request,
  context: RequestContext,
  service: StorefrontPublishingCommands,
  salesChannelId: string,
  collectionCode: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const description = optionalString(body, "description", 2000);
  const scheduledFor = optionalString(body, "scheduledFor", 64);
  const input: SetCollectionInput = {
    storefrontId: requiredUuid(body, "storefrontId"),
    salesChannelId: pathUuid(salesChannelId, "salesChannelId"),
    code: collectionCode,
    publicSlug: requiredString(body, "publicSlug", 180),
    title: requiredString(body, "title", 200),
    ...(description === undefined ? {} : { description }),
    state: requiredEnum(body, "state", publicationStates),
    ...(scheduledFor === undefined ? {} : { scheduledFor }),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.setCollection(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function replaceCollectionMembers(
  request: Request,
  context: RequestContext,
  service: StorefrontPublishingCommands,
  collectionId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const result = await service.replaceCollectionMembers(context, {
    collectionId: pathUuid(collectionId, "collectionId"),
    members: members(body),
    idempotencyKey: idempotencyKey(request),
  });
  return dataResponse(result);
}

async function publishNavigation(
  request: Request,
  context: RequestContext,
  service: StorefrontPublishingCommands,
  storefrontId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const result = await service.publishNavigation(context, {
    storefrontId: pathUuid(storefrontId, "storefrontId"),
    placement: requiredEnum(body, "placement", placements),
    navigationDocument: requiredRecord(body, "navigationDocument"),
    idempotencyKey: idempotencyKey(request),
  });
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function publishContentPage(
  request: Request,
  context: RequestContext,
  service: StorefrontPublishingCommands,
  storefrontId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const seoDocument = optionalRecord(body, "seoDocument");
  const scheduledFor = optionalString(body, "scheduledFor", 64);
  const input: PublishContentPageInput = {
    storefrontId: pathUuid(storefrontId, "storefrontId"),
    publicSlug: requiredString(body, "publicSlug", 180),
    title: requiredString(body, "title", 240),
    status: requiredEnum(body, "status", contentStatuses),
    contentDocument: requiredRecord(body, "contentDocument"),
    ...(seoDocument === undefined ? {} : { seoDocument }),
    ...(scheduledFor === undefined ? {} : { scheduledFor }),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.publishContentPage(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function publishHomepage(
  request: Request,
  context: RequestContext,
  service: StorefrontPublishingCommands,
  storefrontId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const seoDocument = optionalRecord(body, "seoDocument");
  const scheduledFor = optionalString(body, "scheduledFor", 64);
  const input: PublishHomepageInput = {
    storefrontId: pathUuid(storefrontId, "storefrontId"),
    status: requiredEnum(body, "status", homepageStatuses),
    homepageDocument: requiredRecord(body, "homepageDocument"),
    ...(seoDocument === undefined ? {} : { seoDocument }),
    ...(scheduledFor === undefined ? {} : { scheduledFor }),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.publishHomepage(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

export async function handleStorefrontPublishingRequest(
  request: Request,
  url: URL,
  context: RequestContext,
  database: NeonDatabase,
  publishingService: StorefrontPublishingCommands = commands(database),
): Promise<Response | null> {
  const variant = url.pathname.match(
    /^\/v1\/storefront\/sales-channels\/([^/]+)\/products\/([^/]+)\/variants\/([^/]+)\/publication$/u,
  );
  if (request.method === "PUT" && variant?.[1] && variant[2] && variant[3]) {
    return await setVariantPublication(request, context, publishingService, variant[1], variant[2], variant[3]);
  }

  const category = url.pathname.match(
    /^\/v1\/storefront\/sales-channels\/([^/]+)\/categories\/([^/]+)\/publication$/u,
  );
  if (request.method === "PUT" && category?.[1] && category[2]) {
    return await setCategoryPublication(request, context, publishingService, category[1], category[2]);
  }

  const collection = url.pathname.match(/^\/v1\/storefront\/sales-channels\/([^/]+)\/collections\/([^/]+)$/u);
  if (request.method === "PUT" && collection?.[1] && collection[2]) {
    return await setCollection(request, context, publishingService, collection[1], collection[2]);
  }

  const collectionMembers = url.pathname.match(/^\/v1\/storefront\/collections\/([^/]+)\/members$/u);
  if (request.method === "PUT" && collectionMembers?.[1]) {
    return await replaceCollectionMembers(request, context, publishingService, collectionMembers[1]);
  }

  const navigation = url.pathname.match(/^\/v1\/storefront\/storefronts\/([^/]+)\/navigation-revisions$/u);
  if (request.method === "POST" && navigation?.[1]) {
    return await publishNavigation(request, context, publishingService, navigation[1]);
  }

  const contentPage = url.pathname.match(/^\/v1\/storefront\/storefronts\/([^/]+)\/content-pages$/u);
  if (request.method === "POST" && contentPage?.[1]) {
    return await publishContentPage(request, context, publishingService, contentPage[1]);
  }

  const homepage = url.pathname.match(/^\/v1\/storefront\/storefronts\/([^/]+)\/homepage-revisions$/u);
  if (request.method === "POST" && homepage?.[1]) {
    return await publishHomepage(request, context, publishingService, homepage[1]);
  }

  return null;
}
