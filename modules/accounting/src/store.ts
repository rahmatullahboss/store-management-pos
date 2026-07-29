import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { NeonDatabase, TransactionClient } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { money } from "../../../packages/foundation/src/money.js";
import type {
  AccountingStore,
  AllocateOpenItemCommand,
  ClosePeriodCommand,
  CreateOpenItemCommand,
  GeneralLedgerReport,
  JournalPostResult,
  OpenItemAgingReport,
  OpenItemResult,
  PeriodResult,
  PreparedJournalCommand,
  ReopenPeriodCommand,
  StoredJournal,
  TrialBalanceReport,
} from "./service.js";

interface JournalResultRow extends Record<string, unknown> {
  readonly journal_id: string;
  readonly posting_group_id: string;
  readonly status: "posted";
  readonly transaction_currency: string;
  readonly transaction_scale: number | string;
  readonly total_debit_minor: string;
  readonly total_credit_minor: string;
  readonly business_date: string;
  readonly posted_at: string;
  readonly replayed: boolean;
}

interface JournalHeaderRow extends Record<string, unknown> {
  readonly journal_id: string;
  readonly posting_group_id: string;
  readonly chart_id: string;
  readonly fiscal_period_id: string;
  readonly journal_type: StoredJournal["journalType"];
  readonly posting_kind: StoredJournal["postingKind"];
  readonly source_type: string;
  readonly source_id: string;
  readonly source_version: string;
  readonly transaction_currency: string;
  readonly transaction_scale: number | string;
  readonly base_currency: string;
  readonly base_scale: number | string;
  readonly exchange_rate_numerator: string;
  readonly exchange_rate_denominator: string;
  readonly reversal_of_journal_id: string | null;
  readonly correction_reason: string | null;
  readonly business_date: string;
}

interface JournalLineRow extends Record<string, unknown> {
  readonly account_id: string;
  readonly account_code: string;
  readonly transaction_debit_minor: string;
  readonly transaction_credit_minor: string;
  readonly base_debit_minor: string;
  readonly base_credit_minor: string;
  readonly dimensions: Record<string, string> | string;
  readonly party_type: StoredJournal["lines"][number]["partyType"] | null;
  readonly party_id: string | null;
  readonly source_line_id: string | null;
  readonly memo: string | null;
}

interface OpenItemRow extends Record<string, unknown> {
  readonly open_item_id: string;
  readonly party_type: "customer" | "supplier";
  readonly party_id: string;
  readonly direction: "receivable" | "payable";
  readonly currency: string;
  readonly scale: number | string;
  readonly original_minor: string;
  readonly allocated_minor: string;
  readonly outstanding_minor: string;
  readonly status: OpenItemResult["status"];
  readonly replayed: boolean;
}

interface PeriodRow extends Record<string, unknown> {
  readonly period_id: string;
  readonly status: PeriodResult["status"];
  readonly version: string;
  readonly replayed: boolean;
}

interface TrialBalanceRow extends Record<string, unknown> {
  readonly account_id: string;
  readonly account_code: string;
  readonly currency: string;
  readonly scale: number | string;
  readonly debit_minor: string;
  readonly credit_minor: string;
  readonly balance_minor: string;
  readonly journal_count: string;
  readonly refreshed_at: string | null;
}

interface GeneralLedgerRow extends Record<string, unknown> {
  readonly journal_id: string;
  readonly source_type: string;
  readonly source_id: string;
  readonly account_code: string;
  readonly currency: string;
  readonly scale: number | string;
  readonly debit_minor: string;
  readonly credit_minor: string;
  readonly posted_at: string;
}

interface AgingRow extends Record<string, unknown> {
  readonly open_item_id: string;
  readonly party_type: "customer" | "supplier";
  readonly party_id: string;
  readonly currency: string;
  readonly scale: number | string;
  readonly outstanding_minor: string;
  readonly bucket: "current" | "1_30" | "31_60" | "61_90" | "over_90";
  readonly refreshed_at: string;
}

function databaseCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const value = (error as { readonly code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

function databaseMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Accounting database command failed";
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof PlatformError) throw error;
  const code = databaseCode(error);
  const message = databaseMessage(error);
  if (code === "P0002") throw new PlatformError("NOT_FOUND", message, 404);
  if (code === "55P03") throw new PlatformError("CONFLICT", message, 409);
  if (code === "P0001") {
    if (/idempotency|payload mismatch|replay payload/i.test(message)) throw new PlatformError("IDEMPOTENCY_CONFLICT", message, 409);
    throw new PlatformError("CONFLICT", message, 409);
  }
  if (code === "42501") throw new PlatformError("PERMISSION_DENIED", message, 403);
  if (code === "22023" || code === "23514" || code === "22P02") throw new PlatformError("VALIDATION_FAILED", message, 400);
  if (code === "23505") throw new PlatformError("CONFLICT", message, 409);
  throw error;
}

async function withAccountingError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    translateDatabaseError(error);
  }
}

function requiredRow<Row extends Record<string, unknown>>(rows: readonly Row[], command: string): Row {
  const row = rows[0];
  if (!row) throw new PlatformError("INTERNAL_ERROR", `${command} returned no result`, 500);
  return row;
}

function parseDimensions(value: Record<string, string> | string): Readonly<Record<string, string>> {
  if (typeof value !== "string") return Object.freeze({ ...value });
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return Object.freeze(parsed as Record<string, string>);
  } catch {
    // Database JSON decoding should normally avoid this branch.
  }
  return Object.freeze({});
}

function journalResult(row: JournalResultRow): JournalPostResult {
  const scale = Number(row.transaction_scale);
  return {
    journalId: row.journal_id,
    postingGroupId: row.posting_group_id,
    status: "posted",
    totalDebit: money(BigInt(row.total_debit_minor), row.transaction_currency.trim(), scale),
    totalCredit: money(BigInt(row.total_credit_minor), row.transaction_currency.trim(), scale),
    businessDate: row.business_date,
    postedAt: row.posted_at,
    replayed: row.replayed,
  };
}

function openItemResult(row: OpenItemRow): OpenItemResult {
  const scale = Number(row.scale);
  const currency = row.currency.trim();
  return {
    openItemId: row.open_item_id,
    partyType: row.party_type,
    partyId: row.party_id,
    direction: row.direction,
    original: money(BigInt(row.original_minor), currency, scale),
    allocated: money(BigInt(row.allocated_minor), currency, scale),
    outstanding: money(BigInt(row.outstanding_minor), currency, scale),
    status: row.status,
    replayed: row.replayed,
  };
}

function periodResult(row: PeriodRow): PeriodResult {
  return { periodId: row.period_id, status: row.status, version: BigInt(row.version), replayed: row.replayed };
}

function journalLinesPayload(command: PreparedJournalCommand): string {
  return JSON.stringify(command.lines.map((line) => ({
    accountId: line.accountId,
    accountCode: line.accountCode,
    debitMinor: line.debit.amountMinor.toString(),
    creditMinor: line.credit.amountMinor.toString(),
    baseDebitMinor: line.baseDebit.amountMinor.toString(),
    baseCreditMinor: line.baseCredit.amountMinor.toString(),
    ...(line.dimensions ? { dimensions: line.dimensions } : {}),
    ...(line.partyType ? { partyType: line.partyType } : {}),
    ...(line.partyId ? { partyId: line.partyId } : {}),
    ...(line.sourceLineId ? { sourceLineId: line.sourceLineId } : {}),
    ...(line.memo ? { memo: line.memo } : {}),
  })));
}

