import type { RequestContext } from "../../../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import {
  SqlStorefrontCommandRepository,
  StorefrontCommandService,
  type CreateSalesChannelInput,
  type CreateStorefrontInput,
  type PublishThemeInput,
  type RecordDomainVerificationInput,
  type RegisterDomainInput,
  type SetProductPublicationInput,
  type StorefrontCertificateStatus,
  type StorefrontDomainStatus,
  type StorefrontLifecycleStatus,
  type StorefrontPublicationState,
  type TransitionDomainInput,
} from "../../../../../modules/storefront/src/index.js";
import {
  bodyRecord,
  dataResponse,
  idempotencyKey,
  optionalEnum,
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

const lifecycleStatuses = ["draft", "active", "suspended", "archived"] as const satisfies readonly StorefrontLifecycleStatus[];
const publicationStates = ["draft", "scheduled", "published", "hidden", "archived"] as const satisfies readonly StorefrontPublicationState[];
const domainKinds = ["platform_subdomain", "custom"] as const;
const verificationMethods = ["dns_txt", "dns_cname", "http"] as const;
const challengeTypes = ["dns_txt", "dns_cname", "http"] as const;
const verificationStatuses = ["pending", "verified", "failed", "expired"] as const;
const domainStatuses = [
  "pending",
  "verification_pending",
  "certificate_pending",
  "active",
  "suspended",
  "failed",
  "deleting",
  "deleted",
] as const satisfies readonly StorefrontDomainStatus[];
const certificateStatuses = ["none", "pending", "active", "expiring", "failed", "revoked"] as const satisfies readonly StorefrontCertificateStatus[];
const backorderPolicies = ["deny", "allow", "preorder_only"] as const;

export interface StorefrontCommands {
  createStorefront(context: RequestContext, input: CreateStorefrontInput): ReturnType<StorefrontCommandService["createStorefront"]>;
  transitionStorefront(context: RequestContext, input: Parameters<StorefrontCommandService["transitionStorefront"]>[1]): ReturnType<StorefrontCommandService["transitionStorefront"]>;
  createSalesChannel(context: RequestContext, input: CreateSalesChannelInput): ReturnType<StorefrontCommandService["createSalesChannel"]>;
  transitionSalesChannel(context: RequestContext, input: Parameters<StorefrontCommandService["transitionSalesChannel"]>[1]): ReturnType<StorefrontCommandService["transitionSalesChannel"]>;
  setProductPublication(context: RequestContext, input: SetProductPublicationInput): ReturnType<StorefrontCommandService["setProductPublication"]>;
  registerDomain(context: RequestContext, input: RegisterDomainInput): ReturnType<StorefrontCommandService["registerDomain"]>;
  recordDomainVerification(context: RequestContext, input: RecordDomainVerificationInput): ReturnType<StorefrontCommandService["recordDomainVerification"]>;
  transitionDomain(context: RequestContext, input: TransitionDomainInput): ReturnType<StorefrontCommandService["transitionDomain"]>;
  publishTheme(context: RequestContext, input: PublishThemeInput): ReturnType<StorefrontCommandService["publishTheme"]>;
}

function commands(database: NeonDatabase): StorefrontCommands {
  return new StorefrontCommandService(new SqlStorefrontCommandRepository(database));
}

function optionalBoolean(record: Record<string, unknown>, field: string): boolean | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new PlatformError("VALIDATION_FAILED", `${field} must be a boolean`, 400);
  return value;
}

function optionalStringArray(record: Record<string, unknown>, field: string, maximum: number): readonly string[] | undefined {
  if (record[field] === undefined || record[field] === null) return undefined;
  const values = requiredArray(record, field);
  return values.map((value, index) => {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
      throw new PlatformError("VALIDATION_FAILED", `${field}[${index}] is invalid`, 400);
    }
    return value.trim();
  });
}

