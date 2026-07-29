import { addMoney, money, type Money } from "../../../packages/foundation/src/money.js";

export interface JournalSource {
  readonly type: string;
  readonly id: string;
  readonly version: string;
}

export interface JournalLineInput {
  readonly accountCode: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly baseDebit?: Money;
  readonly baseCredit?: Money;
  readonly dimensions?: Readonly<Record<string, string>>;
  readonly sourceLineId?: string;
}

export interface JournalLine extends JournalLineInput {}

export interface JournalInput {
  readonly journalId: string;
  readonly postingGroupId: string;
  readonly businessDate: string;
  readonly currency: string;
  readonly source: JournalSource;
  readonly lines: readonly JournalLineInput[];
  readonly reversalOfJournalId?: string;
  readonly correctionReason?: string;
}

export interface PostedJournal extends JournalInput {
  readonly status: "posted";
  readonly lines: readonly JournalLine[];
  readonly totalDebit: Money;
  readonly totalCredit: Money;
}

function assertLine(line: JournalLineInput, currency: string, scale: number): void {
  if (line.accountCode.trim().length === 0) throw new TypeError("Journal account code is required");
  if (line.debit.currency !== currency || line.credit.currency !== currency || line.debit.scale !== scale || line.credit.scale !== scale) {
    throw new TypeError("Journal line uses a different currency or scale");
  }
  if (line.debit.amountMinor < 0n || line.credit.amountMinor < 0n) throw new RangeError("Journal debit and credit cannot be negative");
  const debitPositive = line.debit.amountMinor > 0n;
  const creditPositive = line.credit.amountMinor > 0n;
  if (debitPositive === creditPositive) throw new TypeError("Journal line must be one-sided with exactly one positive debit or credit");
  if ((line.baseDebit === undefined) !== (line.baseCredit === undefined)) throw new TypeError("Base debit and credit must be supplied together");
  if (line.baseDebit && line.baseCredit) {
    if (line.baseDebit.amountMinor < 0n || line.baseCredit.amountMinor < 0n) throw new RangeError("Base debit and credit cannot be negative");
    const baseDebitPositive = line.baseDebit.amountMinor > 0n;
    const baseCreditPositive = line.baseCredit.amountMinor > 0n;
    if (baseDebitPositive === baseCreditPositive) throw new TypeError("Base journal line must be one-sided");
  }
}

function freezeLine(line: JournalLineInput): JournalLine {
  return Object.freeze({
    ...line,
    ...(line.dimensions ? { dimensions: Object.freeze({ ...line.dimensions }) } : {}),
  });
}

export function buildJournal(input: JournalInput): PostedJournal {
  if (input.lines.length < 2) throw new TypeError("A journal requires at least two lines");
  const first = input.lines[0];
  if (!first) throw new TypeError("A journal requires lines");
  const scale = first.debit.scale;
  const frozenLines = input.lines.map((line) => {
    assertLine(line, input.currency, scale);
    return freezeLine(line);
  });
  const zero = money(0n, input.currency, scale);
  const totalDebit = frozenLines.reduce((total, line) => addMoney(total, line.debit), zero);
  const totalCredit = frozenLines.reduce((total, line) => addMoney(total, line.credit), zero);
  if (totalDebit.amountMinor !== totalCredit.amountMinor) throw new RangeError("Journal is not balanced");
  if (totalDebit.amountMinor === 0n) throw new RangeError("Journal total must be positive");

  const baseLines = frozenLines.filter((line) => line.baseDebit && line.baseCredit);
  if (baseLines.length > 0) {
    if (baseLines.length !== frozenLines.length) throw new TypeError("Every journal line must include base amounts when one line does");
    const baseFirst = baseLines[0];
    if (!baseFirst?.baseDebit || !baseFirst.baseCredit) throw new TypeError("Base amounts are required");
    const baseZero = money(0n, baseFirst.baseDebit.currency, baseFirst.baseDebit.scale);
    const baseDebit = baseLines.reduce((total, line) => addMoney(total, line.baseDebit as Money), baseZero);
    const baseCredit = baseLines.reduce((total, line) => addMoney(total, line.baseCredit as Money), baseZero);
    if (baseDebit.amountMinor !== baseCredit.amountMinor) throw new RangeError("Journal is not balanced in base currency");
  }

  return Object.freeze({
    ...input,
    source: Object.freeze({ ...input.source }),
    lines: Object.freeze(frozenLines),
    status: "posted",
    totalDebit,
    totalCredit,
  });
}

