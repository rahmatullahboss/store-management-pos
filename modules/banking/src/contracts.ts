import type { AuditMetadataV1, MoneyV1, ScopeContextV1 } from "../../../packages/contracts/src/v1/common.js";

export interface BankStatementLineV1 {
  readonly statementLineId: string;
  readonly bankAccountId: string;
  readonly bookedAt: string;
  readonly valueDate?: string;
  readonly amount: MoneyV1;
  readonly reference: string;
  readonly externalId?: string;
  readonly fingerprint: string;
}

export interface ReconciliationCommandV1 {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly reconciliationId: string;
  readonly statementLineId: string;
  readonly candidateType: "settlement" | "payment" | "supplier_payment" | "cash_deposit" | "journal";
  readonly candidateId: string;
  readonly amount: MoneyV1;
  readonly idempotencyKey: string;
  readonly audit: AuditMetadataV1;
}

export interface BankReconciliationResultV1 {
  readonly reconciliationId: string;
  readonly statementLineId: string;
  readonly candidateId: string;
  readonly status: "matched" | "reversed" | "exception";
  readonly matchedAmount: MoneyV1;
  readonly reconciledAt: string;
  readonly reversalOfReconciliationId?: string;
}