async function createStorefront(
  request: Request,
  context: RequestContext,
  service: StorefrontCommands,
): Promise<Response> {
  const body = await bodyRecord(request);
  const input: CreateStorefrontInput = {
    legalEntityId: requiredUuid(body, "legalEntityId"),
    ...(optionalUuid(body, "primaryStoreId") ? { primaryStoreId: optionalUuid(body, "primaryStoreId") } : {}),
    code: requiredString(body, "code", 63),
    displayName: requiredString(body, "displayName", 160),
    defaultLocale: requiredString(body, "defaultLocale", 35),
    defaultCurrency: requiredString(body, "defaultCurrency", 3),
    timeZone: requiredString(body, "timeZone", 80),
    ...(optionalString(body, "platformSubdomain", 63) ? { platformSubdomain: optionalString(body, "platformSubdomain", 63) } : {}),
    ...(optionalRecord(body, "settings") ? { settings: optionalRecord(body, "settings") } : {}),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.createStorefront(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function transitionStorefront(
  request: Request,
  context: RequestContext,
  service: StorefrontCommands,
  storefrontId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  return dataResponse(
    await service.transitionStorefront(context, {
      storefrontId: pathUuid(storefrontId, "storefrontId"),
      status: requiredEnum(body, "status", lifecycleStatuses),
      idempotencyKey: idempotencyKey(request),
    }),
  );
}

async function createSalesChannel(
  request: Request,
  context: RequestContext,
  service: StorefrontCommands,
  storefrontId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const guestCheckoutEnabled = optionalBoolean(body, "guestCheckoutEnabled");
  const customerAccountsEnabled = optionalBoolean(body, "customerAccountsEnabled");
  const input: CreateSalesChannelInput = {
    storefrontId: pathUuid(storefrontId, "storefrontId"),
    code: requiredString(body, "code", 63),
    displayName: requiredString(body, "displayName", 160),
    priceListId: requiredUuid(body, "priceListId"),
    ...(optionalRecord(body, "inventoryScope") ? { inventoryScope: optionalRecord(body, "inventoryScope") } : {}),
    ...(optionalStringArray(body, "allowedCountryCodes", 2) ? { allowedCountryCodes: optionalStringArray(body, "allowedCountryCodes", 2) } : {}),
    ...(guestCheckoutEnabled === undefined ? {} : { guestCheckoutEnabled }),
    ...(customerAccountsEnabled === undefined ? {} : { customerAccountsEnabled }),
    ...(optionalEnum(body, "backorderPolicy", backorderPolicies) ? { backorderPolicy: optionalEnum(body, "backorderPolicy", backorderPolicies) } : {}),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.createSalesChannel(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function transitionSalesChannel(
  request: Request,
  context: RequestContext,
  service: StorefrontCommands,
  salesChannelId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  return dataResponse(
    await service.transitionSalesChannel(context, {
      salesChannelId: pathUuid(salesChannelId, "salesChannelId"),
      status: requiredEnum(body, "status", lifecycleStatuses),
      idempotencyKey: idempotencyKey(request),
    }),
  );
}

async function setProductPublication(
  request: Request,
  context: RequestContext,
  service: StorefrontCommands,
  salesChannelId: string,
  productId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const input: SetProductPublicationInput = {
    storefrontId: requiredUuid(body, "storefrontId"),
    salesChannelId: pathUuid(salesChannelId, "salesChannelId"),
    productId: pathUuid(productId, "productId"),
    publicSlug: requiredString(body, "publicSlug", 180),
    state: requiredEnum(body, "state", publicationStates),
    ...(optionalString(body, "scheduledFor", 64) ? { scheduledFor: optionalString(body, "scheduledFor", 64) } : {}),
    ...(optionalRecord(body, "metadata") ? { metadata: optionalRecord(body, "metadata") } : {}),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.setProductPublication(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function registerDomain(
  request: Request,
  context: RequestContext,
  service: StorefrontCommands,
  storefrontId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const input: RegisterDomainInput = {
    storefrontId: pathUuid(storefrontId, "storefrontId"),
    hostname: requiredString(body, "hostname", 253),
    kind: requiredEnum(body, "kind", domainKinds),
    ...(optionalEnum(body, "verificationMethod", verificationMethods)
      ? { verificationMethod: optionalEnum(body, "verificationMethod", verificationMethods) }
      : {}),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.registerDomain(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function recordDomainVerification(
  request: Request,
  context: RequestContext,
  service: StorefrontCommands,
  domainId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const input: RecordDomainVerificationInput = {
    domainId: pathUuid(domainId, "domainId"),
    attempt: requiredInteger(body, "attempt"),
    challengeType: requiredEnum(body, "challengeType", challengeTypes),
    challengeName: requiredString(body, "challengeName", 320),
    challengeValueHash: requiredString(body, "challengeValueHash", 64),
    resultStatus: requiredEnum(body, "resultStatus", verificationStatuses),
    ...(optionalString(body, "providerReference", 240) ? { providerReference: optionalString(body, "providerReference", 240) } : {}),
    ...(optionalRecord(body, "observedDetail") ? { observedDetail: optionalRecord(body, "observedDetail") } : {}),
    observedAt: requiredString(body, "observedAt", 64),
    expiresAt: requiredString(body, "expiresAt", 64),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.recordDomainVerification(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function transitionDomain(
  request: Request,
  context: RequestContext,
  service: StorefrontCommands,
  domainId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const canonical = optionalBoolean(body, "canonical");
  const input: TransitionDomainInput = {
    domainId: pathUuid(domainId, "domainId"),
    status: requiredEnum(body, "status", domainStatuses),
    certificateStatus: requiredEnum(body, "certificateStatus", certificateStatuses),
    ...(optionalString(body, "providerHostnameId", 240) ? { providerHostnameId: optionalString(body, "providerHostnameId", 240) } : {}),
    ...(optionalString(body, "failureCode", 120) ? { failureCode: optionalString(body, "failureCode", 120) } : {}),
    ...(optionalString(body, "failureDetail", 1000) ? { failureDetail: optionalString(body, "failureDetail", 1000) } : {}),
    canonical: canonical ?? false,
    idempotencyKey: idempotencyKey(request),
  };
  return dataResponse(await service.transitionDomain(context, input));
}

async function publishTheme(
  request: Request,
  context: RequestContext,
  service: StorefrontCommands,
  storefrontId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const input: PublishThemeInput = {
    storefrontId: pathUuid(storefrontId, "storefrontId"),
    themeDocument: requiredRecord(body, "themeDocument"),
    idempotencyKey: idempotencyKey(request),
  };
  const result = await service.publishTheme(context, input);
  return dataResponse(result, result.replayed ? 200 : 201);
}

export async function handleStorefrontRequest(
  request: Request,
  url: URL,
  context: RequestContext,
  database: NeonDatabase,
  commandService: StorefrontCommands = commands(database),
): Promise<Response | null> {
  if (request.method === "POST" && url.pathname === "/v1/storefront/storefronts") {
    return await createStorefront(request, context, commandService);
  }

  const storefrontTransition = url.pathname.match(/^\/v1\/storefront\/storefronts\/([^/]+)\/transition$/u);
  if (request.method === "POST" && storefrontTransition?.[1]) {
    return await transitionStorefront(request, context, commandService, storefrontTransition[1]);
  }

  const storefrontChannels = url.pathname.match(/^\/v1\/storefront\/storefronts\/([^/]+)\/sales-channels$/u);
  if (request.method === "POST" && storefrontChannels?.[1]) {
    return await createSalesChannel(request, context, commandService, storefrontChannels[1]);
  }

  const channelTransition = url.pathname.match(/^\/v1\/storefront\/sales-channels\/([^/]+)\/transition$/u);
  if (request.method === "POST" && channelTransition?.[1]) {
    return await transitionSalesChannel(request, context, commandService, channelTransition[1]);
  }

  const productPublication = url.pathname.match(
    /^\/v1\/storefront\/sales-channels\/([^/]+)\/products\/([^/]+)\/publication$/u,
  );
  if (request.method === "PUT" && productPublication?.[1] && productPublication[2]) {
    return await setProductPublication(request, context, commandService, productPublication[1], productPublication[2]);
  }

  const storefrontDomains = url.pathname.match(/^\/v1\/storefront\/storefronts\/([^/]+)\/domains$/u);
  if (request.method === "POST" && storefrontDomains?.[1]) {
    return await registerDomain(request, context, commandService, storefrontDomains[1]);
  }

  const domainVerification = url.pathname.match(/^\/v1\/storefront\/domains\/([^/]+)\/verifications$/u);
  if (request.method === "POST" && domainVerification?.[1]) {
    return await recordDomainVerification(request, context, commandService, domainVerification[1]);
  }

  const domainTransition = url.pathname.match(/^\/v1\/storefront\/domains\/([^/]+)\/transition$/u);
  if (request.method === "POST" && domainTransition?.[1]) {
    return await transitionDomain(request, context, commandService, domainTransition[1]);
  }

  const themeRevision = url.pathname.match(/^\/v1\/storefront\/storefronts\/([^/]+)\/theme-revisions$/u);
  if (request.method === "POST" && themeRevision?.[1]) {
    return await publishTheme(request, context, commandService, themeRevision[1]);
  }

  return null;
}
