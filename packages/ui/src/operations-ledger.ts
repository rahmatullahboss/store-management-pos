export type LedgerTone = "success" | "warning" | "danger" | "neutral";
export type LedgerSurfaceState = "ready" | "loading" | "empty" | "error" | "denied" | "offline" | "conflict";

export interface LedgerSignalFact {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
}

export interface LedgerEvidenceItem {
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
  readonly href?: string;
}

export interface LedgerStateOptions {
  readonly state: Exclude<LedgerSurfaceState, "ready">;
  readonly title: string;
  readonly detail: string;
  readonly actionLabel?: string;
  readonly actionDisabled?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderLedgerStatus(label: string, tone: LedgerTone = "neutral"): string {
  return `<span class="status-chip status-chip--${tone}"><span class="status-chip__dot" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

export function renderLedgerSignalBand(title: string, detail: string, facts: readonly LedgerSignalFact[]): string {
  return `<section class="signal-band" aria-label="Operational signal"><div class="signal-band__primary"><span class="signal-band__label">Operational signal</span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div><dl class="signal-band__facts">${facts.slice(0, 3).map((fact) => `<div><dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd>${fact.detail ? `<span>${escapeHtml(fact.detail)}</span>` : ""}</div>`).join("")}</dl></section>`;
}

export function renderLedgerEvidenceRail(title: string, items: readonly LedgerEvidenceItem[]): string {
  return `<aside class="trace-panel ledger-evidence" aria-labelledby="ledger-evidence-title"><div class="section-heading section-heading--compact"><div><h2 id="ledger-evidence-title">${escapeHtml(title)}</h2><p>Source, state and immutable references remain visible.</p></div></div><ol class="provenance-chain">${items.map((item, index) => `<li><span class="provenance-chain__step">Evidence ${index + 1}</span><strong>${escapeHtml(item.label)}</strong>${item.href ? `<a href="${escapeHtml(item.href)}">${escapeHtml(item.value)}</a>` : `<span>${escapeHtml(item.value)}</span>`}${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ""}</li>`).join("")}</ol></aside>`;
}

export function renderLedgerState(options: LedgerStateOptions): string {
  const role = options.state === "error" || options.state === "denied" || options.state === "conflict" ? "alert" : "status";
  return `<section class="system-state system-state--${options.state}" role="${role}" aria-live="polite"${options.state === "loading" ? ' aria-busy="true"' : ""}><span class="system-state__mark" aria-hidden="true">${options.state.slice(0, 1).toUpperCase()}</span><div class="system-state__copy"><strong>${escapeHtml(options.title)}</strong><span>${escapeHtml(options.detail)}</span></div>${options.actionLabel ? `<button type="button" class="system-state__action"${options.actionDisabled ? " disabled" : ""}>${escapeHtml(options.actionLabel)}</button>` : ""}</section>`;
}

/**
 * Compatibility layer for module-owned surfaces that pre-date the final Stitch
 * Operations Ledger authority. It deliberately preserves module markup and
 * behavior while normalising visual tokens, table density, evidence hierarchy,
 * focus states and the warm-ledger / dark-signal relationship.
 */
export const operationsLedgerBridgeStyles = `<style data-operations-ledger-bridge>
.app-shell .shell-main{background:var(--paper)}
.app-shell .workspace{inline-size:100%;max-inline-size:100rem}
.app-shell .shell-main :is(table,td,th,dd,output,.cell-detail,[data-numeric]){font-variant-numeric:tabular-nums}
.app-shell .shell-main :is(.table-wrap,.modg-table-wrap,.modg-int-table,.modg-saas-table,.modf-table-wrap){scrollbar-gutter:stable;overscroll-behavior-inline:contain}
.app-shell .shell-main :is(.table-wrap,.modg-table-wrap,.modg-int-table,.modg-saas-table,.modf-table-wrap) thead th{position:sticky;inset-block-start:0;z-index:2}
.app-shell .shell-main :is(button,a,input,select,textarea):focus-visible{outline:3px solid var(--focus);outline-offset:3px}
.app-shell .shell-main :is(.modg-page,.modg-int,.modg-saas){color:var(--ink);background:transparent}
.app-shell .shell-main :is(.modg-page,.modg-int,.modg-saas) :is(h1,h2,h3,strong){color:var(--ink)}
.app-shell .shell-main :is(.modg-page,.modg-int,.modg-saas) :is(p,small,span,dt){color:var(--muted)}
.app-shell .shell-main .modg-page .modg-hero,
.app-shell .shell-main .modg-int>header,
.app-shell .shell-main .modg-saas>header{background:var(--rail);background-image:none;border:1px solid var(--rail);border-radius:var(--radius);box-shadow:none;color:#edf6f1}
.app-shell .shell-main .modg-page .modg-hero :is(h1,h2,strong,dd),
.app-shell .shell-main .modg-int>header :is(h1,h2,strong,dd),
.app-shell .shell-main .modg-saas>header :is(h1,h2,strong,dd){color:#f5faf7}
.app-shell .shell-main .modg-page .modg-hero :is(p,dt),
.app-shell .shell-main .modg-int>header :is(p,dt),
.app-shell .shell-main .modg-saas>header :is(p,dt){color:#bed0c7}
.app-shell .shell-main .modg-page .modg-eyebrow,
.app-shell .shell-main .modg-int .modg-int-eyebrow,
.app-shell .shell-main .modg-int .modg-int-heading p,
.app-shell .shell-main .modg-saas .modg-saas-eyebrow{color:#f0d36d}
.app-shell .shell-main .modg-page .modg-context div,
.app-shell .shell-main .modg-int>header dl div,
.app-shell .shell-main .modg-saas>header dl div{background:var(--rail-soft);border:1px solid rgba(255,255,255,.12);border-radius:var(--radius-small)}
.app-shell .shell-main :is(.modg-panel,.modg-metric,.modg-int-panel,.modg-int-cards article,.modg-saas-subscription,.modg-saas-panel,.modg-saas-meter-grid article){background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:none;color:var(--ink)}
.app-shell .shell-main :is(.modg-panel,.modg-metric,.modg-int-panel,.modg-int-cards article,.modg-saas-subscription,.modg-saas-panel,.modg-saas-meter-grid article) :is(h2,h3,strong,dd){color:var(--ink)}
.app-shell .shell-main :is(.modg-panel,.modg-metric,.modg-int-panel,.modg-int-cards article,.modg-saas-subscription,.modg-saas-panel,.modg-saas-meter-grid article) :is(p,small,span,dt,footer){color:var(--muted)}
.app-shell .shell-main :is(.modg-table-wrap,.modg-int-table,.modg-saas-table){border:1px solid var(--line);border-radius:var(--radius-small);background:var(--surface)}
.app-shell .shell-main :is(.modg-table-wrap,.modg-int-table,.modg-saas-table) table{background:var(--surface);color:var(--ink)}
.app-shell .shell-main :is(.modg-table-wrap,.modg-int-table,.modg-saas-table) th{background:#f1f2ed;color:var(--muted);border-color:var(--line)}
.app-shell .shell-main :is(.modg-table-wrap,.modg-int-table,.modg-saas-table) td{background:var(--surface);color:var(--ink);border-color:var(--line)}
.app-shell .shell-main .modg-metric-grid{display:block;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:var(--surface);margin-block-start:.8rem}
.app-shell .shell-main .modg-metric-grid .modg-metric{display:grid;grid-template-columns:minmax(12rem,.8fr) minmax(17rem,1.4fr) minmax(10rem,.65fr);gap:1rem;align-items:center;border:0;border-block-end:1px solid var(--line);border-radius:0;background:transparent;padding:.9rem 1rem}
.app-shell .shell-main .modg-metric-grid .modg-metric:last-child{border-block-end:0}
.app-shell .shell-main .modg-metric-grid .modg-metric__value{margin:0;font-size:1.25rem;color:var(--ink);font-variant-numeric:tabular-nums}
.app-shell .shell-main .modg-metric-grid .modg-metric dl{grid-template-columns:repeat(2,minmax(0,1fr));margin:0}
.app-shell .shell-main .modg-metric-grid .modg-metric__footer{justify-content:flex-end}
.app-shell .shell-main .modg-int-cards{display:block;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:var(--surface)}
.app-shell .shell-main .modg-int-cards article{border:0;border-block-end:1px solid var(--line);border-radius:0;background:transparent}
.app-shell .shell-main .modg-int-cards article:last-child{border-block-end:0}
.app-shell .shell-main .modg-saas-meter-grid{display:block;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:var(--surface)}
.app-shell .shell-main .modg-saas-meter-grid article{display:grid;grid-template-columns:minmax(12rem,1fr) minmax(12rem,.7fr) minmax(14rem,1fr);align-items:center;gap:1rem;border:0;border-block-end:1px solid var(--line);border-radius:0;background:transparent}
.app-shell .shell-main .modg-saas-meter-grid article:last-child{border-block-end:0}
.app-shell .shell-main .modg-saas-meter-grid article p{margin:0;font-variant-numeric:tabular-nums}
.app-shell .shell-main :is(.modg-panel button,.modg-int button,.modg-saas button){min-block-size:44px;border:1px solid var(--accent);border-radius:var(--radius-small);background:var(--accent);color:#fff;font-weight:800}
.app-shell .shell-main :is(.modg-panel button,.modg-int button,.modg-saas button):hover:not(:disabled){background:var(--accent-strong)}
.app-shell .shell-main :is(.modg-tabs a,.modf-tabs a){min-block-size:44px;display:inline-flex;align-items:center}
.app-shell .shell-main .modg-tabs a[aria-current=page]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-strong)}
.app-shell .shell-main :is(.modg-badge,.modg-int-badge,.modg-saas-badge){border-radius:999px;font-weight:780}
.app-shell .shell-main :is(.modg-state,.modg-int-state,.modg-saas-state){background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--radius);color:var(--ink);text-align:start}
.app-shell .shell-main .modf-control{padding:0;background:transparent;color:var(--ink)}
.app-shell .shell-main .modf-panel{background:var(--surface);border-color:var(--line);border-radius:var(--radius);overflow:hidden}
.app-shell .shell-main .modf-active{border-radius:var(--radius);background:var(--rail)}
.app-shell .shell-main .modf-signals{border-radius:var(--radius);overflow:hidden}
.app-shell .shell-main .modf-notice{border-radius:var(--radius-small)}
.app-shell .shell-main .ledger-evidence a{color:var(--accent-strong);font-weight:800;text-underline-offset:3px}
@media(max-width:900px){
  .app-shell .shell-main .modg-metric-grid .modg-metric,
  .app-shell .shell-main .modg-saas-meter-grid article{grid-template-columns:minmax(0,1fr)}
  .app-shell .shell-main .modg-metric-grid .modg-metric__footer{justify-content:flex-start}
}
@media(max-width:620px){
  .app-shell .shell-main :is(.modg-page,.modg-int,.modg-saas,.modf-control){min-inline-size:0;max-inline-size:100%}
  .app-shell .shell-main :is(.modg-table-wrap,.modg-int-table,.modg-saas-table,.modf-table-wrap){max-inline-size:calc(100vw - 2rem)}
}
@media(prefers-reduced-motion:reduce){.app-shell .shell-main *{scroll-behavior:auto!important;transition:none!important}}
</style>`;