export function reverseJournal(
  original: PostedJournal,
  input: { readonly journalId: string; readonly businessDate: string; readonly reason: string },
): PostedJournal {
  if (input.journalId === original.journalId) throw new TypeError("Reversal journal must have a new identifier");
  if (input.reason.trim().length === 0) throw new TypeError("Reversal reason is required");
  return buildJournal({
    journalId: input.journalId,
    postingGroupId: original.postingGroupId,
    businessDate: input.businessDate,
    currency: original.currency,
    source: { type: "journal_reversal", id: original.journalId, version: original.source.version },
    reversalOfJournalId: original.journalId,
    correctionReason: input.reason,
    lines: original.lines.map((line) => ({
      accountCode: line.accountCode,
      debit: line.credit,
      credit: line.debit,
      ...(line.baseDebit && line.baseCredit ? { baseDebit: line.baseCredit, baseCredit: line.baseDebit } : {}),
      ...(line.dimensions ? { dimensions: line.dimensions } : {}),
      ...(line.sourceLineId ? { sourceLineId: line.sourceLineId } : {}),
    })),
  });
}

export interface FiscalPeriod {
  readonly status: "open" | "soft_closed" | "closed";
  readonly startDate: string;
  readonly endDate: string;
}

export interface PostingPeriodRequest {
  readonly businessDate: string;
  readonly kind: "ordinary" | "adjustment" | "reversal";
  readonly approvalId?: string;
}

export function assertPeriodAllowsPosting(period: FiscalPeriod, request: PostingPeriodRequest): void {
  if (request.businessDate < period.startDate || request.businessDate > period.endDate) throw new RangeError("Posting date is outside the fiscal period");
  if (period.status === "open") return;
  if (period.status === "soft_closed" && request.kind === "ordinary") throw new TypeError("Fiscal period is soft-closed for ordinary posting");
  if (period.status === "closed" && request.kind === "ordinary") throw new TypeError("Fiscal period is closed");
  if (!request.approvalId) throw new TypeError("Approval evidence is required for a closed-period adjustment or reversal");
}

export interface TrialBalanceRow {
  readonly accountCode: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly balance: Money;
  readonly journalIds: readonly string[];
}

export interface TrialBalance {
  readonly currency: string;
  readonly totalDebit: Money;
  readonly totalCredit: Money;
  readonly accounts: readonly TrialBalanceRow[];
}

export function trialBalance(journals: readonly PostedJournal[]): TrialBalance {
  const first = journals[0];
  if (!first) throw new TypeError("Trial balance requires at least one journal");
  const scale = first.totalDebit.scale;
  const zero = money(0n, first.currency, scale);
  const accounts = new Map<string, { debit: Money; credit: Money; journalIds: string[] }>();
  let totalDebit = zero;
  let totalCredit = zero;
  for (const journal of journals) {
    if (journal.currency !== first.currency || journal.totalDebit.scale !== scale) throw new TypeError("Trial balance cannot combine currencies or scales");
    totalDebit = addMoney(totalDebit, journal.totalDebit);
    totalCredit = addMoney(totalCredit, journal.totalCredit);
    for (const line of journal.lines) {
      const existing = accounts.get(line.accountCode) ?? { debit: zero, credit: zero, journalIds: [] };
      accounts.set(line.accountCode, {
        debit: addMoney(existing.debit, line.debit),
        credit: addMoney(existing.credit, line.credit),
        journalIds: existing.journalIds.includes(journal.journalId) ? existing.journalIds : [...existing.journalIds, journal.journalId],
      });
    }
  }
  if (totalDebit.amountMinor !== totalCredit.amountMinor) throw new RangeError("Trial balance control totals are not balanced");
  const rows = [...accounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([accountCode, value]) => Object.freeze({
    accountCode,
    debit: value.debit,
    credit: value.credit,
    balance: money(value.debit.amountMinor - value.credit.amountMinor, first.currency, scale),
    journalIds: Object.freeze([...value.journalIds]),
  }));
  return Object.freeze({ currency: first.currency, totalDebit, totalCredit, accounts: Object.freeze(rows) });
}