async function fetchJournal(client: TransactionClient, journalId: string): Promise<StoredJournal> {
  const headerResult = await client.query<JournalHeaderRow>(
    `SELECT je.id::text AS journal_id, je.posting_group_id::text, je.chart_id::text,
            je.fiscal_period_id::text, je.journal_type, je.posting_kind,
            je.source_type, je.source_id, je.source_version,
            je.transaction_currency, je.transaction_scale, je.base_currency,
            je.base_scale, je.exchange_rate_numerator::text,
            je.exchange_rate_denominator::text, je.reversal_of_journal_id::text,
            je.correction_reason, je.business_date::text
       FROM accounting.journal_entries je
      WHERE je.id = $1::uuid`,
    [journalId],
  );
  const header = headerResult.rows[0];
  if (!header) throw new PlatformError("NOT_FOUND", "Journal was not found", 404);
  const linesResult = await client.query<JournalLineRow>(
    `SELECT jl.account_id::text, a.code AS account_code,
            jl.transaction_debit_minor::text, jl.transaction_credit_minor::text,
            jl.base_debit_minor::text, jl.base_credit_minor::text,
            jl.dimensions, jl.party_type, jl.party_id, jl.source_line_id, jl.memo
       FROM accounting.journal_lines jl
       JOIN accounting.accounts a ON a.tenant_id = jl.tenant_id AND a.id = jl.account_id
      WHERE jl.journal_entry_id = $1::uuid
      ORDER BY jl.line_number`,
    [journalId],
  );
  const transactionScale = Number(header.transaction_scale);
  const baseScale = Number(header.base_scale);
  const transactionCurrency = header.transaction_currency.trim();
  const baseCurrency = header.base_currency.trim();
  const lines = linesResult.rows.map((line) => Object.freeze({
    accountId: line.account_id,
    accountCode: line.account_code,
    debit: money(BigInt(line.transaction_debit_minor), transactionCurrency, transactionScale),
    credit: money(BigInt(line.transaction_credit_minor), transactionCurrency, transactionScale),
    baseDebit: money(BigInt(line.base_debit_minor), baseCurrency, baseScale),
    baseCredit: money(BigInt(line.base_credit_minor), baseCurrency, baseScale),
    dimensions: parseDimensions(line.dimensions),
    ...(line.party_type ? { partyType: line.party_type } : {}),
    ...(line.party_id ? { partyId: line.party_id } : {}),
    ...(line.source_line_id ? { sourceLineId: line.source_line_id } : {}),
    ...(line.memo ? { memo: line.memo } : {}),
  }));
  const totalDebitMinor = lines.reduce((total, line) => total + line.debit.amountMinor, 0n);
  const totalCreditMinor = lines.reduce((total, line) => total + line.credit.amountMinor, 0n);
  return Object.freeze({
    journalId: header.journal_id,
    postingGroupId: header.posting_group_id,
    chartId: header.chart_id,
    fiscalPeriodId: header.fiscal_period_id,
    journalType: header.journal_type,
    postingKind: header.posting_kind,
    businessDate: header.business_date,
    currency: transactionCurrency,
    baseCurrency,
    exchangeRateNumerator: BigInt(header.exchange_rate_numerator),
    exchangeRateDenominator: BigInt(header.exchange_rate_denominator),
    source: Object.freeze({ type: header.source_type, id: header.source_id, version: header.source_version }),
    lines: Object.freeze(lines),
    status: "posted",
    totalDebit: money(totalDebitMinor, transactionCurrency, transactionScale),
    totalCredit: money(totalCreditMinor, transactionCurrency, transactionScale),
    ...(header.reversal_of_journal_id ? { reversalOfJournalId: header.reversal_of_journal_id } : {}),
    ...(header.correction_reason ? { correctionReason: header.correction_reason } : {}),
  });
}

export class NeonAccountingStore implements AccountingStore {
  constructor(private readonly database: NeonDatabase) {}

