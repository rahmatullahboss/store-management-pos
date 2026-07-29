import { escapeHtml, formatFinanceMoney, freshnessLabel, statusChip, type FinanceMoney } from "../reporting/finance-ui.js";

export interface BankReconciliationRow {
  readonly statementLineId: string;
  readonly bookedAt: string;
  readonly reference: string;
  readonly originalAmount: FinanceMoney;
  readonly matchedAmount: FinanceMoney;
  readonly unmatchedAmount: FinanceMoney;
  readonly status: "unmatched" | "suggested" | "partially_matched" | "exception" | "reversed";
}

export interface BankReconciliationPage {
  readonly bankAccountId: string;
  readonly bankAccountName: string;
  readonly refreshedAt: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly statementTotal: FinanceMoney;
  readonly matchedTotal: FinanceMoney;
  readonly difference: FinanceMoney;
  readonly rows: readonly BankReconciliationRow[];
}

function reconciliationTone(status: BankReconciliationRow["status"]): "warning" | "danger" | "neutral" {
  if (status === "exception") return "danger";
  if (status === "partially_matched" || status === "suggested") return "warning";
  return "neutral";
}

export function renderBankReconciliationPage(input: BankReconciliationPage, locale = "en-US"): string {
  const cleared = input.difference.amountMinor === "0";
  const rows = input.rows.map((row) => `<tr>
    <td><strong>${escapeHtml(row.reference)}</strong><span class="cell-detail">${escapeHtml(row.statementLineId)}</span></td>
    <td><time datetime="${escapeHtml(row.bookedAt)}">${escapeHtml(row.bookedAt)}</time></td>
    <td>${formatFinanceMoney(row.originalAmount, locale)}</td>
    <td>${formatFinanceMoney(row.matchedAmount, locale)}</td>
    <td>${formatFinanceMoney(row.unmatchedAmount, locale)}</td>
    <td>${statusChip(row.status.replaceAll("_", " "), reconciliationTone(row.status))}</td>
    <td><a class="row-action" href="/finance/banking/reconcile?statementLineId=${encodeURIComponent(row.statementLineId)}">Review</a></td>
  </tr>`).join("");
  return `<section aria-labelledby="bank-reconciliation-title">
    <header class="page-heading"><div><h1 id="bank-reconciliation-title">Bank reconciliation</h1><p>${escapeHtml(input.bankAccountName)} · ${escapeHtml(input.periodStart)} to ${escapeHtml(input.periodEnd)}</p></div><div class="page-actions"><a class="button button--secondary" href="/finance/banking/import">Import statement</a><a class="button button--primary" href="/finance/banking/runs/new?bankAccountId=${encodeURIComponent(input.bankAccountId)}">Run controls</a></div></header>
    <div class="signal-band" role="status"><div class="signal-band__primary"><span class="signal-band__label">Reconciliation control</span><strong>${cleared ? "Statement and matched totals agree" : "Unreconciled difference requires review"}</strong><span>${freshnessLabel(input.refreshedAt)}</span></div><dl class="signal-band__facts"><div><dt>Statement</dt><dd>${formatFinanceMoney(input.statementTotal, locale)}</dd></div><div><dt>Matched</dt><dd>${formatFinanceMoney(input.matchedTotal, locale)}</dd></div><div><dt>Difference</dt><dd>${formatFinanceMoney(input.difference, locale)}</dd></div></dl></div>
    <section class="work-queue" aria-labelledby="unreconciled-title"><div class="section-heading"><div><h2 id="unreconciled-title">Unreconciled statement lines</h2><p>Partial matches and reversals remain visible as append-only evidence.</p></div></div><div class="table-wrap"><table><thead><tr><th>Reference</th><th>Booked</th><th>Statement</th><th>Matched</th><th>Difference</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No unreconciled statement lines.</td></tr>'}</tbody></table></div></section>
  </section>`;
}
