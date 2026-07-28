export const CONTRACT_PACK_VERSION = "1.0.0" as const;
export type ContractVersion = typeof CONTRACT_PACK_VERSION;

export interface ScopeContextV1 {
  readonly tenantId: string;
  readonly legalEntityId?: string;
  readonly storeId?: string;
  readonly warehouseId?: string;
  readonly registerId?: string;
  readonly actorId: string;
  readonly deviceId?: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly businessDate: string;
}

export interface MoneyV1 { readonly amountMinor: string; readonly currency: string; readonly scale: number }
export interface QuantityV1 { readonly amount: string; readonly unit: string; readonly scale: number }
export interface AuditMetadataV1 { readonly actorId: string; readonly reason?: string; readonly approverId?: string; readonly requestId: string; readonly traceId: string; readonly deviceId?: string }
export interface VersionMetadataV1 { readonly version: string; readonly etag: string }
export interface PaginationRequestV1 { readonly cursor?: string; readonly limit: number; readonly sort?: readonly string[] }
export interface PageV1<T> { readonly items: readonly T[]; readonly nextCursor?: string; readonly totalEstimate?: number }
export interface ErrorV1 { readonly code: string; readonly message: string; readonly requestId: string; readonly details?: Readonly<Record<string, unknown>> }
export interface IdempotencyMetadataV1 { readonly key: string; readonly requestHash: string; readonly replayed: boolean }