  async postJournal(context: RequestContext, command: PreparedJournalCommand): Promise<JournalPostResult> {
    return await withAccountingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const first = command.lines[0];
      if (!first) throw new PlatformError("VALIDATION_FAILED", "Journal lines are required", 400);
      const result = await client.query<JournalResultRow>(
        `SELECT journal_id::text, posting_group_id::text, status,
                transaction_currency, transaction_scale, total_debit_minor::text,
                total_credit_minor::text, business_date::text, posted_at::text, replayed
           FROM accounting.post_journal_v1(
             $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,
             $8::text,$9::text,$10::text,$11::char(3),$12::smallint,
             $13::char(3),$14::smallint,$15::bigint,$16::bigint,$17::jsonb,
             $18::uuid,$19::text,$20::uuid,$21::text,$22::text
           )`,
        [
          command.journalId,
          command.postingGroupId,
          command.chartId,
          command.fiscalPeriodId,
          command.postingRuleVersionId ?? null,
          command.journalType,
          command.postingKind,
          command.source.type,
          command.source.id,
          command.source.version,
          command.transactionCurrency,
          first.debit.scale,
          command.baseCurrency,
          first.baseDebit.scale,
          command.exchangeRateNumerator.toString(),
          command.exchangeRateDenominator.toString(),
          journalLinesPayload(command),
          command.approvalRequestId ?? null,
          command.reason ?? null,
          command.reversalOfJournalId ?? null,
          command.idempotencyKey,
          command.requestHash,
        ],
      );
      return journalResult(requiredRow(result.rows, "post journal"));
    }));
  }

  async getJournal(context: RequestContext, journalId: string): Promise<StoredJournal> {
    return await withAccountingError(async () => await this.database.withClientTransaction(context, async (client) => await fetchJournal(client, journalId)));
  }

  async createOpenItem(context: RequestContext, command: CreateOpenItemCommand): Promise<OpenItemResult> {
    return await withAccountingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<OpenItemRow>(
        `SELECT open_item_id::text, party_type, party_id, direction, currency,
                scale, original_minor::text, allocated_minor::text,
                outstanding_minor::text, status, replayed
           FROM accounting.create_open_item_v1(
             $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,
             $8::text,$9::char(3),$10::smallint,$11::bigint,$12::date,$13::uuid,
             $14::text,$15::text
           )`,
        [
          command.openItemId,
          command.controlAccountId,
          command.partyType,
          command.partyId,
          command.direction,
          command.documentType,
          command.documentId,
          command.documentVersion,
          command.amount.currency,
          command.amount.scale,
          command.amount.amountMinor.toString(),
          command.dueDate ?? null,
          command.journalId,
          command.idempotencyKey,
          command.requestHash,
        ],
      );
      return openItemResult(requiredRow(result.rows, "create open item"));
    }));
  }

  async allocateOpenItem(context: RequestContext, command: AllocateOpenItemCommand): Promise<OpenItemResult> {
    return await withAccountingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<OpenItemRow>(
        `SELECT open_item_id::text, party_type, party_id, direction, currency,
                scale, original_minor::text, allocated_minor::text,
                outstanding_minor::text, status, replayed
           FROM accounting.allocate_open_item_v1(
             $1::uuid,$2::uuid,$3::text,$4::text,$5::char(3),$6::smallint,
             $7::bigint,$8::uuid,$9::text,$10::uuid,$11::text,$12::text
           )`,
        [
          command.allocationId,
          command.openItemId,
          command.sourceType,
          command.sourceId,
          command.amount.currency,
          command.amount.scale,
          command.amount.amountMinor.toString(),
          command.journalId,
          command.reason ?? null,
          command.reversalOfAllocationId ?? null,
          command.idempotencyKey,
          command.requestHash,
        ],
      );
      return openItemResult(requiredRow(result.rows, "allocate open item"));
    }));
  }

  async closePeriod(context: RequestContext, command: ClosePeriodCommand & { readonly approvalRequestId: string }): Promise<PeriodResult> {
    return await withAccountingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<PeriodRow>(
        `SELECT period_id::text, status, version::text, replayed
           FROM accounting.close_period_v1($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb)`,
        [command.periodId, command.approvalRequestId, command.idempotencyKey, command.requestHash, JSON.stringify(command.evidence)],
      );
      return periodResult(requiredRow(result.rows, "close period"));
    }));
  }

  async reopenPeriod(context: RequestContext, command: ReopenPeriodCommand & { readonly approvalRequestId: string }): Promise<PeriodResult> {
    return await withAccountingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<PeriodRow>(
        `SELECT period_id::text, status, version::text, replayed
           FROM accounting.reopen_period_v1($1::uuid,$2::uuid,$3::text,$4::text,$5::text)`,
        [command.periodId, command.approvalRequestId, command.reason, command.idempotencyKey, command.requestHash],
      );
      return periodResult(requiredRow(result.rows, "reopen period"));
    }));
  }

  async trialBalance(context: RequestContext, query: { readonly chartId: string; readonly periodId: string }): Promise<TrialBalanceReport> {
    return await withAccountingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<TrialBalanceRow>(
        `SELECT tb.account_id::text, a.code AS account_code, tb.currency, tb.scale,
                tb.debit_minor::text, tb.credit_minor::text, tb.balance_minor::text,
                tb.journal_count::text, tb.refreshed_at::text
           FROM accounting.trial_balance_v tb
           JOIN accounting.accounts a ON a.tenant_id = tb.tenant_id AND a.id = tb.account_id
          WHERE tb.chart_id = $1::uuid AND tb.fiscal_period_id = $2::uuid
          ORDER BY a.code`,
        [query.chartId, query.periodId],
      );
      const first = result.rows[0];
      if (!first) throw new PlatformError("NOT_FOUND", "Trial balance has no posted journals", 404);
      const currency = first.currency.trim();
      const scale = Number(first.scale);
      const totalDebitMinor = result.rows.reduce((total, row) => total + BigInt(row.debit_minor), 0n);
      const totalCreditMinor = result.rows.reduce((total, row) => total + BigInt(row.credit_minor), 0n);
      return {
        currency,
        scale,
        totalDebit: money(totalDebitMinor, currency, scale),
        totalCredit: money(totalCreditMinor, currency, scale),
        refreshedAt: result.rows.reduce((latest, row) => row.refreshed_at && row.refreshed_at > latest ? row.refreshed_at : latest, ""),
        rows: Object.freeze(result.rows.map((row) => Object.freeze({
          accountId: row.account_id,
          accountCode: row.account_code,
          debit: money(BigInt(row.debit_minor), currency, scale),
          credit: money(BigInt(row.credit_minor), currency, scale),
          balance: money(BigInt(row.balance_minor), currency, scale),
          journalCount: BigInt(row.journal_count),
        }))),
      };
    }));
  }

  async generalLedger(context: RequestContext, query: { readonly accountId: string; readonly fromDate: string; readonly toDate: string }): Promise<GeneralLedgerReport> {
    return await withAccountingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<GeneralLedgerRow>(
        `SELECT gl.journal_entry_id::text AS journal_id, gl.source_type, gl.source_id,
                gl.account_code, gl.transaction_currency AS currency,
                gl.transaction_scale AS scale, gl.transaction_debit_minor::text AS debit_minor,
                gl.transaction_credit_minor::text AS credit_minor, gl.posted_at::text
           FROM accounting.general_ledger_v gl
          WHERE gl.account_id = $1::uuid AND gl.business_date BETWEEN $2::date AND $3::date
          ORDER BY gl.business_date, gl.posted_at, gl.journal_entry_id, gl.line_number`,
        [query.accountId, query.fromDate, query.toDate],
      );
      return {
        refreshedAt: result.rows.reduce((latest, row) => row.posted_at > latest ? row.posted_at : latest, ""),
        rows: Object.freeze(result.rows.map((row) => Object.freeze({
          journalId: row.journal_id,
          sourceType: row.source_type,
          sourceId: row.source_id,
          accountCode: row.account_code,
          debit: money(BigInt(row.debit_minor), row.currency.trim(), Number(row.scale)),
          credit: money(BigInt(row.credit_minor), row.currency.trim(), Number(row.scale)),
        }))),
      };
    }));
  }

  async openItemAging(context: RequestContext, query: { readonly partyType: "customer" | "supplier"; readonly asOfDate: string }): Promise<OpenItemAgingReport> {
    return await withAccountingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<AgingRow>(
        `SELECT balances.open_item_id::text, balances.party_type, balances.party_id,
                balances.currency, balances.scale, balances.outstanding_minor::text,
                CASE
                  WHEN balances.due_date IS NULL OR balances.due_date >= $2::date THEN 'current'
                  WHEN $2::date - balances.due_date BETWEEN 1 AND 30 THEN '1_30'
                  WHEN $2::date - balances.due_date BETWEEN 31 AND 60 THEN '31_60'
                  WHEN $2::date - balances.due_date BETWEEN 61 AND 90 THEN '61_90'
                  ELSE 'over_90'
                END AS bucket,
                COALESCE(balances.last_allocation_at, now())::text AS refreshed_at
           FROM accounting.open_item_balances_v balances
          WHERE balances.party_type = $1::text AND balances.outstanding_minor <> 0
            AND balances.business_date <= $2::date
          ORDER BY balances.due_date NULLS LAST, balances.open_item_id`,
        [query.partyType, query.asOfDate],
      );
      return {
        refreshedAt: result.rows.reduce((latest, row) => row.refreshed_at > latest ? row.refreshed_at : latest, ""),
        rows: Object.freeze(result.rows.map((row) => Object.freeze({
          openItemId: row.open_item_id,
          partyType: row.party_type,
          partyId: row.party_id,
          outstanding: money(BigInt(row.outstanding_minor), row.currency.trim(), Number(row.scale)),
          bucket: row.bucket,
        }))),
      };
    }));
  }
}
