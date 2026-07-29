import type {
  MoneyV1,
  ScopeContextV1,
} from "../../../packages/contracts/src/v1/common.js";

export type OfflineOperationType =
  | "checkout"
  | "cash_event"
  | "shift_open"
  | "shift_close"
  | "receipt_delivery"
  | "device_health";

export type OfflineOperationOutcomeStatus =
  | "applied"
  | "duplicate"
  | "rejected"
  | "review_required"
  | "deferred";

export interface OfflineRiskLimitsV1 {
  readonly maximumSaleAmount: MoneyV1;
  readonly maximumRefundAmount: MoneyV1;
  readonly maximumOperations: number;
  readonly maximumPendingAgeSeconds: number;
  readonly allowedTenderKinds: readonly ("cash" | "external_card" | "stored_value" | "account_credit")[];
}

export interface OfflineAuthorizationV1 {
  readonly schemaVersion: "1.0";
  readonly authorizationId: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly storeId: string;
  readonly registerId: string;
  readonly deviceId: string;
  readonly cashierId: string;
  readonly permissionSnapshotVersion: string;
  readonly countryCapabilityVersion: string;
  readonly receiptNumberAllocationId: string;
  readonly riskLimits: OfflineRiskLimitsV1;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signature: string;
  readonly keyId: string;
}

export interface OfflineOperationEnvelopeV1 {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly operationId: string;
  readonly deviceId: string;
  readonly sequence: string;
  readonly operationType: OfflineOperationType;
  readonly aggregateId: string;
  readonly aggregateVersion: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadHash: string;
  readonly authorizationId: string;
  readonly recordedAt: string;
  readonly localSchemaVersion: string;
  readonly appVersion: string;
}

export interface OfflineOperationOutcomeV1 {
  readonly operationId: string;
  readonly status: OfflineOperationOutcomeStatus;
  readonly serverSequence?: string;
  readonly businessEffectIds: readonly string[];
  readonly reasonCode?: string;
  readonly reasonMessage?: string;
  readonly reviewedBy?: string;
  readonly observedAt: string;
}

export interface OfflineSyncBatchRequestV1 {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly deviceId: string;
  readonly uploadCursor?: string;
  readonly downloadCursor?: string;
  readonly operations: readonly OfflineOperationEnvelopeV1[];
  readonly projectionVersions: Readonly<Record<string, string>>;
  readonly requestedAt: string;
}

export interface OfflineSyncBatchResultV1 {
  readonly deviceId: string;
  readonly uploadCursor: string;
  readonly downloadCursor: string;
  readonly outcomes: readonly OfflineOperationOutcomeV1[];
  readonly projectionChanges: readonly ProjectionChangeV1[];
  readonly authorization?: OfflineAuthorizationV1;
  readonly serverTime: string;
  readonly nextSyncAfterMs: number;
}

export interface ProjectionChangeV1 {
  readonly projection: "catalog" | "barcode" | "price" | "tax" | "permission" | "country_capability";
  readonly entityId: string;
  readonly version: string;
  readonly operation: "upsert" | "delete";
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly contentHash: string;
}

export interface LocalCompatibilityV1 {
  readonly localSchemaVersion: string;
  readonly minimumReadableOperationVersion: string;
  readonly maximumWritableOperationVersion: string;
  readonly pendingOperationCount: number;
  readonly updateAllowed: boolean;
  readonly blockingReason?: string;
}
