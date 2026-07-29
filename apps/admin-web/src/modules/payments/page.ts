import { escapeHtml, formatFinanceMoney, freshnessLabel, statusChip, type FinanceMoney } from "../reporting/finance-ui.js";

export interface PaymentOperationsRow {
  readonly paymentId: string;
  readonly customerReference: string;
  readonly provider: string;
  readonly amount: FinanceMoney;
  readonly status: "captured" | "authorized" | "unknown" | "failed" | "refunded" | "partially_refunded";
  readonly updatedAt: string;
}

export interface PaymentOperationsPage {
  readonly refreshedAt: string;
  readonly capturedTotal: FinanceMoney;
  readonly refundTotal: FinanceMoney;
  readonly unknownCount: number;
  readonly rows: readonly PaymentOperationsRow[];
}

function paymentTone(status: PaymentOperationsRow["status"]): "success" | "warning" | "danger" | "neutral" {
  if (status === "captured" || status === "refunded") return "success";
  if (status === "unknown" || status === "partially_refunded") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

export function renderPaymentOperationsPage(input: PaymentOperationsPage, locale = "en-US"): string {
  const rows = input.rows.map((row) => `<tr>
    <td><strong>${escapeHtml(row.customerReference)}</strong><span class="cell-detail">${escapeHtml(row.paymentId)}</span></td>
    <td>${escapeHtml(row.provider)}</td>
    <td>${formatFinanceMoney(row.amount, locale)}</td>
    <td>${statusChip(row.status.replaceAll("_", " "), paymentTone(row.status))}</td>
    <td><time datetime="${escapeHtml(row.updatedAt)}">${escapeHtml(row.updatedAt)}</time></td>
    <td><a class="row-action" href="/finance/payments/${encodeURIComponent(row.paymentId)}">Trace</a></td>
  </tr>`).join("");
  return `<section aria-labelledby="payment-operations-title">
    <header class="page-heading"><div><h1 id="payment-operations-title">Payment operations</h1><p>Provider state, recovery exceptions, refunds and settlement provenance in one queue.</p></div><div class="page-actions"><a class="button button--secondary" href="/finance/banking">Open reconciliation</a></div></header>
    <div class="signal-band" role="status"><div class="signal-band__primary"><span class="signal-band__label">Control state</span><strong>${input.unknownCount === 0 ? "No unresolved provider state" : `${input.unknownCount} payment${input.unknownCount === 1 ? " requires" : "s require"} recovery`}</strong><span>${freshnessLabel(input.refreshedAt)}</span></div><dl class="signal-band__facts"><div><dt>Captured</dt><dd>${formatFinanceMoney(input.capturedTotal, locale)}</dd></div><div><dt>Refunded</dt><dd>${formatFinanceMoney(input.refundTotal, locale)}</dd></div><div><dt>Unknown</dt><dd>${input.unknownCount}</dd></div></dl></div>
    <section class="work-queue" aria-labelledby="payment-queue-title"><div class="section-heading"><div><h2 id="payment-queue-title">Recent payment effects</h2><p>Every row keeps provider and internal state traceable.</p></div></div><div class="table-wrap"><table><thead><tr><th>Reference</th><th>Provider</th><th>Amount</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No payment effects in this period.</td></tr>'}</tbody></table></div></section>
  </section>`;
}
