import type { RequestContext } from "../../../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import {
  SqlStorefrontPublicationRepository,
  StorefrontPublicationService,
  type CollectionMembersResult,
  type ContentPageStatus,
  type HomepageStatus,
  type NavigationPlacement,
  type PublicationResult,
  type PublishContentPageInput,
  type PublishHomepageInput,
  type PublishNavigationInput,
  type ReplaceCollectionMembersInput,
  type RevisionResult,
  type SetCategoryPublicationInput,
  type SetCollectionInput,
  type SetVariantPublicationInput,
  type StatusRevisionResult,
  type StorefrontPublicationRepository,
  type VariantPublicationState,
  type PublicationState,
} from "../../../../../modules/storefront/src/publication.js";
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
  requiredInteger,
  requiredRecord,
  requiredString,
  requiredUuid,
} from "../../finance-handler-utils.js";

const publicationStates = [
  "draft",
  "scheduled",
  "published",
  "hidden",
  "archived",
] as const satisfies readonly PublicationState[];
const variantStates = [
  "published",
  "hidden",
  "archived",
] as const satisfies readonly VariantPublicationState[];
const contentStatuses = [
  "scheduled",
  "published",
  "hidden",
  "archived",
] as const satisfies readonly ContentPageStatus[];
const homepageStatuses = [
  "scheduled",
  "published",
  "archived",
] as const satisfies readonly HomepageStatus[];
const navigationPlacements = [
  "header",
  "footer",
  "utility",
] as const satisfies readonly NavigationPlacement[];

export interface StorefrontPublicationCommands {
  setVariantPublication(
    context: RequestContext,
    input: SetVariantPublicationInput,
  ): Promise<PublicationResult>;
  setCategoryPublication(
    context: RequestContext,
    input: SetCategoryPublicationInput,
  ): Promise<PublicationResult>;
  setCollection(
    context: RequestContext,
    input: SetCollectionInput,
  ): Promise<PublicationResult>;
  replaceCollectionMembers(
    context: RequestContext,
    input: ReplaceCollectionMembersInput,
  ): Promise<CollectionMembersResult>;
  publishNavigation(
    context: RequestContext,
    input: PublishNavigationInput,
  ): Promise<RevisionResult>;
  publishContentPage(
    context: RequestContext,
    input: PublishContentPageInput,
  ): Promise<StatusRevisionResult>;
  publishHomepage(
    context: RequestContext,
    input: PublishHomepageInput,
  ): Promise<StatusRevisionResult>;
}

function commands(database: NeonDatabase): StorefrontPublicationCommands {
  const repository: StorefrontPublicationRepository =
    new SqlStorefrontPublicationRepository(database);
  return new StorefrontPublicationService(repository);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PlatformError("VALIDATION_FAILED", `${label} must be an object`, 400);
  }
  return value as Record<string, unknown>;
}

