export type ReportingAudience = "owner" | "store" | "finance" | "inventory" | "platform";
export type ReportingPageState = "ready" | "loading" | "empty" | "error" | "denied";

export interface ReportingMetricCard {
  readonly metricId: string;
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly currency?: string;
  readonly periodLabel: string;
  readonly version: string;
  readonly freshnessLabel: string;
  readonly health: "fresh" | "stale" | "rebuilding" | "degraded" | "failed";
  readonly reconciled: boolean;
  readonly controlTotal?: string;
  readonly drillThroughHref?: string;
}

export interface ReportingExceptionItem {
  readonly exceptionId: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly title: string;
  readonly owner: string;
  readonly ageLabel: string;
  readonly href?: string;
}

export interface ReportingExportItem {
  readonly exportId: string;
  readonly reportName: string;
  readonly format: "csv" | "xlsx" | "pdf" | "json";
  readonly status: "queued" | "running" | "review" | "completed" | "failed" | "cancelled" | "expired";
  readonly requestedAtLabel: string;
  readonly expiresAtLabel?: string;
}

export interface ReportingOperationsPage {
  readonly state: ReportingPageState;
  readonly audience: ReportingAudience;
  readonly tenantName: string;
  readonly scopeLabel: string;
  readonly businessDateLabel: string;
  readonly generatedAtLabel: string;
  readonly timeZone: string;
  readonly currency: string;
  readonly metrics: readonly ReportingMetricCard[];
  readonly exceptions: readonly ReportingExceptionItem[];
  readonly exports: readonly ReportingExportItem[];
  readonly canRequestExport: boolean;
  readonly message?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function badge(label: string, tone: string): string {
  return `<span class="modg-badge modg-badge--${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function statePanel(page: ReportingOperationsPage): string {
  if (page.state === "ready") return "";
  const copy = page.message ?? (page.state === "loading"
    ? "Loading tenant-scoped reporting projections…"
    : page.state === "empty"
      ? "No metric snapshots are available for this scope yet."
      : page.state === "denied"
        ? "Your role does not have permission to read this reporting scope."
        : "Reporting data could not be loaded. Source ledgers were not changed.");
  return `<section class="modg-state modg-state--${escapeHtml(page.state)}" role="${page.state === "error" ? "alert" : "status"}">
    <h2>${escapeHtml(page.state === "denied" ? "Access restricted" : page.state === "error" ? "Reporting unavailable" : page.state === "empty" ? "No projections yet" : "Preparing reporting")}</h2>
    <p>${escapeHtml(copy)}</p>
  </section>`;
}

const AUDIENCE_LABELS: Readonly<Record<ReportingAudience, string>> = Object.freeze({
  owner: "Owner",
  store: "Store manager",
  finance: "Finance",
  inventory: "Inventory",
  platform: "Platform",
});

function renderAudienceTabs(active: ReportingAudience): string {
  return `<nav class="modg-tabs" aria-label="Reporting audience">
    ${Object.entries(AUDIENCE_LABELS).map(([value, label]) => `<a href="/reporting?view=${escapeHtml(value)}"${value === active ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`).join("")}
  </nav>`;
}

function renderMetrics(metrics: readonly ReportingMetricCard[]): string {
  if (metrics.length === 0) return "";
  return `<section aria-labelledby="modg-metrics-title">
    <div class="modg-section-heading"><div><p class="modg-eyebrow">Control totals</p><h2 id="modg-metrics-title">Operational metrics</h2></div><p>Every value carries period, version, freshness and reconciliation evidence.</p></div>
    <div class="modg-metric-grid">
      ${metrics.map((metric) => `<article class="modg-metric" data-health="${escapeHtml(metric.health)}">
        <div class="modg-metric__top"><span>${escapeHtml(metric.label)}</span>${badge(metric.health, metric.health)}</div>
        <p class="modg-metric__value">${escapeHtml(metric.value)} <small>${escapeHtml(metric.currency ?? metric.unit)}</small></p>
        <dl>
          <div><dt>Period</dt><dd>${escapeHtml(metric.periodLabel)}</dd></div>
          <div><dt>Metric version</dt><dd>${escapeHtml(metric.version)}</dd></div>
          <div><dt>Freshness</dt><dd>${escapeHtml(metric.freshnessLabel)}</dd></div>
          <div><dt>Control total</dt><dd>${escapeHtml(metric.controlTotal ?? "Not configured")}</dd></div>
        </dl>
        <div class="modg-metric__footer">${badge(metric.reconciled ? "Reconciled" : "Review", metric.reconciled ? "success" : "attention")}${metric.drillThroughHref ? `<a href="${escapeHtml(metric.drillThroughHref)}">Drill through</a>` : ""}</div>
      </article>`).join("")}
    </div>
  </section>`;
}

function renderExceptions(items: readonly ReportingExceptionItem[]): string {
  return `<section class="modg-panel" aria-labelledby="modg-exceptions-title">
    <div class="modg-section-heading"><div><p class="modg-eyebrow">Exceptions</p><h2 id="modg-exceptions-title">Needs attention</h2></div><span class="modg-count">${items.length}</span></div>
    ${items.length === 0 ? '<p class="modg-empty">No active exceptions for this scope.</p>' : `<ul class="modg-list">${items.map((item) => `<li>
      <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.owner)} · ${escapeHtml(item.ageLabel)}</span></div>
      <div>${badge(item.severity, item.severity)}${item.href ? `<a href="${escapeHtml(item.href)}">Open</a>` : ""}</div>
    </li>`).join("")}</ul>`}
  </section>`;
}

function renderExports(items: readonly ReportingExportItem[], canRequest: boolean): string {
  return `<section class="modg-panel" aria-labelledby="modg-exports-title">
    <div class="modg-section-heading"><div><p class="modg-eyebrow">Asynchronous delivery</p><h2 id="modg-exports-title">Report exports</h2></div><button type="button"${canRequest ? "" : " disabled"}>Request export</button></div>
    ${items.length === 0 ? '<p class="modg-empty">No exports have been requested for this scope.</p>' : `<div class="modg-table-wrap" tabindex="0" role="region" aria-label="Report exports table"><table><thead><tr><th>Report</th><th>Format</th><th>Status</th><th>Requested</th><th>Retention</th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${escapeHtml(item.reportName)}</strong><small>${escapeHtml(item.exportId)}</small></td><td>${escapeHtml(item.format.toUpperCase())}</td><td>${badge(item.status, item.status)}</td><td>${escapeHtml(item.requestedAtLabel)}</td><td>${escapeHtml(item.expiresAtLabel ?? "Pending")}</td></tr>`).join("")}</tbody></table></div>`}
  </section>`;
}

