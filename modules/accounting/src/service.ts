import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import type { Money } from "../../../packages/foundation/src/money.js";
import { compareMoney, money } from "../../../packages/foundation/src/money.js";
import { buildJournal, reverseJournal, type PostedJournal } from "./domain.js";

export type AccountingJournalType = "system" | "manual" | "adjustment" | "reversal" | "opening" | "closing" | "revaluation";
export type AccountingPostingKind = "ordinary" | "adjustment" | "reversal";

export interface AccountingJournalLineInput {
  readonly accountId: string;
  readonly accountCode: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly baseDebit: Money;
  readonly baseCredit: Money;
  readonly dimensions?: Readonly<Record<string, string>>;
  readonly partyType?: "customer" | "supplier" | "employee" | "tax_authority" | "payment_provider" | "bank" | "other";
  readonly partyId?: string;
  readonly sourceLineId?: string;
  readonly memo?: string;
}

export interface PostJournalCommand {
  readonly journalId: string;
  readonly postingGroupId: string;
  readonly chartId: string;
  readonly fiscalPeriodId: string;
  readonly postingRuleVersionId?: string;
  readonly journalType: AccountingJournalType;
  readonly postingKind: AccountingPostingKind;
  readonly source: { readonly type: string; readonly id: string; readonly version: string };
  readonly transactionCurrency: string;
  readonly baseCurrency: string;
  readonly exchangeRateNumerator: bigint;
  readonly exchangeRateDenominator: bigint;
  readonly lines: readonly AccountingJournalLineInput[];
  readonly approvalRequestId?: string;
  readonly reason?: string;
  readonly reversalOfJournalId?: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface PreparedJournalCommand extends PostJournalCommand {
  readonly journal: PostedJournal;
}

export interface JournalPostResult {
  readonly journalId: string;
  readonly postingGroupId: string;
  readonly status: "posted" | "reversed";
  readonly totalDebit: Money;
  readonly totalCredit: Money;
  readonly businessDate: string;
  readonly postedAt: string;
  readonly replayed: boolean;
}

export interface StoredJournal extends PostedJournal {
  readonly chartId: string;
  readonly fiscalPeriodId: string;
  readonly journalType: AccountingJournalType;
  readonly postingKind: AccountingPostingKind;
  readonly baseCurrency: string;
  readonly exchangeRateNumerator: bigint;
  readonly exchangeRateDenominator: bigint;
  readonly lines: readonly (PostedJournal["lines"][number] & AccountingJournalLineInput)[];
}

export interface ReverseJournalCommand {
  readonly originalJournalId: string;
  readonly reversalJournalId: string;
  readonly reversalPostingGroupId: string;
  readonly businessDate: string;
  readonly reason: string;
  readonly approvalRequestId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface CreateOpenItemCommand {
  readonly openItemId: string;
  readonly controlAccountId: string;
  readonly partyType: "customer" | "supplier";
  readonly partyId: string;
  readonly direction: "receivable" | "payable";
  readonly documentType: string;
  readonly documentId: string;
  readonly documentVersion: string;
  readonly amount: Money;
  readonly dueDate?: string;
  readonly journalId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface AllocateOpenItemCommand {
  readonly allocationId: string;
  readonly openItemId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly amount: Money;
  readonly journalId: string;
  readonly reason?: string;
  readonly reversalOfAllocationId?: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface OpenItemResult {
  readonly openItemId: string;
  readonly partyType: "customer" | "supplier";
  readonly partyId: string;
  readonly direction: "receivable" | "payable";
  readonly original: Money;
  readonly allocated: Money;
  readonly outstanding: Money;
  readonly status: "open" | "partially_allocated" | "settled" | "written_off" | "reversed";
  readonly replayed: boolean;
}

export interface ClosePeriodCommand {
  readonly periodId: string;
  readonly approvalRequestId?: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface ReopenPeriodCommand {
  readonly periodId: string;
  readonly approvalRequestId?: string;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface PeriodResult {
  readonly periodId: string;
  readonly status: "open" | "soft_closed" | "closed";
  readonly version: bigint;
  readonly replayed: boolean;
}

export interface AccountingTrialBalanceRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly balance: Money;
  readonly journalCount: bigint;
}

export interface TrialBalanceReport {
  readonly currency: string;
  readonly scale: number;
  readonly totalDebit: Money;
  readonly totalCredit: Money;
  readonly refreshedAt: string;
  readonly rows: readonly AccountingTrialBalanceRow[];
}

export interface GeneralLedgerRow {
  readonly journalId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly accountCode: string;
  readonly debit: Money;
  readonly credit: Money;
}

export interface GeneralLedgerReport {
  readonly refreshedAt: string;
  readonly rows: readonly GeneralLedgerRow[];
}

export interface OpenItemAgingRow {
  readonly openItemId: string;
  readonly partyType: "customer" | "supplier";
  readonly partyId: string;
  readonly outstanding: Money;
  readonly bucket: "current" | "1_30" | "31_60" | "61_90" | "over_90";
}

export interface OpenItemAgingReport {
  readonly refreshedAt: string;
  readonly rows: readonly OpenItemAgingRow[];
}

export interface AccountingStore {
  postJournal(context: RequestContext, command: PreparedJournalCommand): Promise<JournalPostResult>;
  getJournal(context: RequestContext, journalId: string): Promise<StoredJournal>;
  createOpenItem(context: RequestContext, command: CreateOpenItemCommand): Promise<OpenItemResult>;
  allocateOpenItem(context: RequestContext, command: AllocateOpenItemCommand): Promise<OpenItemResult>;
  closePeriod(context: RequestContext, command: ClosePeriodCommand & { readonly approvalRequestId: string }): Promise<PeriodResult>;
  reopenPeriod(context: RequestContext, command: ReopenPeriodCommand & { readonly approvalRequestId: string }): Promise<PeriodResult>;
  trialBalance(context: RequestContext, query: { readonly chartId: string; readonly periodId: string }): Promise<TrialBalanceReport>;
  generalLedger(context: RequestContext, query: { readonly accountId: string; readonly fromDate: string; readonly toDate: string }): Promise<GeneralLedgerReport>;
  openItemAging(context: RequestContext, query: { readonly partyType: "customer" | "supplier"; readonly asOfDate: string }): Promise<OpenItemAgingReport>;
}

function requirePermission(context: RequestContext, permission: string): void {
  if (!context.permissions.has(permission)) throw new PlatformError("PERMISSION_DENIED", `Permission denied: ${permission}`, 403);
}

function requireLegalEntity(context: RequestContext): void {
  if (!context.legalEntityId) throw new PlatformError("VALIDATION_FAILED", "A legal entity context is required", 400);
}

function requireApproval(value: string | undefined, operation: string): string {
  if (!value) throw new PlatformError("VALIDATION_FAILED", `Approval evidence is required for ${operation}`, 400);
  return value;
}

function assertPositive(value: Money, field: string): void {
  if (value.amountMinor <= 0n) throw new PlatformError("VALIDATION_FAILED", `${field} must be positive`, 400);
}

function preparedJournal(context: RequestContext, command: PostJournalCommand): PreparedJournalCommand {
  if ((command.journalType === "reversal") !== (command.postingKind === "reversal")) {
    throw new PlatformError("VALIDATION_FAILED", "Reversal journal type and posting kind must be used together", 400);
  }
  if ((command.journalType === "adjustment" || command.journalType === "revaluation") && command.postingKind !== "adjustment") {
    throw new PlatformError("VALIDATION_FAILED", "Adjustment and revaluation journals require adjustment posting kind", 400);
  }
  if (command.exchangeRateNumerator <= 0n || command.exchangeRateDenominator <= 0n) {
    throw new PlatformError("VALIDATION_FAILED", "Exchange-rate numerator and denominator must be positive", 400);
  }
  if (command.transactionCurrency !== command.lines[0]?.debit.currency) {
    throw new PlatformError("VALIDATION_FAILED", "Transaction currency does not match journal lines", 400);
  }
  for (const line of command.lines) {
    if (line.baseDebit.currency !== command.baseCurrency || line.baseCredit.currency !== command.baseCurrency) {
      throw new PlatformError("VALIDATION_FAILED", "Base currency does not match journal lines", 400);
    }
  }
  const journal = buildJournal({
    journalId: command.journalId,
    postingGroupId: command.postingGroupId,
    businessDate: context.businessDate,
    currency: command.transactionCurrency,
    source: command.source,
    lines: command.lines.map((line) => ({
      accountCode: line.accountCode,
      debit: line.debit,
      credit: line.credit,
      baseDebit: line.baseDebit,
      baseCredit: line.baseCredit,
      ...(line.dimensions ? { dimensions: line.dimensions } : {}),
      ...(line.sourceLineId ? { sourceLineId: line.sourceLineId } : {}),
    })),
    ...(command.reversalOfJournalId ? { reversalOfJournalId: command.reversalOfJournalId } : {}),
    ...(command.reason ? { correctionReason: command.reason } : {}),
  });
  return { ...command, journal };
}

export class AccountingService {
  constructor(private readonly store: AccountingStore) {}

  async postJournal(context: RequestContext, command: PostJournalCommand): Promise<JournalPostResult> {
    requireLegalEntity(context);
    if (command.journalType === "manual") requirePermission(context, "accounting.journal.manual");
    else requirePermission(context, "accounting.journal.post");
    if (command.journalType === "manual" || command.postingKind === "adjustment") {
      requireApproval(command.approvalRequestId, command.journalType === "manual" ? "manual journal" : "adjustment journal");
      if (!command.reason || command.reason.trim().length < 3) throw new PlatformError("VALIDATION_FAILED", "A correction reason is required", 400);
    }
    if (command.postingKind === "reversal") {
      requirePermission(context, "accounting.journal.reverse");
      requireApproval(command.approvalRequestId, "journal reversal");
      if (!command.reversalOfJournalId) throw new PlatformError("VALIDATION_FAILED", "Original journal reference is required", 400);
    }
    return await this.store.postJournal(context, preparedJournal(context, command));
  }

  async reverseJournal(context: RequestContext, command: ReverseJournalCommand): Promise<JournalPostResult> {
    requireLegalEntity(context);
    requirePermission(context, "accounting.journal.reverse");
    requireApproval(command.approvalRequestId, "journal reversal");
    if (command.reason.trim().length < 3) throw new PlatformError("VALIDATION_FAILED", "A reversal reason is required", 400);
    const original = await this.store.getJournal(context, command.originalJournalId);
    const reversal = reverseJournal(original, {
      journalId: command.reversalJournalId,
      businessDate: command.businessDate,
      reason: command.reason,
    });
    const lines = original.lines.map((line) => ({
      accountId: line.accountId,
      accountCode: line.accountCode,
      debit: line.credit,
      credit: line.debit,
      baseDebit: line.baseCredit,
      baseCredit: line.baseDebit,
      ...(line.dimensions ? { dimensions: line.dimensions } : {}),
      ...(line.partyType ? { partyType: line.partyType } : {}),
      ...(line.partyId ? { partyId: line.partyId } : {}),
      ...(line.sourceLineId ? { sourceLineId: line.sourceLineId } : {}),
      ...(line.memo ? { memo: line.memo } : {}),
    }));
    return await this.store.postJournal(context, {
      journalId: command.reversalJournalId,
      postingGroupId: command.reversalPostingGroupId,
      chartId: original.chartId,
      fiscalPeriodId: original.fiscalPeriodId,
      journalType: "reversal",
      postingKind: "reversal",
      source: { type: "journal_reversal", id: original.journalId, version: original.source.version },
      transactionCurrency: original.currency,
      baseCurrency: original.baseCurrency,
      exchangeRateNumerator: original.exchangeRateNumerator,
      exchangeRateDenominator: original.exchangeRateDenominator,
      lines,
      approvalRequestId: command.approvalRequestId,
      reason: command.reason,
      reversalOfJournalId: original.journalId,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      journal: reversal,
    });
  }

  async createOpenItem(context: RequestContext, command: CreateOpenItemCommand): Promise<OpenItemResult> {
    requireLegalEntity(context);
    requirePermission(context, "accounting.journal.post");
    assertPositive(command.amount, "Open-item amount");
    if ((command.partyType === "customer") !== (command.direction === "receivable")) {
      throw new PlatformError("VALIDATION_FAILED", "Customer items must be receivable and supplier items must be payable", 400);
    }
    return await this.store.createOpenItem(context, command);
  }

  async allocateOpenItem(context: RequestContext, command: AllocateOpenItemCommand): Promise<OpenItemResult> {
    requireLegalEntity(context);
    requirePermission(context, "accounting.open_item.allocate");
    assertPositive(command.amount, "Allocation amount");
    if (command.reversalOfAllocationId) {
      requirePermission(context, "accounting.journal.reverse");
      if (!command.reason || command.reason.trim().length < 3) {
        throw new PlatformError("VALIDATION_FAILED", "An allocation reversal reason is required", 400);
      }
    }
    return await this.store.allocateOpenItem(context, command);
  }

  async closePeriod(context: RequestContext, command: ClosePeriodCommand): Promise<PeriodResult> {
    requireLegalEntity(context);
    requirePermission(context, "accounting.period.close");
    const approvalRequestId = requireApproval(command.approvalRequestId, "period close");
    if (command.evidence.trialBalanceBalanced !== true) throw new PlatformError("VALIDATION_FAILED", "Balanced trial-balance evidence is required", 400);
    return await this.store.closePeriod(context, { ...command, approvalRequestId });
  }

  async reopenPeriod(context: RequestContext, command: ReopenPeriodCommand): Promise<PeriodResult> {
    requireLegalEntity(context);
    requirePermission(context, "accounting.period.reopen");
    const approvalRequestId = requireApproval(command.approvalRequestId, "period reopen");
    if (command.reason.trim().length < 3) throw new PlatformError("VALIDATION_FAILED", "A reopen reason is required", 400);
    return await this.store.reopenPeriod(context, { ...command, approvalRequestId });
  }

  async trialBalance(context: RequestContext, query: { readonly chartId: string; readonly periodId: string }): Promise<TrialBalanceReport> {
    requirePermission(context, "accounting.reports.read");
    const result = await this.store.trialBalance(context, query);
    if (compareMoney(result.totalDebit, result.totalCredit) !== 0) throw new PlatformError("CONFLICT", "Trial balance control totals are not balanced", 409);
    return result;
  }

  async generalLedger(context: RequestContext, query: { readonly accountId: string; readonly fromDate: string; readonly toDate: string }): Promise<GeneralLedgerReport> {
    requirePermission(context, "accounting.reports.read");
    if (query.toDate < query.fromDate) throw new PlatformError("VALIDATION_FAILED", "General-ledger date range is invalid", 400);
    return await this.store.generalLedger(context, query);
  }

  async openItemAging(context: RequestContext, query: { readonly partyType: "customer" | "supplier"; readonly asOfDate: string }): Promise<OpenItemAgingReport> {
    requirePermission(context, "accounting.reports.read");
    return await this.store.openItemAging(context, query);
  }
}

export function zeroFor(value: Money): Money {
  return money(0n, value.currency, value.scale);
}
