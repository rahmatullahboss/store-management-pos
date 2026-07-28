import { businessDate, locale, timeZone } from "../../../packages/foundation/src/localization.js";
import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";
import type { TokenVerifier } from "./auth.js";
import { bearerToken } from "./auth.js";

export async function buildRequestContext(request: Request, verifier: TokenVerifier, region: string): Promise<RequestContext> {
  const identity = await verifier.verify(bearerToken(request));
  const requestId = request.headers.get("x-request-id") ?? uuidV7();
  const traceId = request.headers.get("traceparent") ?? requestId;
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  return {
    requestId: requestId as RequestContext["requestId"],
    traceId,
    tenantId: identity.tenantId as RequestContext["tenantId"],
    actorId: identity.userId as RequestContext["actorId"],
    ...(identity.legalEntityId ? { legalEntityId: identity.legalEntityId as NonNullable<RequestContext["legalEntityId"]> } : {}),
    ...(identity.storeId ? { storeId: identity.storeId as NonNullable<RequestContext["storeId"]> } : {}),
    ...(identity.warehouseId ? { warehouseId: identity.warehouseId as NonNullable<RequestContext["warehouseId"]> } : {}),
    ...(identity.registerId ? { registerId: identity.registerId as NonNullable<RequestContext["registerId"]> } : {}),
    ...(identity.deviceId ? { deviceId: identity.deviceId as NonNullable<RequestContext["deviceId"]> } : {}),
    ...(identity.impersonatorId ? { impersonatorId: identity.impersonatorId as NonNullable<RequestContext["impersonatorId"]> } : {}),
    locale: locale(request.headers.get("accept-language")?.split(",")[0] ?? "en-GB"),
    timeZone: timeZone(request.headers.get("x-time-zone") ?? "UTC"),
    businessDate: businessDate(request.headers.get("x-business-date") ?? date),
    region,
    permissions: new Set(identity.permissions),
  };
}
