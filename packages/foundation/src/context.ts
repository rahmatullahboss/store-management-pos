import type { BusinessDate, Locale, TimeZone } from "./localization.js";
import type { DeviceId, LegalEntityId, RegisterId, RequestId, StoreId, TenantId, UserId, WarehouseId } from "./ids.js";

export interface RequestContext {
  readonly requestId: RequestId;
  readonly traceId: string;
  readonly tenantId: TenantId;
  readonly actorId: UserId;
  readonly legalEntityId?: LegalEntityId;
  readonly storeId?: StoreId;
  readonly warehouseId?: WarehouseId;
  readonly registerId?: RegisterId;
  readonly deviceId?: DeviceId;
  readonly locale: Locale;
  readonly timeZone: TimeZone;
  readonly businessDate: BusinessDate;
  readonly region: string;
  readonly permissions: ReadonlySet<string>;
  readonly impersonatorId?: UserId;
}

export function requirePermission(context: RequestContext, permission: string): void {
  if (!context.permissions.has(permission)) throw new Error(`Permission denied: ${permission}`);
}
