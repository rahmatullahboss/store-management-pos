import type { Money } from "../../../packages/foundation/src/money.js";

export interface BankStatementLine {
  readonly bankAccountId: string;
  readonly bookedAt: string;
  readonly amount: Money;
  readonly reference: string;
  readonly externalId?: string;
}

export interface ReconciliationCandidate {
  readonly candidateId: string;
  readonly amount: Money;
  readonly reference: string;
}

function normalizeReference(value: string): string {
  return value.normalize("NFKC").trim().replaceAll(/\s+/gu, " ").toUpperCase();
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of new TextEncoder().encode(value)) {
    hash ^= BigInt(character);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function statementFingerprint(line: BankStatementLine): string {
  return fnv1a64([
    line.bankAccountId,
    line.bookedAt,
    line.amount.currency,
    line.amount.scale.toString(),
    line.amount.amountMinor.toString(),
    normalizeReference(line.reference),
    line.externalId ?? "",
  ].join("|"));
}

export function matchStatementLine(line: BankStatementLine, candidates: readonly ReconciliationCandidate[]): ReconciliationCandidate {
  const reference = normalizeReference(line.reference);
  const exact = candidates.filter((candidate) =>
    candidate.amount.currency === line.amount.currency
    && candidate.amount.scale === line.amount.scale
    && candidate.amount.amountMinor === line.amount.amountMinor
    && normalizeReference(candidate.reference) === reference,
  );
  if (exact.length === 0) throw new TypeError("No exact match exists for the bank statement line");
  if (exact.length > 1) throw new TypeError("Multiple exact matches require manual reconciliation");
  return Object.freeze({ ...exact[0] }) as ReconciliationCandidate;
}