async function setVariantPublication(
  request: Request,
  context: RequestContext,
  service: StorefrontPublicationCommands,
  salesChannelId: string,
  productId: string,
  variantId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const publicSlugSuffix = optionalString(body, "publicSlugSuffix", 180);
  const metadata = optionalRecord(body, "metadata");
  const input: SetVariantPublicationInput = {
    storefrontId: requiredUuid(body, "storefrontId"),
    salesChannelId: pathUuid(salesChannelId, "salesChannelId"),
    productId: pathUuid(productId, "productId"),
    variantId: pathUuid(variantId, "variantId"),
    state: requiredEnum(body, "state", variantStates),
    ...(publicSlugSuffix === undefined ? {} : { publicSlugSuffix }),
    ...(metadata === undefined ? {} : { metadata }),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.setVariantPublication(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function setCategoryPublication(
  request: Request,
  context: RequestContext,
  service: StorefrontPublicationCommands,
  salesChannelId: string,
  categoryId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const parentCategoryId = optionalUuid(body, "parentCategoryId");
  const scheduledFor = optionalString(body, "scheduledFor", 64);
  const input: SetCategoryPublicationInput = {
    storefrontId: requiredUuid(body, "storefrontId"),
    salesChannelId: pathUuid(salesChannelId, "salesChannelId"),
    categoryId: pathUuid(categoryId, "categoryId"),
    ...(parentCategoryId === undefined ? {} : { parentCategoryId }),
    publicSlug: requiredString(body, "publicSlug", 180),
    sortOrder: requiredInteger(body, "sortOrder"),
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
  service: StorefrontPublicationCommands,
  salesChannelId: string,
  collectionId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const description = optionalString(body, "description", 4_000);
  const scheduledFor = optionalString(body, "scheduledFor", 64);
  const input: SetCollectionInput = {
    collectionId: pathUuid(collectionId, "collectionId"),
    storefrontId: requiredUuid(body, "storefrontId"),
    salesChannelId: pathUuid(salesChannelId, "salesChannelId"),
    code: requiredString(body, "code", 63),
    publicSlug: requiredString(body, "publicSlug", 180),
    title: requiredString(body, "title", 240),
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
  service: StorefrontPublicationCommands,
  collectionId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const members = requiredArray(body, "members").map((value, index) => {
    const member = record(value, `members[${index}]`);
    const variantId = optionalUuid(member, "variantId");
    return {
      memberId: requiredUuid(member, "memberId"),
      productId: requiredUuid(member, "productId"),
      ...(variantId === undefined ? {} : { variantId }),
      sortOrder: requiredInteger(member, "sortOrder"),
    };
  });
  const result = await service.replaceCollectionMembers(context, {
    collectionId: pathUuid(collectionId, "collectionId"),
    members,
    idempotencyKey: idempotencyKey(request),
  });
  return dataResponse(result);
}

async function publishNavigation(
  request: Request,
  context: RequestContext,
  service: StorefrontPublicationCommands,
  storefrontId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const input: PublishNavigationInput = {
    storefrontId: pathUuid(storefrontId, "storefrontId"),
    placement: requiredEnum(body, "placement", navigationPlacements),
    navigationDocument: requiredRecord(body, "navigationDocument"),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.publishNavigation(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function publishContentPage(
  request: Request,
  context: RequestContext,
  service: StorefrontPublicationCommands,
  storefrontId: string,
  contentPageId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const seoDocument = optionalRecord(body, "seoDocument");
  const scheduledFor = optionalString(body, "scheduledFor", 64);
  const input: PublishContentPageInput = {
    contentPageId: pathUuid(contentPageId, "contentPageId"),
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
  service: StorefrontPublicationCommands,
  storefrontId: string,
  homepageId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const seoDocument = optionalRecord(body, "seoDocument");
  const scheduledFor = optionalString(body, "scheduledFor", 64);
  const input: PublishHomepageInput = {
    homepageId: pathUuid(homepageId, "homepageId"),
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

export async function handleStorefrontPublicationRequest(
  request: Request,
  url: URL,
  context: RequestContext,
  database: NeonDatabase,
  service: StorefrontPublicationCommands = commands(database),
): Promise<Response | null> {
  const variantPublication = url.pathname.match(
    /^\/v1\/storefront\/sales-channels\/([^/]+)\/products\/([^/]+)\/variants\/([^/]+)\/publication$/u,
  );
  if (
    request.method === "PUT" &&
    variantPublication?.[1] &&
    variantPublication[2] &&
    variantPublication[3]
  ) {
    return await setVariantPublication(
      request,
      context,
      service,
      variantPublication[1],
      variantPublication[2],
      variantPublication[3],
    );
  }

  const categoryPublication = url.pathname.match(
    /^\/v1\/storefront\/sales-channels\/([^/]+)\/categories\/([^/]+)\/publication$/u,
  );
  if (
    request.method === "PUT" &&
    categoryPublication?.[1] &&
    categoryPublication[2]
  ) {
    return await setCategoryPublication(
      request,
      context,
      service,
      categoryPublication[1],
      categoryPublication[2],
    );
  }

  const collection = url.pathname.match(
    /^\/v1\/storefront\/sales-channels\/([^/]+)\/collections\/([^/]+)$/u,
  );
  if (request.method === "PUT" && collection?.[1] && collection[2]) {
    return await setCollection(
      request,
      context,
      service,
      collection[1],
      collection[2],
    );
  }

  const collectionMembers = url.pathname.match(
    /^\/v1\/storefront\/collections\/([^/]+)\/members$/u,
  );
  if (request.method === "PUT" && collectionMembers?.[1]) {
    return await replaceCollectionMembers(
      request,
      context,
      service,
      collectionMembers[1],
    );
  }

  const navigation = url.pathname.match(
    /^\/v1\/storefront\/storefronts\/([^/]+)\/navigation-revisions$/u,
  );
  if (request.method === "POST" && navigation?.[1]) {
    return await publishNavigation(request, context, service, navigation[1]);
  }

  const contentPage = url.pathname.match(
    /^\/v1\/storefront\/storefronts\/([^/]+)\/content-pages\/([^/]+)\/revisions$/u,
  );
  if (request.method === "POST" && contentPage?.[1] && contentPage[2]) {
    return await publishContentPage(
      request,
      context,
      service,
      contentPage[1],
      contentPage[2],
    );
  }

  const homepage = url.pathname.match(
    /^\/v1\/storefront\/storefronts\/([^/]+)\/homepage-revisions\/([^/]+)$/u,
  );
  if (request.method === "POST" && homepage?.[1] && homepage[2]) {
    return await publishHomepage(
      request,
      context,
      service,
      homepage[1],
      homepage[2],
    );
  }

  return null;
}