export function renderReportingOperationsPage(page: ReportingOperationsPage): string {
  const state = statePanel(page);
  return `<style>${REPORTING_OPERATIONS_STYLES}</style><main class="modg-page" data-state="${escapeHtml(page.state)}">
    <header class="modg-hero">
      <div><p class="modg-eyebrow">Explainable operations</p><h1>${escapeHtml(AUDIENCE_LABELS[page.audience])} reporting</h1><p>${escapeHtml(page.tenantName)} · ${escapeHtml(page.scopeLabel)}</p></div>
      <dl class="modg-context"><div><dt>Business date</dt><dd>${escapeHtml(page.businessDateLabel)}</dd></div><div><dt>Generated</dt><dd>${escapeHtml(page.generatedAtLabel)}</dd></div><div><dt>Timezone</dt><dd>${escapeHtml(page.timeZone)}</dd></div><div><dt>Currency</dt><dd>${escapeHtml(page.currency)}</dd></div></dl>
    </header>
    ${renderAudienceTabs(page.audience)}
    ${state || `${renderMetrics(page.metrics)}<div class="modg-two-column">${renderExceptions(page.exceptions)}${renderExports(page.exports, page.canRequestExport)}</div>`}
  </main>`;
}

export const REPORTING_OPERATIONS_STYLES = `
.modg-page{display:grid;gap:1.25rem;color:#e8edf2}.modg-hero{display:flex;justify-content:space-between;gap:1.5rem;padding:1.5rem;border:1px solid #283643;background:linear-gradient(135deg,#16232c,#11191f);border-radius:1rem}.modg-hero h1,.modg-section-heading h2{margin:.15rem 0}.modg-hero p{margin:.35rem 0 0;color:#9eb0bd}.modg-eyebrow{margin:0!important;text-transform:uppercase;letter-spacing:.13em;font-size:.72rem;color:#75c7ba!important}.modg-context{display:grid;grid-template-columns:repeat(2,minmax(8rem,1fr));gap:.75rem;margin:0}.modg-context div{padding:.6rem .75rem;background:#0c1419;border-radius:.65rem}.modg-context dt,.modg-metric dt{font-size:.7rem;color:#80929f}.modg-context dd,.modg-metric dd{margin:.15rem 0 0}.modg-tabs{display:flex;gap:.4rem;overflow:auto;padding:.25rem}.modg-tabs a{white-space:nowrap;padding:.6rem .85rem;border-radius:999px;color:#aebdc8;text-decoration:none;border:1px solid transparent}.modg-tabs a[aria-current=page]{color:#fff;background:#1d4e58;border-color:#2c7d86}.modg-section-heading{display:flex;justify-content:space-between;align-items:end;gap:1rem}.modg-section-heading>p{max-width:38rem;color:#8fa2af;margin:0}.modg-metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.8rem;margin-top:.8rem}.modg-metric,.modg-panel{border:1px solid #283643;background:#111a20;border-radius:.85rem;padding:1rem}.modg-metric__top,.modg-metric__footer{display:flex;justify-content:space-between;align-items:center;gap:.5rem}.modg-metric__value{font-size:1.65rem;margin:.8rem 0}.modg-metric__value small{font-size:.72rem;color:#91a5b2}.modg-metric dl{display:grid;gap:.45rem;margin:.8rem 0}.modg-metric dl div{display:flex;justify-content:space-between;gap:.6rem}.modg-metric__footer a,.modg-list a{color:#7fd8cc}.modg-badge{display:inline-flex;align-items:center;padding:.2rem .48rem;border-radius:999px;font-size:.7rem;text-transform:capitalize;background:#24313a;color:#bdcbd4}.modg-badge--fresh,.modg-badge--success,.modg-badge--completed,.modg-badge--low{background:#153b35;color:#83dac9}.modg-badge--stale,.modg-badge--attention,.modg-badge--review,.modg-badge--medium,.modg-badge--queued{background:#41391e;color:#ead47c}.modg-badge--failed,.modg-badge--critical,.modg-badge--high{background:#48242a;color:#ff9fa8}.modg-badge--running,.modg-badge--rebuilding{background:#183a52;color:#8cccf2}.modg-two-column{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:1rem}.modg-count{font-variant-numeric:tabular-nums}.modg-list{list-style:none;padding:0;margin:.8rem 0 0;display:grid;gap:.55rem}.modg-list li{display:flex;justify-content:space-between;gap:1rem;padding:.7rem;border-top:1px solid #26343e}.modg-list li>div{display:flex;gap:.6rem;align-items:center}.modg-list span{display:block;color:#8396a3;font-size:.78rem}.modg-empty{color:#8396a3}.modg-panel button{border:0;border-radius:.55rem;background:#2a766e;color:white;padding:.58rem .75rem}.modg-panel button:disabled{opacity:.45}.modg-table-wrap{overflow:auto;margin-top:.8rem}.modg-table-wrap:focus-visible{outline:3px solid #3a93a0}.modg-table-wrap table{width:100%;border-collapse:collapse;min-width:38rem}.modg-table-wrap th,.modg-table-wrap td{text-align:start;padding:.65rem;border-bottom:1px solid #27343d}.modg-table-wrap th{color:#8295a2;font-size:.72rem}.modg-table-wrap td small{display:block;color:#728692}.modg-state{padding:2rem;border:1px dashed #3c4b55;border-radius:.8rem;text-align:center}.modg-state p{color:#95a6b1}.modg-state--error{border-color:#7c3942}.modg-state--denied{border-color:#705f2c}@media(max-width:1200px){.modg-metric-grid{grid-template-columns:repeat(2,1fr)}.modg-two-column{grid-template-columns:1fr}}@media(max-width:720px){.modg-hero{display:grid}.modg-context{grid-template-columns:1fr 1fr}.modg-metric-grid{grid-template-columns:1fr}.modg-section-heading{align-items:start}.modg-list li,.modg-list li>div{align-items:start;flex-direction:column}}[dir=rtl] .modg-page{text-align:right}`;
