import type { RequestContext } from "../../../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../../../packages/foundation/src/ids.js";
import { LocalizationService } from "../../../../../modules/localization/src/service.js";
import { NeonLocalizationStore } from "../../../../../modules/localization/src/store.js";
import {
  bodyRecord,
  dataResponse,
  idempotencyKey,
  optionalString,
  optionalUuid,
  pathUuid,
  requestHash,
  requiredEnum,
  requiredString,
  requiredUuid,
} from "../../finance-handler-utils.js";

const allocationModes = ["online", "offline_block"] as const;

function service(database: NeonDatabase): LocalizationService {
  return new LocalizationService(new NeonLocalizationStore(database));
}

async function activateCountryPack(request: Request, context: RequestContext, database: NeonDatabase): Promise<Response> {
  const body = await bodyRecord(request);
  const key = idempotencyKey(request);
  const command = {
    activationId: optionalUuid(body, "activationId") ?? uuidV7(),
    packVersionId: requiredUuid(body, "packVersionId"),
    effectiveFrom: requiredString(body, "effectiveFrom", 10),
    reason: requiredString(body, "reason", 1000),
    idempotencyKey: key,
  };
  const hash = await requestHash(command);
  const result = await service(database).activateCountryPack(context, { ...command, requestHash: hash });
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function allocateLegalNumber(
  request: Request,
  context: RequestContext,
  database: NeonDatabase,
  scopeId: string,
): Promise<Response> {
  const body = await bodyRecord(request);
  const deviceId = optionalString(body, "deviceId", 256);
  const command = {
    allocationId: optionalUuid(body, "allocationId") ?? uuidV7(),
    scopeId: pathUuid(scopeId, "scopeId"),
    operationId: requiredString(body, "operationId", 256),
    allocationMode: requiredEnum(body, "allocationMode", allocationModes),
    ...(deviceId ? { deviceId } : {}),
  };
  const result = await service(database).allocateLegalNumber(context, command);
  return dataResponse(result, result.replayed ? 200 : 201);
}

async function effectiveConfiguration(url: URL, context: RequestContext, database: NeonDatabase): Promise<Response> {
  const onDate = url.searchParams.get("onDate")?.trim() || context.businessDate;
  if (onDate.length > 10) throw new PlatformError("VALIDATION_FAILED", "onDate must use YYYY-MM-DD", 400);
  return dataResponse(await service(database).readEffectiveConfiguration(context, onDate));
}

export async function handleLocalizationRequest(
  request: Request,
  url: URL,
  context: RequestContext,
  database: NeonDatabase,
): Promise<Response | null> {
  if (request.method === "POST" && url.pathname === "/v1/localization/activations") {
    return await activateCountryPack(request, context, database);
  }
  const allocation = url.pathname.match(/^\/v1\/localization\/legal-number-scopes\/([^/]+)\/allocations$/u);
  if (request.method === "POST" && allocation?.[1]) {
    return await allocateLegalNumber(request, context, database, allocation[1]);
  }
  if (request.method === "GET" && url.pathname === "/v1/localization/effective-configuration") {
    return await effectiveConfiguration(url, context, database);
  }
  return null;
}
