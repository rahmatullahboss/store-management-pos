export type PosReconciliationStatus = "rejected" | "review" | "adjusted" | "accepted" | "duplicate";

export interface PosReconciliationRow {
  readonly operationId: string;
  readonly operationType: string;
  readonly deviceReference: string;
  readonly registerReference: string;
  readonly status: PosReconciliationStatus;
  readonly reasonCode?: string;
  readonly detail: string;
  readonly serverReference?: string;
  readonly receivedAt: string;
  readonly resolvedAt?: string;
  readonly resolutionReference?: string;
}

export interface PosReconciliationPage {
  readonly refreshedAt: string;
  readonly locationLabel: string;
  readonly rejectedCount: number;
  readonly reviewCount: number;
  readonly adjustedCount: number;
  readonly pendingDeviceCount: number;
  readonly rows: readonly PosReconciliationRow[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function statusLabel(status: PosReconciliationStatus): string {
  if (status === "review") return "Needs review";
  return humanize(status).replace(/^./u, (character) => character.toUpperCase());
}

function tone(status: PosReconciliationStatus): "danger" | "attention" | "success" | "neutral" {
  if (status === "rejected") return "danger";
  if (status === "review" || status === "adjusted") return "attention";
  if (status === "accepted") return "success";
  return "neutral";
}

function renderRows(rows: readonly PosReconciliationRow[]): string {
  if (rows.length === 0) {
    return `<tr><td colspan="7" class="pos-reconciliation__empty">No reconciliation exceptions in the current scope.</td></tr>`;
  }

  return rows.map((row) => {
    const resolution = row.resolvedAt
      ? `<span class="pos-reconciliation__resolved">Resolved ${escapeHtml(row.resolvedAt)}${row.resolutionReference ? ` · ${escapeHtml(row.resolutionReference)}` : ""}</span>`
      : `<span class="pos-reconciliation__unresolved">Explicit resolution required</span>`;
    const reason = row.reasonCode ? `<code>${escapeHtml(row.reasonCode)}</code>` : "—";
    const source = row.serverReference ? escapeHtml(row.serverReference) : "Not assigned";

    return `<tr data-operation-id="${escapeHtml(row.operationId)}" data-status="${row.status}">
      <td><strong>${escapeHtml(row.operationId)}</strong><span>${escapeHtml(humanize(row.operationType))}</span></td>
      <td><span>${escapeHtml(row.registerReference)}</span><small>${escapeHtml(row.deviceReference)}</small></td>
      <td><span class="pos-reconciliation__status pos-reconciliation__status--${tone(row.status)}">${statusLabel(row.status)}</span></td>
      <td>${reason}<span>${escapeHtml(row.detail)}</span></td>
      <td>${source}</td>
      <td>${escapeHtml(row.receivedAt)}</td>
      <td>${resolution}</td>
    </tr>`;
  }).join("");
}

export function renderPosReconciliationPage(page: PosReconciliationPage): string {
  const attentionCount = page.rejectedCount + page.reviewCount + page.adjustedCount;
  const attentionMessage = attentionCount === 0
    ? "No rejected, adjusted or review-required operations are hidden from this view."
    : `${attentionCount} operation${attentionCount === 1 ? "" : "s"} require traceable review or resolution.`;

  return `<style>${POS_RECONCILIATION_STYLES}</style>
  <main class="pos-reconciliation" aria-labelledby="pos-reconciliation-title">
    <header class="pos-reconciliation__header">
      <div><p class="pos-reconciliation__eyebrow">Store edge control</p><h1 id="pos-reconciliation-title">POS reconciliation</h1><p>${escapeHtml(page.locationLabel)} · Refreshed ${escapeHtml(page.refreshedAt)}</p></div>
      <a class="pos-reconciliation__refresh" href="/pos/reconciliation">Refresh evidence</a>
    </header>
    <section class="pos-reconciliation__signal" aria-label="Reconciliation summary">
      <div><span>Rejected</span><strong>${page.rejectedCount}</strong></div>
      <div><span>Needs review</span><strong>${page.reviewCount}</strong></div>
      <div><span>Adjusted</span><strong>${page.adjustedCount}</strong></div>
      <div><span>Devices pending sync</span><strong>${page.pendingDeviceCount}</strong></div>
    </section>
    <section class="pos-reconciliation__notice" role="status" aria-live="polite"><strong>${attentionMessage}</strong><span>Completed local receipt evidence remains immutable; corrections require an explicit outcome, approval or reversal.</span></section>
    <section class="pos-reconciliation__queue" aria-labelledby="pos-reconciliation-queue-title">
      <header><div><h2 id="pos-reconciliation-queue-title">Operation evidence</h2><p>Rejected and adjusted operations remain visible after resolution.</p></div><a href="/audit?module=pos">Open audit history</a></header>
      <div class="pos-reconciliation__table-wrap"><table><thead><tr><th scope="col">Operation</th><th scope="col">Register / device</th><th scope="col">Outcome</th><th scope="col">Reason</th><th scope="col">Server reference</th><th scope="col">Received</th><th scope="col">Resolution</th></tr></thead><tbody>${renderRows(page.rows)}</tbody></table></div>
    </section>
  </main>`;
}

export const POS_RECONCILIATION_STYLES = `
.pos-reconciliation{--ink:#17231e;--muted:#59675f;--paper:#f5f3ec;--surface:#fffefa;--line:#d7ddd8;--rail:#14251e;--accent:#1f6a51;--attention:#8a5a00;--danger:#9b2c2c;color:var(--ink);background:var(--paper);padding:clamp(16px,3vw,30px);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.pos-reconciliation *{box-sizing:border-box}.pos-reconciliation :focus-visible{outline:3px solid #e09a13;outline-offset:3px}.pos-reconciliation__header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-block-end:18px}.pos-reconciliation__header h1{margin:2px 0 7px;font-size:clamp(2rem,4vw,3rem);line-height:1}.pos-reconciliation__header p{margin:0;color:var(--muted)}.pos-reconciliation__eyebrow{font-size:.76rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.pos-reconciliation__refresh,.pos-reconciliation__queue a{color:var(--accent);font-weight:800}.pos-reconciliation__refresh{min-height:44px;display:inline-flex;align-items:center;border:1px solid var(--accent);padding:8px 13px;text-decoration:none}.pos-reconciliation__signal{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--rail);color:white;margin-block-end:14px}.pos-reconciliation__signal div{padding:15px;border-inline-end:1px solid rgba(255,255,255,.18)}.pos-reconciliation__signal div:last-child{border-inline-end:0}.pos-reconciliation__signal span,.pos-reconciliation__signal strong{display:block}.pos-reconciliation__signal span{font-size:.78rem;color:#dcece5}.pos-reconciliation__signal strong{font-size:1.75rem;margin-block-start:4px;font-variant-numeric:tabular-nums}.pos-reconciliation__notice{display:grid;gap:4px;border:1px solid #d8b96f;background:#fff8e8;padding:13px 15px;margin-block-end:14px}.pos-reconciliation__notice span{color:var(--muted)}.pos-reconciliation__queue{background:var(--surface);border:1px solid var(--line)}.pos-reconciliation__queue>header{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:15px 17px;border-block-end:1px solid var(--line)}.pos-reconciliation__queue h2{margin:0;font-size:1.1rem}.pos-reconciliation__queue p{margin:4px 0 0;color:var(--muted)}.pos-reconciliation__table-wrap{overflow:auto}.pos-reconciliation table{width:100%;min-width:1020px;border-collapse:collapse}.pos-reconciliation th,.pos-reconciliation td{padding:12px;text-align:start;border-block-end:1px solid var(--line);vertical-align:top}.pos-reconciliation th{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.pos-reconciliation td span,.pos-reconciliation td small{display:block}.pos-reconciliation td small,.pos-reconciliation td>span:not(.pos-reconciliation__status){color:var(--muted);margin-block-start:4px}.pos-reconciliation code{display:inline-block;background:#ece9df;padding:2px 5px;font-size:.78rem}.pos-reconciliation__status{display:inline-flex!important;align-items:center;min-height:28px;padding:3px 8px;border:1px solid currentColor;font-size:.74rem;font-weight:900;text-transform:uppercase}.pos-reconciliation__status--danger{color:var(--danger)}.pos-reconciliation__status--attention{color:var(--attention)}.pos-reconciliation__status--success{color:var(--accent)}.pos-reconciliation__status--neutral{color:var(--muted)}.pos-reconciliation__unresolved{color:var(--danger)!important;font-weight:800}.pos-reconciliation__resolved{color:var(--accent)!important;font-weight:700}.pos-reconciliation__empty{text-align:center!important;color:var(--muted);padding:38px!important}@media(max-width:820px){.pos-reconciliation__header,.pos-reconciliation__queue>header{display:grid}.pos-reconciliation__signal{grid-template-columns:repeat(2,minmax(0,1fr))}.pos-reconciliation__signal div:nth-child(2){border-inline-end:0}.pos-reconciliation__signal div:nth-child(-n+2){border-block-end:1px solid rgba(255,255,255,.18)}}@media(max-width:480px){.pos-reconciliation__signal{grid-template-columns:1fr}.pos-reconciliation__signal div{border-inline-end:0;border-block-end:1px solid rgba(255,255,255,.18)}}@media(prefers-reduced-motion:reduce){.pos-reconciliation *{scroll-behavior:auto!important}}
`;
