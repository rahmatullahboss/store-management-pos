import type {
  AuditMetadataV1,
  MoneyV1,
  QuantityV1,
  ScopeContextV1,
} from "../../../packages/contracts/src/v1/common.js";

export type PosCheckoutStatus =
  | "accepted_online"
  | "accepted_offline_pending_sync"
  | "rejected"
  | "review_required"
  | "payment_unknown";

export type PosTenderKind = "cash" | "external_card" | "stored_value" | "account_credit";

export interface PosLineSnapshotV1 {
  readonly lineId: string;
  readonly variantId: string;
  readonly quantity: QuantityV1;
  readonly unitPrice: MoneyV1;
  readonly grossAmount: MoneyV1;
  readonly discountAmount: MoneyV1;
  readonly taxAmount: MoneyV1;
  readonly netAmount: MoneyV1;
  readonly priceSnapshotId: string;
  readonly taxSnapshotId: string;
  readonly promotionSnapshotIds: readonly string[];
}

export interface PosTenderRequestV1 {
  readonly tenderId: string;
  readonly kind: PosTenderKind;
  readonly amount: MoneyV1;
  readonly paymentIntentId?: string;
  readonly providerCapabilityId?: string;
}

export interface PosCheckoutCommandV1 {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly checkoutId: string;
  readonly cartId: string;
  readonly registerSessionId: string;
  readonly customerId?: string;
  readonly lines: readonly PosLineSnapshotV1[];
  readonly tenders: readonly PosTenderRequestV1[];
  readonly receiptNumberAllocationId?: string;
  readonly offlineAuthorizationId?: string;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly audit: AuditMetadataV1;
}

export interface ReceiptSnapshotV1 {
  readonly schemaVersion: "1.0";
  readonly receiptId: string;
  readonly receiptNumber: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly storeId: string;
  readonly registerId: string;
  readonly businessDate: string;
  readonly issuedAt: string;
  readonly saleId: string;
  readonly checkoutId: string;
  readonly customerId?: string;
  readonly lines: readonly PosLineSnapshotV1[];
  readonly tenders: readonly PosTenderRequestV1[];
  readonly subtotal: MoneyV1;
  readonly discountTotal: MoneyV1;
  readonly taxTotal: MoneyV1;
  readonly grandTotal: MoneyV1;
  readonly sourceOperationId: string;
  readonly sourceMode: "online" | "offline";
  readonly contentHash: string;
}

export interface PosCheckoutResultV1 {
  readonly checkoutId: string;
  readonly operationId: string;
  readonly status: PosCheckoutStatus;
  readonly saleId?: string;
  readonly receipt?: ReceiptSnapshotV1;
  readonly paymentIntentIds: readonly string[];
  readonly stockPostingIds: readonly string[];
  readonly cashEventIds: readonly string[];
  readonly accountingPostingId?: string;
  readonly reviewReason?: string;
  readonly observedAt: string;
  readonly version: string;
}

export interface ReceiptDeliveryRequestV1 {
  readonly requestId: string;
  readonly receiptId: string;
  readonly channel: "print" | "email" | "sms";
  readonly destination?: string;
  readonly requestedAt: string;
  readonly requestedBy: string;
}

export interface RegisterDeviceHealthEventV1 {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly deviceId: string;
  readonly registerId: string;
  readonly status: "healthy" | "degraded" | "offline" | "revoked";
  readonly clockDriftMs: number;
  readonly localStorageFreeBytes: string;
  readonly pendingOperationCount: number;
  readonly hardwareAgentVersion?: string;
  readonly observedAt: string;
}
