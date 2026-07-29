import { escapeHtml, freshnessLabel, statusChip } from "./finance-ui.js";

export interface FinanceReadinessCheckView {
  readonly code: string;
  readonly label: string;
  readonly status: "pass" | "warning" | "fail";
  readonly observed: string;
  readonly expected: string;
  readonly detail: string;
}

export interface FinanceReadinessPage {
  readonly overall: "ready" | "degraded" | "blocked";
  readonly generatedAt: string;
  readonly checks: readonly FinanceReadinessCheckView[];
}

function checkTone(status: FinanceReadinessCheckView["status"]): "success" | "warning" | "danger" {
  if (status === "pass") return "success";
  if (status === "warning") return "warning";
  return "danger";
}

function overallTone(overall: FinanceReadinessPage["overall"]): "success" | "warning" | "danger" {
  if (overall === "ready") return "success";
  if (overall === "degraded") return "warning";
  return "danger";
}

export function renderFinanceReadinessPage(input: FinanceReadinessPage): string {
  const failed = input.checks.filter((item) => item.status === "fail").length;
  const warnings = input.checks.filter((item) => item.status === "warning").length;
  const rows = input.checks.map((item) => `<tr>
    <td><strong>${escapeHtml(item.label)}</strong><span class="cell-detail">${escapeHtml(item.code)}</span></td>
    <td>${statusChip(item.status, checkTone(item.status))}</td>
    <td>${escapeHtml(item.observed)}</td>
    <td>${escapeHtml(item.expected)}</td>
    <td>${escapeHtml(item.detail)}</td>
  </tr>`).join("");
  return `<section aria-labelledby="finance-readiness-title">
    <header class="page-heading"><div><h1 id="finance-readiness-title">Finance readiness</h1><p>Deployment and operating controls for payments, accounting and banking.</p></div><div class="page-actions"><a class="button button--secondary" href="/audit">Open audit history</a></div></header>
    <div class="signal-band" role="status"><div class="signal-band__primary"><span class="signal-band__label">Release control</span><strong>${statusChip(input.overall, overallTone(input.overall))}</strong><span>${freshnessLabel(input.generatedAt)}</span></div><dl class="signal-band__facts"><div><dt>Failed</dt><dd>${failed}</dd></div><div><dt>Warnings</dt><dd>${warnings}</dd></div><div><dt>Checks</dt><dd>${input.checks.length}</dd></div></dl></div>
    <section class="work-queue" aria-labelledby="finance-readiness-checks"><div class="section-heading"><div><h2 id="finance-readiness-checks">Readiness checks</h2><p>A blocked state prevents release; degraded state requires documented acceptance.</p></div></div><div class="table-wrap"><table><thead><tr><th>Control</th><th>Status</th><th>Observed</th><th>Expected</th><th>Response</th></tr></thead><tbody>${rows}</tbody></table></div></section>
  </section>`;
}
