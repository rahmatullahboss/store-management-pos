import { escapeHtml, formatFinanceMoney, freshnessLabel, statusChip, type FinanceMoney } from "../reporting/finance-ui.js";

export interface TrialBalanceRowView {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly debit: FinanceMoney;
  readonly credit: FinanceMoney;
  readonly balance: FinanceMoney;
  readonly journalCount: string;
}

export interface AccountingControlPage {
  readonly refreshedAt: string;
  readonly periodId: string;
  readonly periodCode: string;
  readonly periodStatus: "open" | "soft_closed" | "closed";
  readonly totalDebit: FinanceMoney;
  readonly totalCredit: FinanceMoney;
  readonly rows: readonly TrialBalanceRowView[];
  readonly openReceivableCount: number;
  readonly openPayableCount: number;
}

function periodTone(status: AccountingControlPage["periodStatus"]): "success" | "warning" | "neutral" {
  if (status === "closed") return "success";
  if (status === "soft_closed") return "warning";
  return "neutral";
}

export function renderAccountingControlPage(input: AccountingControlPage, locale = "en-US"): string {
  const balanced = input.totalDebit.amountMinor === input.totalCredit.amountMinor
    && input.totalDebit.currency === input.totalCredit.currency
    && input.totalDebit.scale === input.totalCredit.scale;
  const rows = input.rows.map((row) => `<tr>
    <td><strong>${escapeHtml(row.accountCode)}</strong><span class="cell-detail">${escapeHtml(row.accountName)}</span></td>
    <td>${formatFinanceMoney(row.debit, locale)}</td>
    <td>${formatFinanceMoney(row.credit, locale)}</td>
    <td>${formatFinanceMoney(row.balance, locale)}</td>
    <td>${escapeHtml(row.journalCount)}</td>
    <td><a class="row-action" href="/finance/accounting/ledger?accountId=${encodeURIComponent(row.accountId)}">Drill through</a></td>
  </tr>`).join("");
  return `<section aria-labelledby="accounting-control-title">
    <header class="page-heading"><div><h1 id="accounting-control-title">Accounting control</h1><p>Trial balance, open items and period governance with source-level drill-through.</p></div><div class="page-actions"><a class="button button--secondary" href="/finance/accounting/open-items">Open items</a><a class="button button--primary" href="/finance/accounting/periods/${encodeURIComponent(input.periodId)}">Manage period</a></div></header>
    <div class="signal-band" role="status"><div class="signal-band__primary"><span class="signal-band__label">${escapeHtml(input.periodCode)}</span><strong>${balanced ? "Trial balance is balanced" : "Trial balance exception requires review"}</strong><span>${freshnessLabel(input.refreshedAt)} · ${statusChip(input.periodStatus.replaceAll("_", " "), periodTone(input.periodStatus))}</span></div><dl class="signal-band__facts"><div><dt>Total debit</dt><dd>${formatFinanceMoney(input.totalDebit, locale)}</dd></div><div><dt>Total credit</dt><dd>${formatFinanceMoney(input.totalCredit, locale)}</dd></div><div><dt>Open items</dt><dd>${input.openReceivableCount + input.openPayableCount}</dd></div></dl></div>
    <section class="work-queue" aria-labelledby="trial-balance-title"><div class="section-heading"><div><h2 id="trial-balance-title">Trial balance</h2><p>${input.openReceivableCount} receivable and ${input.openPayableCount} payable items remain open.</p></div></div><div class="table-wrap"><table><thead><tr><th>Account</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Journals</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No posted journals for this period.</td></tr>'}</tbody></table></div></section>
  </section>`;
}
