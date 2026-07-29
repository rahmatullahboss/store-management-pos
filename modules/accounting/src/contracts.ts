import type { AuditMetadataV1, MoneyV1, ScopeContextV1 } from "../../../packages/contracts/src/v1/common.js";

export interface JournalLineV1 {
  readonly accountId: string;
  readonly accountCode: string;
  readonly debit: MoneyV1;
  readonly credit: MoneyV1;
  readonly baseDebit: MoneyV1;
  readonly baseCredit: MoneyV1;
  readonly dimensions: Readonly<Record<string, string>>;
  readonly sourceLineId?: string;
}

export interface JournalPostingCommandV1 {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly journalId: string;
  readonly postingGroupId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly postingRuleVersion: string;
  readonly lines: readonly JournalLineV1[];
  readonly idempotencyKey: string;
  readonly audit: AuditMetadataV1;
}

export interface JournalResultV1 {
  readonly journalId: string;
  readonly postingGroupId: string;
  readonly status: "posted" | "reversed";
  readonly totalDebit: MoneyV1;
  readonly totalCredit: MoneyV1;
  readonly reversalOfJournalId?: string;
  readonly postedAt: string;
}

export interface OpenItemBalanceV1 {
  readonly openItemId: string;
  readonly partyType: "customer" | "supplier";
  readonly partyId: string;
  readonly documentType: string;
  readonly documentId: string;
  readonly original: MoneyV1;
  readonly allocated: MoneyV1;
  readonly outstanding: MoneyV1;
  readonly dueDate?: string;
  readonly status: "open" | "partially_allocated" | "settled" | "written_off";
}
