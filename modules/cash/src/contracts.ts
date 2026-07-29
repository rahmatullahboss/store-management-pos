import type {
  AuditMetadataV1,
  MoneyV1,
  ScopeContextV1,
} from "../../../packages/contracts/src/v1/common.js";

export type CashShiftStatus = "opening" | "open" | "closing" | "closed" | "review_required";

export type CashEventKind =
  | "opening_float"
  | "cash_sale"
  | "cash_refund"
  | "paid_in"
  | "paid_out"
  | "safe_drop"
  | "closing_adjustment"
  | "reversal";

export interface CashEventV1 {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly cashEventId: string;
  readonly shiftId: string;
  readonly kind: CashEventKind;
  readonly amount: MoneyV1;
  readonly sourceType: "checkout" | "refund" | "manual" | "safe" | "reconciliation";
  readonly sourceId: string;
  readonly operationId: string;
  readonly reversalOfCashEventId?: string;
  readonly occurredAt: string;
  readonly audit: AuditMetadataV1;
}

export interface CashShiftSnapshotV1 {
  readonly schemaVersion: "1.0";
  readonly shiftId: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly storeId: string;
  readonly registerId: string;
  readonly cashierId: string;
  readonly businessDate: string;
  readonly status: CashShiftStatus;
  readonly openedAt: string;
  readonly closedAt?: string;
  readonly expectedCash: MoneyV1;
  readonly eventCount: number;
  readonly lastEventSequence: string;
  readonly version: string;
}

export interface BlindCashCountV1 {
  readonly countId: string;
  readonly shiftId: string;
  readonly countedAmount: MoneyV1;
  readonly denominationBreakdown?: Readonly<Record<string, string>>;
  readonly countedAt: string;
  readonly countedBy: string;
  readonly deviceId: string;
}

export interface CashReconciliationResultV1 {
  readonly shiftId: string;
  readonly countId: string;
  readonly expectedCash: MoneyV1;
  readonly countedCash: MoneyV1;
  readonly variance: MoneyV1;
  readonly status: "balanced" | "within_tolerance" | "approval_required" | "approved";
  readonly approvalId?: string;
  readonly reconciledAt: string;
  readonly version: string;
}
