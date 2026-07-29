import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { money, type Money } from "../../../packages/foundation/src/money.js";
import { statementFingerprint } from "./domain.js";

export type StatementSourceType = "csv" | "ofx" | "camt" | "api" | "manual";
export type ReconciliationCandidateType = "settlement" | "payment" | "refund" | "supplier_payment" | "cash_deposit" | "journal" | "opening_balance";
export type ReconciliationMatchMethod = "automatic" | "manual" | "imported";

export interface StatementLineInput {
  readonly statementLineId: string;
  readonly lineNumber: number;
  readonly bookedAt: string;
  readonly valueDate?: string;
  readonly amount: Money;
  readonly runningBalance?: Money;
  readonly reference: string;
  readonly externalId?: string;
  readonly counterpartyName?: string;
  readonly counterpartyReference?: string;
  readonly rawMetadata?: Readonly<Record<string, unknown>>;
}

export interface ImportedStatementLine extends StatementLineInput {
  readonly bankAccountId: string;
  readonly statementImportId: string;
  readonly fingerprint: string;
  readonly reconciliationStatus: "unmatched" | "suggested" | "matched" | "partially_matched" | "exception" | "reversed";
}

export interface ImportStatementCommand {
  readonly statementImportId: string;
  readonly bankAccountId: string;
  readonly sourceType: StatementSourceType;
  readonly sourceName: string;
  readonly sourceHash: string;
  readonly lines: readonly StatementLineInput[];
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface ImportStatementResult {
  readonly statementImportId: string;
  readonly bankAccountId: string;
  readonly status: "completed" | "duplicate";
  readonly lineCount: number;
  readonly lines: readonly ImportedStatementLine[];
  readonly replayed: boolean;
}

export interface ReconcileStatementLineCommand {
  readonly reconciliationId: string;
  readonly statementLineId: string;
  readonly candidateType: ReconciliationCandidateType;
  readonly candidateId: string;
  readonly amount: Money;
  readonly matchMethod: ReconciliationMatchMethod;
  readonly confidenceBasisPoints?: number;
  readonly ruleId?: string;
  readonly journalId?: string;
  readonly reason?: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface ReverseReconciliationCommand {
  readonly reconciliationId: string;
  readonly originalReconciliationId: string;
  readonly reason: string;
  readonly journalId?: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface ReconciliationResult {
  readonly reconciliationId: string;
  readonly statementLineId: string;
  readonly candidateType: ReconciliationCandidateType;
  readonly candidateId: string;
  readonly status: "matched" | "reversed";
  readonly matchedAmount: Money;
  readonly statementMatchedAmount: Money;
  readonly statementUnmatchedAmount: Money;
  readonly statementStatus: ImportedStatementLine["reconciliationStatus"];
  readonly matchMethod: ReconciliationMatchMethod;
  readonly reconciledAt: string;
  readonly reversalOfReconciliationId?: string;
  readonly replayed: boolean;
}

export interface UnreconciledStatementLine {
  readonly statementLineId: string;
  readonly bankAccountId: string;
  readonly bookedAt: string;
  readonly reference: string;
  readonly originalAmount: Money;
  readonly matchedAmount: Money;
  readonly unmatchedAmount: Money;
  readonly reconciliationStatus: ImportedStatementLine["reconciliationStatus"];
  readonly reconciliationIds: readonly string[];
}

export interface BankingStore {
  importStatement(context: RequestContext, command: ImportStatementCommand): Promise<ImportStatementResult>;
  reconcileStatementLine(context: RequestContext, command: ReconcileStatementLineCommand): Promise<ReconciliationResult>;
  reverseReconciliation(context: RequestContext, command: ReverseReconciliationCommand): Promise<ReconciliationResult>;
  listUnreconciled(context: RequestContext, bankAccountId?: string): Promise<readonly UnreconciledStatementLine[]>;
}

function requirePermission(context: RequestContext, permission: string): void {
  if (!context.permissions.has(permission)) throw new PlatformError("PERMISSION_DENIED", `Permission denied: ${permission}`, 403);
}

function requireLegalEntity(context: RequestContext): void {
  if (!context.legalEntityId) throw new PlatformError("VALIDATION_FAILED", "A legal entity context is required", 400);
}

function assertIdempotency(command: { readonly idempotencyKey: string; readonly requestHash: string }): void {
  if (command.idempotencyKey.trim().length < 8 || command.requestHash.trim().length === 0) {
    throw new PlatformError("VALIDATION_FAILED", "Idempotency key and request hash are required", 400);
  }
}

function assertMoneyIdentity(left: Money, right: Money, message: string): void {
  if (left.currency !== right.currency || left.scale !== right.scale) throw new PlatformError("VALIDATION_FAILED", message, 400);
}

function assertStatementLines(command: ImportStatementCommand): void {
  if (command.sourceName.trim().length === 0 || command.sourceHash.trim().length === 0) {
    throw new PlatformError("VALIDATION_FAILED", "Statement source name and source hash are required", 400);
  }
  if (command.lines.length === 0) throw new PlatformError("VALIDATION_FAILED", "A statement import requires at least one line", 400);
  const lineNumbers = new Set<number>();
  const lineIds = new Set<string>();
  const externalIds = new Set<string>();
  for (const line of command.lines) {
    if (!Number.isInteger(line.lineNumber) || line.lineNumber <= 0 || lineNumbers.has(line.lineNumber)) {
      throw new PlatformError("VALIDATION_FAILED", "Statement line numbers must be unique positive integers", 400);
    }
    if (lineIds.has(line.statementLineId)) throw new PlatformError("VALIDATION_FAILED", "Statement line identifiers must be unique", 400);
    if (line.amount.amountMinor === 0n) throw new PlatformError("VALIDATION_FAILED", "Statement line amount cannot be zero", 400);
    if (line.reference.trim().length === 0) throw new PlatformError("VALIDATION_FAILED", "Statement line reference is required", 400);
    if (line.runningBalance) assertMoneyIdentity(line.amount, line.runningBalance, "Running balance currency or scale does not match statement line");
    if (line.externalId) {
      if (externalIds.has(line.externalId)) throw new PlatformError("VALIDATION_FAILED", "Statement external identifiers must be unique within an import", 400);
      externalIds.add(line.externalId);
    }
    lineNumbers.add(line.lineNumber);
    lineIds.add(line.statementLineId);
  }
}

export class BankingService {
  constructor(private readonly store: BankingStore) {}

  async importStatement(context: RequestContext, command: ImportStatementCommand): Promise<ImportStatementResult> {
    requireLegalEntity(context);
    requirePermission(context, "banking.statement.import");
    assertIdempotency(command);
    assertStatementLines(command);
    return await this.store.importStatement(context, command);
  }

  async reconcileStatementLine(context: RequestContext, command: ReconcileStatementLineCommand): Promise<ReconciliationResult> {
    requireLegalEntity(context);
    requirePermission(context, command.matchMethod === "automatic" ? "banking.reconcile.auto" : "banking.reconcile.manual");
    assertIdempotency(command);
    if (command.candidateId.trim().length === 0) throw new PlatformError("VALIDATION_FAILED", "Reconciliation candidate is required", 400);
    if (command.amount.amountMinor === 0n) throw new PlatformError("VALIDATION_FAILED", "Matched amount cannot be zero", 400);
    if (command.matchMethod === "automatic") {
      if (!command.ruleId) throw new PlatformError("VALIDATION_FAILED", "Automatic reconciliation requires a rule", 400);
      if (!Number.isInteger(command.confidenceBasisPoints) || (command.confidenceBasisPoints ?? -1) < 0 || (command.confidenceBasisPoints ?? 10_001) > 10_000) {
        throw new PlatformError("VALIDATION_FAILED", "Automatic reconciliation confidence must be between 0 and 10000 basis points", 400);
      }
    }
    if (command.matchMethod === "manual" && (!command.reason || command.reason.trim().length < 3)) {
      throw new PlatformError("VALIDATION_FAILED", "Manual reconciliation reason is required", 400);
    }
    return await this.store.reconcileStatementLine(context, command);
  }

  async reverseReconciliation(context: RequestContext, command: ReverseReconciliationCommand): Promise<ReconciliationResult> {
    requireLegalEntity(context);
    requirePermission(context, "banking.reconcile.manual");
    assertIdempotency(command);
    if (command.reason.trim().length < 3) throw new PlatformError("VALIDATION_FAILED", "Reconciliation reversal reason is required", 400);
    return await this.store.reverseReconciliation(context, command);
  }

  async listUnreconciled(context: RequestContext, bankAccountId?: string): Promise<readonly UnreconciledStatementLine[]> {
    requireLegalEntity(context);
    requirePermission(context, "banking.read");
    return await this.store.listUnreconciled(context, bankAccountId);
  }
}

interface StoredReconciliation {
  readonly result: ReconciliationResult;
  readonly reason?: string;
}

function cloneLine(line: ImportedStatementLine): ImportedStatementLine {
  return Object.freeze({ ...line, amount: Object.freeze({ ...line.amount }), ...(line.runningBalance ? { runningBalance: Object.freeze({ ...line.runningBalance }) } : {}) });
}

function cloneResult(result: ReconciliationResult, replayed = result.replayed): ReconciliationResult {
  return Object.freeze({
    ...result,
    matchedAmount: Object.freeze({ ...result.matchedAmount }),
    statementMatchedAmount: Object.freeze({ ...result.statementMatchedAmount }),
    statementUnmatchedAmount: Object.freeze({ ...result.statementUnmatchedAmount }),
    replayed,
  });
}

export class InMemoryBankingStore implements BankingStore {
  readonly #importsByIdempotency = new Map<string, { readonly requestHash: string; readonly result: ImportStatementResult }>();
  readonly #sourceHashes = new Map<string, ImportStatementResult>();
  readonly #lines = new Map<string, ImportedStatementLine>();
  readonly #reconciliations = new Map<string, StoredReconciliation>();
  readonly #reconciliationByIdempotency = new Map<string, { readonly requestHash: string; readonly result: ReconciliationResult }>();
  readonly #reversalByOriginal = new Map<string, string>();

  async importStatement(_context: RequestContext, command: ImportStatementCommand): Promise<ImportStatementResult> {
    const replay = this.#importsByIdempotency.get(command.idempotencyKey);
    if (replay) {
      if (replay.requestHash !== command.requestHash) throw new PlatformError("CONFLICT", "Idempotency key payload mismatch", 409);
      return Object.freeze({ ...replay.result, lines: Object.freeze(replay.result.lines.map(cloneLine)), replayed: true });
    }
    const duplicate = this.#sourceHashes.get(`${command.bankAccountId}:${command.sourceHash}`);
    if (duplicate) {
      const result = Object.freeze({ ...duplicate, status: "duplicate" as const, replayed: true, lines: Object.freeze(duplicate.lines.map(cloneLine)) });
      this.#importsByIdempotency.set(command.idempotencyKey, { requestHash: command.requestHash, result });
      return result;
    }

    const importedLines = command.lines.map((line) => {
      const fingerprint = statementFingerprint({
        bankAccountId: command.bankAccountId,
        bookedAt: line.bookedAt,
        amount: line.amount,
        reference: line.reference,
        ...(line.externalId ? { externalId: line.externalId } : {}),
      });
      if ([...this.#lines.values()].some((existing) => existing.bankAccountId === command.bankAccountId && (existing.fingerprint === fingerprint || (line.externalId && existing.externalId === line.externalId)))) {
        throw new PlatformError("CONFLICT", "Statement line was already imported", 409);
      }
      return cloneLine({
        ...line,
        bankAccountId: command.bankAccountId,
        statementImportId: command.statementImportId,
        fingerprint,
        reconciliationStatus: "unmatched",
      });
    });
    for (const line of importedLines) this.#lines.set(line.statementLineId, line);
    const result: ImportStatementResult = Object.freeze({
      statementImportId: command.statementImportId,
      bankAccountId: command.bankAccountId,
      status: "completed",
      lineCount: importedLines.length,
      lines: Object.freeze(importedLines),
      replayed: false,
    });
    this.#sourceHashes.set(`${command.bankAccountId}:${command.sourceHash}`, result);
    this.#importsByIdempotency.set(command.idempotencyKey, { requestHash: command.requestHash, result });
    return result;
  }

  async reconcileStatementLine(_context: RequestContext, command: ReconcileStatementLineCommand): Promise<ReconciliationResult> {
    const replay = this.#reconciliationByIdempotency.get(command.idempotencyKey);
    if (replay) {
      if (replay.requestHash !== command.requestHash) throw new PlatformError("CONFLICT", "Idempotency key payload mismatch", 409);
      return cloneResult(replay.result, true);
    }
    if (this.#reconciliations.has(command.reconciliationId)) throw new PlatformError("CONFLICT", "Reconciliation identifier already exists", 409);
    const line = this.#lines.get(command.statementLineId);
    if (!line) throw new PlatformError("NOT_FOUND", "Statement line was not found", 404);
    assertMoneyIdentity(line.amount, command.amount, "Reconciliation currency or scale does not match statement line");
    if ((line.amount.amountMinor > 0n) !== (command.amount.amountMinor > 0n)) {
      throw new PlatformError("VALIDATION_FAILED", "Matched amount sign does not match statement line", 400);
    }
    const summary = this.#lineSummary(line);
    const remaining = summary.unmatchedAmount.amountMinor;
    if ((remaining > 0n && (command.amount.amountMinor <= 0n || command.amount.amountMinor > remaining))
      || (remaining < 0n && (command.amount.amountMinor >= 0n || command.amount.amountMinor < remaining))) {
      throw new PlatformError("VALIDATION_FAILED", "Matched amount exceeds the unmatched statement amount", 400);
    }
    const globallyExclusiveCandidate = command.candidateType === "settlement" || command.candidateType === "payment" || command.candidateType === "refund";
    if ([...this.#reconciliations.values()].some(({ result }) => result.status === "matched"
      && !this.#reversalByOriginal.has(result.reconciliationId)
      && result.candidateType === command.candidateType
      && result.candidateId === command.candidateId
      && (globallyExclusiveCandidate || result.statementLineId === command.statementLineId))) {
      throw new PlatformError("CONFLICT", "Candidate is already actively reconciled", 409);
    }

    const newMatched = summary.matchedAmount.amountMinor + command.amount.amountMinor;
    const newUnmatched = line.amount.amountMinor - newMatched;
    const status = newUnmatched === 0n ? "matched" : "partially_matched";
    const result = cloneResult({
      reconciliationId: command.reconciliationId,
      statementLineId: command.statementLineId,
      candidateType: command.candidateType,
      candidateId: command.candidateId,
      status: "matched",
      matchedAmount: command.amount,
      statementMatchedAmount: money(newMatched, line.amount.currency, line.amount.scale),
      statementUnmatchedAmount: money(newUnmatched, line.amount.currency, line.amount.scale),
      statementStatus: status,
      matchMethod: command.matchMethod,
      reconciledAt: new Date().toISOString(),
      replayed: false,
    });
    this.#reconciliations.set(command.reconciliationId, { result, ...(command.reason ? { reason: command.reason } : {}) });
    this.#reconciliationByIdempotency.set(command.idempotencyKey, { requestHash: command.requestHash, result });
    this.#lines.set(line.statementLineId, cloneLine({ ...line, reconciliationStatus: status }));
    return result;
  }

  async reverseReconciliation(_context: RequestContext, command: ReverseReconciliationCommand): Promise<ReconciliationResult> {
    const replay = this.#reconciliationByIdempotency.get(command.idempotencyKey);
    if (replay) {
      if (replay.requestHash !== command.requestHash) throw new PlatformError("CONFLICT", "Idempotency key payload mismatch", 409);
      return cloneResult(replay.result, true);
    }
    const original = this.#reconciliations.get(command.originalReconciliationId)?.result;
    if (!original || original.status !== "matched") throw new PlatformError("NOT_FOUND", "Original reconciliation was not found", 404);
    if (this.#reversalByOriginal.has(command.originalReconciliationId)) throw new PlatformError("CONFLICT", "Reconciliation was already reversed", 409);
    const line = this.#lines.get(original.statementLineId);
    if (!line) throw new PlatformError("NOT_FOUND", "Statement line was not found", 404);
    const summary = this.#lineSummary(line);
    const reversedAmount = money(-original.matchedAmount.amountMinor, original.matchedAmount.currency, original.matchedAmount.scale);
    const newMatched = summary.matchedAmount.amountMinor + reversedAmount.amountMinor;
    const newUnmatched = line.amount.amountMinor - newMatched;
    const status = newMatched === 0n ? "reversed" : newUnmatched === 0n ? "matched" : "partially_matched";
    const result = cloneResult({
      reconciliationId: command.reconciliationId,
      statementLineId: original.statementLineId,
      candidateType: original.candidateType,
      candidateId: original.candidateId,
      status: "reversed",
      matchedAmount: reversedAmount,
      statementMatchedAmount: money(newMatched, line.amount.currency, line.amount.scale),
      statementUnmatchedAmount: money(newUnmatched, line.amount.currency, line.amount.scale),
      statementStatus: status,
      matchMethod: "manual",
      reconciledAt: new Date().toISOString(),
      reversalOfReconciliationId: command.originalReconciliationId,
      replayed: false,
    });
    this.#reconciliations.set(command.reconciliationId, { result, reason: command.reason });
    this.#reversalByOriginal.set(command.originalReconciliationId, command.reconciliationId);
    this.#reconciliationByIdempotency.set(command.idempotencyKey, { requestHash: command.requestHash, result });
    this.#lines.set(line.statementLineId, cloneLine({ ...line, reconciliationStatus: status }));
    return result;
  }

  async listUnreconciled(_context: RequestContext, bankAccountId?: string): Promise<readonly UnreconciledStatementLine[]> {
    return Object.freeze([...this.#lines.values()]
      .filter((line) => !bankAccountId || line.bankAccountId === bankAccountId)
      .map((line) => this.#lineSummary(line))
      .filter((line) => line.unmatchedAmount.amountMinor !== 0n)
      .sort((left, right) => left.bookedAt.localeCompare(right.bookedAt)));
  }

  #lineSummary(line: ImportedStatementLine): UnreconciledStatementLine {
    const reconciliations = [...this.#reconciliations.values()].map(({ result }) => result).filter((result) => result.statementLineId === line.statementLineId);
    const matchedMinor = reconciliations.reduce((total, result) => total + result.matchedAmount.amountMinor, 0n);
    return Object.freeze({
      statementLineId: line.statementLineId,
      bankAccountId: line.bankAccountId,
      bookedAt: line.bookedAt,
      reference: line.reference,
      originalAmount: Object.freeze({ ...line.amount }),
      matchedAmount: money(matchedMinor, line.amount.currency, line.amount.scale),
      unmatchedAmount: money(line.amount.amountMinor - matchedMinor, line.amount.currency, line.amount.scale),
      reconciliationStatus: line.reconciliationStatus,
      reconciliationIds: Object.freeze(reconciliations.map((result) => result.reconciliationId)),
    });
  }
}
