import type { MoneyV1, ScopeContextV1, AuditMetadataV1 } from "../../../packages/contracts/src/v1/common.js";
import type { PaymentStatus } from "./domain.js";

export interface PaymentIntentCommandV1 {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly intentId: string;
  readonly sourceType: "invoice" | "order" | "pos_checkout" | "customer_account";
  readonly sourceId: string;
  readonly amount: MoneyV1;
  readonly providerAccountId: string;
  readonly paymentMethodToken?: string;
  readonly idempotencyKey: string;
  readonly audit: AuditMetadataV1;
}

export interface PaymentResultV1 {
  readonly intentId: string;
  readonly status: PaymentStatus;
  readonly amount: MoneyV1;
  readonly capturedAmount: MoneyV1;
  readonly refundedAmount: MoneyV1;
  readonly providerReference?: string;
  readonly version: string;
  readonly observedAt: string;
}

export interface PaymentAllocationV1 {
  readonly allocationId: string;
  readonly paymentIntentId: string;
  readonly targetType: "invoice" | "credit_note" | "customer_open_item";
  readonly targetId: string;
  readonly amount: MoneyV1;
  readonly allocatedAt: string;
}

export interface SettlementSnapshotV1 {
  readonly settlementId: string;
  readonly providerAccountId: string;
  readonly providerSettlementId: string;
  readonly gross: MoneyV1;
  readonly fees: MoneyV1;
  readonly adjustments: MoneyV1;
  readonly net: MoneyV1;
  readonly status: "imported" | "matched" | "reconciled" | "exception";
  readonly settledAt: string;
}
