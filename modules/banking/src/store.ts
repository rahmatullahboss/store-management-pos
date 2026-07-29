import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { NeonDatabase } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { money } from "../../../packages/foundation/src/money.js";
import { statementFingerprint } from "./domain.js";
import type {
  BankingStore,
  ImportStatementCommand,
  ImportStatementResult,
  ImportedStatementLine,
  ReconcileStatementLineCommand,
  ReconciliationMatchMethod,
  ReconciliationResult,
  ReconciliationRunResult,
  RecordReconciliationRunCommand,
  ReverseReconciliationCommand,
  UnreconciledStatementLine,
} from "./service.js";

interface ImportRow extends Record<string, unknown> {
  readonly statement_import_id: string;
  readonly bank_account_id: string;
  readonly status: "completed" | "duplicate";
  readonly line_count: number | string;
  readonly replayed: boolean;
}

interface StatementLineRow extends Record<string, unknown> {
  readonly statement_line_id: string;
  readonly bank_account_id: string;
  readonly statement_import_id: string;
  readonly line_number: number | string;
  readonly booked_at: string;
  readonly value_date: string | null;
  readonly currency: string;
  readonly scale: number | string;
  readonly amount_minor: string;
  readonly running_balance_minor: string | null;
  readonly reference: string;
  readonly external_id: string | null;
  readonly counterparty_name: string | null;
  readonly counterparty_reference: string | null;
  readonly raw_metadata: Record<string, unknown> | string;
  readonly fingerprint: string;
  readonly reconciliation_status: ImportedStatementLine["reconciliationStatus"];
}

interface ReconciliationRow extends Record<string, unknown> {
  readonly reconciliation_id: string;
  readonly statement_line_id: string;
  readonly candidate_type: ReconciliationResult["candidateType"];
  readonly candidate_id: string;
  readonly status: "matched" | "reversed";
  readonly currency: string;
  readonly scale: number | string;
  readonly matched_amount_minor: string;
  readonly statement_matched_minor: string;
  readonly statement_unmatched_minor: string;
  readonly statement_status: ReconciliationResult["statementStatus"];
  readonly reconciled_at: string;
  readonly reversal_of_reconciliation_id?: string | null;
  readonly replayed: boolean;
}

interface UnreconciledRow extends Record<string, unknown> {
  readonly statement_line_id: string;
  readonly bank_account_id: string;
  readonly booked_at: string;
  readonly reference: string;
  readonly currency: string;
  readonly scale: number | string;
  readonly amount_minor: string;
  readonly matched_minor: string;
  readonly unmatched_minor: string;
  readonly reconciliation_status: ImportedStatementLine["reconciliationStatus"];
  readonly reconciliation_ids: string[] | string | null;
}

interface RunRow extends Record<string, unknown> {
  readonly run_id: string;
  readonly status: ReconciliationRunResult["status"];
  readonly source_line_count: string;
  readonly matched_line_count: string;
  readonly exception_count: string;
  readonly statement_total_minor: string;
  readonly matched_total_minor: string;
  readonly difference_minor: string;
  readonly currency: string;
  readonly scale: number | string;
  readonly replayed: boolean;
}

function databaseCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const value = (error as { readonly code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

function databaseMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Banking database command failed";
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

async function withBankingError<T>(work: () => Promise<T>): Promise<T> {
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

function parseRecord(value: Record<string, unknown> | string): Readonly<Record<string, unknown>> {
  if (typeof value !== "string") return Object.freeze({ ...value });
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return Object.freeze(parsed as Record<string, unknown>);
  } catch {
    // Database JSON decoding should normally avoid this branch.
  }
  return Object.freeze({});
}

function parseTextArray(value: string[] | string | null): readonly string[] {
  if (Array.isArray(value)) return Object.freeze([...value]);
  if (!value || value === "{}") return Object.freeze([]);
  return Object.freeze(value.replace(/^\{|\}$/gu, "").split(",").filter(Boolean));
}

function statementLine(row: StatementLineRow): ImportedStatementLine {
  const currency = row.currency.trim();
  const scale = Number(row.scale);
  return Object.freeze({
    statementLineId: row.statement_line_id,
    bankAccountId: row.bank_account_id,
    statementImportId: row.statement_import_id,
    lineNumber: Number(row.line_number),
    bookedAt: row.booked_at,
    amount: money(BigInt(row.amount_minor), currency, scale),
    reference: row.reference,
    fingerprint: row.fingerprint,
    reconciliationStatus: row.reconciliation_status,
    rawMetadata: parseRecord(row.raw_metadata),
    ...(row.value_date ? { valueDate: row.value_date } : {}),
    ...(row.running_balance_minor !== null ? { runningBalance: money(BigInt(row.running_balance_minor), currency, scale) } : {}),
    ...(row.external_id ? { externalId: row.external_id } : {}),
    ...(row.counterparty_name ? { counterpartyName: row.counterparty_name } : {}),
    ...(row.counterparty_reference ? { counterpartyReference: row.counterparty_reference } : {}),
  });
}

function reconciliationResult(row: ReconciliationRow, matchMethod: ReconciliationMatchMethod): ReconciliationResult {
  const currency = row.currency.trim();
  const scale = Number(row.scale);
  return Object.freeze({
    reconciliationId: row.reconciliation_id,
    statementLineId: row.statement_line_id,
    candidateType: row.candidate_type,
    candidateId: row.candidate_id,
    status: row.status,
    matchedAmount: money(BigInt(row.matched_amount_minor), currency, scale),
    statementMatchedAmount: money(BigInt(row.statement_matched_minor), currency, scale),
    statementUnmatchedAmount: money(BigInt(row.statement_unmatched_minor), currency, scale),
    statementStatus: row.statement_status,
    matchMethod,
    reconciledAt: row.reconciled_at,
    ...(row.reversal_of_reconciliation_id ? { reversalOfReconciliationId: row.reversal_of_reconciliation_id } : {}),
    replayed: row.replayed,
  });
}

function runResult(row: RunRow): ReconciliationRunResult {
  const currency = row.currency.trim();
  const scale = Number(row.scale);
  return Object.freeze({
    runId: row.run_id,
    status: row.status,
    sourceLineCount: BigInt(row.source_line_count),
    matchedLineCount: BigInt(row.matched_line_count),
    exceptionCount: BigInt(row.exception_count),
    statementTotal: money(BigInt(row.statement_total_minor), currency, scale),
    matchedTotal: money(BigInt(row.matched_total_minor), currency, scale),
    difference: money(BigInt(row.difference_minor), currency, scale),
    replayed: row.replayed,
  });
}

function statementPayload(command: ImportStatementCommand): string {
  return JSON.stringify(command.lines.map((line) => ({
    statementLineId: line.statementLineId,
    lineNumber: line.lineNumber,
    bookedAt: line.bookedAt,
    currency: line.amount.currency,
    scale: line.amount.scale,
    amountMinor: line.amount.amountMinor.toString(),
    reference: line.reference,
    fingerprint: statementFingerprint({
      bankAccountId: command.bankAccountId,
      bookedAt: line.bookedAt,
      amount: line.amount,
      reference: line.reference,
      ...(line.externalId ? { externalId: line.externalId } : {}),
    }),
    ...(line.valueDate ? { valueDate: line.valueDate } : {}),
    ...(line.runningBalance ? { runningBalanceMinor: line.runningBalance.amountMinor.toString() } : {}),
    ...(line.externalId ? { externalId: line.externalId } : {}),
    ...(line.counterpartyName ? { counterpartyName: line.counterpartyName } : {}),
    ...(line.counterpartyReference ? { counterpartyReference: line.counterpartyReference } : {}),
    ...(line.rawMetadata ? { rawMetadata: line.rawMetadata } : {}),
  })));
}

export class NeonBankingStore implements BankingStore {
  constructor(private readonly database: NeonDatabase) {}

  async importStatement(context: RequestContext, command: ImportStatementCommand): Promise<ImportStatementResult> {
    return await withBankingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<ImportRow>(
        `SELECT statement_import_id::text, bank_account_id::text, status,
                line_count, replayed
           FROM banking.import_statement_v1(
             $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::jsonb,$7::text,$8::text
           )`,
        [
          command.statementImportId,
          command.bankAccountId,
          command.sourceType,
          command.sourceName,
          command.sourceHash,
          statementPayload(command),
          command.idempotencyKey,
          command.requestHash,
        ],
      );
      const imported = requiredRow(result.rows, "import statement");
      const lines = await client.query<StatementLineRow>(
        `SELECT sl.id::text AS statement_line_id, sl.bank_account_id::text,
                sl.statement_import_id::text, sl.line_number, sl.booked_at::text,
                sl.value_date::text, sl.currency, sl.scale, sl.amount_minor::text,
                sl.running_balance_minor::text, sl.reference, sl.external_id,
                sl.counterparty_name, sl.counterparty_reference, sl.raw_metadata,
                sl.fingerprint, sl.reconciliation_status
           FROM banking.statement_lines sl
          WHERE sl.statement_import_id = $1::uuid
          ORDER BY sl.line_number`,
        [imported.statement_import_id],
      );
      return Object.freeze({
        statementImportId: imported.statement_import_id,
        bankAccountId: imported.bank_account_id,
        status: imported.status,
        lineCount: Number(imported.line_count),
        lines: Object.freeze(lines.rows.map(statementLine)),
        replayed: imported.replayed,
      });
    }));
  }

  async reconcileStatementLine(context: RequestContext, command: ReconcileStatementLineCommand): Promise<ReconciliationResult> {
    return await withBankingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<ReconciliationRow>(
        `SELECT reconciliation_id::text, statement_line_id::text, candidate_type,
                candidate_id, status, currency, scale, matched_amount_minor::text,
                statement_matched_minor::text, statement_unmatched_minor::text,
                statement_status, reconciled_at::text, replayed
           FROM banking.reconcile_statement_line_v1(
             $1::uuid,$2::uuid,$3::text,$4::text,$5::char(3),$6::smallint,
             $7::bigint,$8::text,$9::integer,$10::uuid,$11::uuid,$12::text,
             $13::text,$14::text
           )`,
        [
          command.reconciliationId,
          command.statementLineId,
          command.candidateType,
          command.candidateId,
          command.amount.currency,
          command.amount.scale,
          command.amount.amountMinor.toString(),
          command.matchMethod,
          command.confidenceBasisPoints ?? null,
          command.ruleId ?? null,
          command.journalId ?? null,
          command.reason ?? null,
          command.idempotencyKey,
          command.requestHash,
        ],
      );
      return reconciliationResult(requiredRow(result.rows, "reconcile statement line"), command.matchMethod);
    }));
  }

  async reverseReconciliation(context: RequestContext, command: ReverseReconciliationCommand): Promise<ReconciliationResult> {
    return await withBankingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<ReconciliationRow>(
        `SELECT reconciliation_id::text, statement_line_id::text, candidate_type,
                candidate_id, status, currency, scale, matched_amount_minor::text,
                statement_matched_minor::text, statement_unmatched_minor::text,
                statement_status, reconciled_at::text,
                reversal_of_reconciliation_id::text, replayed
           FROM banking.reverse_reconciliation_v1(
             $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text
           )`,
        [
          command.reconciliationId,
          command.originalReconciliationId,
          command.journalId ?? null,
          command.reason,
          command.idempotencyKey,
          command.requestHash,
        ],
      );
      return reconciliationResult(requiredRow(result.rows, "reverse reconciliation"), "manual");
    }));
  }

  async recordReconciliationRun(context: RequestContext, command: RecordReconciliationRunCommand): Promise<ReconciliationRunResult> {
    return await withBankingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<RunRow>(
        `SELECT run_id::text, status, source_line_count::text,
                matched_line_count::text, exception_count::text,
                statement_total_minor::text, matched_total_minor::text,
                difference_minor::text, currency, scale, replayed
           FROM banking.record_reconciliation_run_v1(
             $1::uuid,$2::uuid,$3::date,$4::date,$5::text,$6::text
           )`,
        [command.runId, command.bankAccountId, command.periodStart, command.periodEnd, command.idempotencyKey, command.requestHash],
      );
      return runResult(requiredRow(result.rows, "record reconciliation run"));
    }));
  }

  async listUnreconciled(context: RequestContext, bankAccountId?: string): Promise<readonly UnreconciledStatementLine[]> {
    return await withBankingError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<UnreconciledRow>(
        `SELECT balances.statement_line_id::text, balances.bank_account_id::text,
                balances.booked_at::text, balances.reference, balances.currency,
                balances.scale, balances.amount_minor::text, balances.matched_minor::text,
                balances.unmatched_minor::text, balances.reconciliation_status,
                COALESCE(array_agg(r.id::text ORDER BY r.matched_at)
                  FILTER (WHERE r.id IS NOT NULL), '{}'::text[]) AS reconciliation_ids
           FROM banking.unreconciled_statement_lines_v balances
           LEFT JOIN banking.reconciliations r
             ON r.tenant_id = balances.tenant_id AND r.statement_line_id = balances.statement_line_id
          WHERE balances.unmatched_minor <> 0
            AND ($1::uuid IS NULL OR balances.bank_account_id = $1::uuid)
          GROUP BY balances.tenant_id, balances.statement_line_id, balances.bank_account_id,
                   balances.booked_at, balances.reference, balances.currency,
                   balances.scale, balances.amount_minor, balances.matched_minor,
                   balances.unmatched_minor, balances.reconciliation_status
          ORDER BY balances.booked_at, balances.statement_line_id`,
        [bankAccountId ?? null],
      );
      return Object.freeze(result.rows.map((row) => {
        const currency = row.currency.trim();
        const scale = Number(row.scale);
        return Object.freeze({
          statementLineId: row.statement_line_id,
          bankAccountId: row.bank_account_id,
          bookedAt: row.booked_at,
          reference: row.reference,
          originalAmount: money(BigInt(row.amount_minor), currency, scale),
          matchedAmount: money(BigInt(row.matched_minor), currency, scale),
          unmatchedAmount: money(BigInt(row.unmatched_minor), currency, scale),
          reconciliationStatus: row.reconciliation_status,
          reconciliationIds: parseTextArray(row.reconciliation_ids),
        });
      }));
    }));
  }
}
