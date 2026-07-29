export type LocalizationControlState = "ready" | "loading" | "empty" | "error" | "denied";
export type CountryPackSupportLevel = "experimental" | "limited" | "validated";
export type CountryPackLifecycleStatus = "draft" | "scheduled" | "active" | "superseded" | "retired";
export type ComplianceQueueStatus = "pending" | "unknown" | "rejected" | "accepted" | "review";

export interface CountryPackRow {
  readonly packId: string;
  readonly countryCode: string;
  readonly version: string;
  readonly supportLevel: CountryPackSupportLevel;
  readonly lifecycleStatus: CountryPackLifecycleStatus;
  readonly defaultLocale: string;
  readonly effectiveFrom: string;
  readonly offlineLegalCapability: "unsupported" | "cash_only" | "contingency_receipts" | "fully_supported";
  readonly fiscalSubmission: boolean;
  readonly electronicInvoicing: boolean;
  readonly limitations: readonly string[];
}

export interface ComplianceQueueRow {
  readonly resourceId: string;
  readonly kind: "fiscal_submission" | "privacy_operation" | "legal_document";
  readonly status: ComplianceQueueStatus;
  readonly detail: string;
  readonly observedAt: string;
  readonly countryPackVersion: string;
  readonly actionRequired: boolean;
}

export interface LocalizationControlPage {
  readonly state?: LocalizationControlState;
  readonly focus?: "country_packs" | "compliance";
  readonly scopeLabel: string;
  readonly refreshedAt: string;
  readonly activePack?: CountryPackRow;
  readonly packs: readonly CountryPackRow[];
  readonly queue: readonly ComplianceQueueRow[];
  readonly legalNumbersRemaining: string;
  readonly unknownFiscalCount: number;
  readonly pendingPrivacyCount: number;
  readonly immutableDocumentCount: number;
  readonly dataResidencySummary: string;
  readonly canManagePacks: boolean;
  readonly canManageCompliance: boolean;
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
  return value.replaceAll("_", " ").replace(/^./u, (character) => character.toUpperCase());
}

function statePanel(state: LocalizationControlState): string {
  if (state === "ready") return "";
  const copy: Record<Exclude<LocalizationControlState, "ready">, readonly [string, string]> = {
    loading: ["Loading localization controls", "Existing legal evidence and active pack assignments remain unchanged while data refreshes."],
    empty: ["No country pack is configured", "Publish a reviewed country pack before enabling legal documents or fiscal workflows."],
    error: ["Localization controls could not refresh", "Do not activate a different pack or repeat a fiscal submission until current state is confirmed."],
    denied: ["Localization permission required", "Request the narrow country-pack or compliance read permission for this legal entity."],
  };
  const [title, detail] = copy[state];
  const role = state === "error" || state === "denied" ? "alert" : "status";
  return `<section class="modf-state modf-state--${state}" role="${role}" aria-live="polite"${state === "loading" ? ' aria-busy="true"' : ""}><strong>${title}</strong><span>${detail}</span></section>`;
}

function supportTone(level: CountryPackSupportLevel): "success" | "attention" | "danger" {
  if (level === "validated") return "success";
  if (level === "limited") return "attention";
  return "danger";
}

function queueTone(status: ComplianceQueueStatus): "success" | "attention" | "danger" | "neutral" {
  if (status === "accepted") return "success";
  if (status === "unknown" || status === "review" || status === "pending") return "attention";
  if (status === "rejected") return "danger";
  return "neutral";
}

function renderLimitations(limitations: readonly string[]): string {
  if (limitations.length === 0) return `<span class="modf-clear">No documented limitation</span>`;
  return `<ul class="modf-limitations">${limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join("")}</ul>`;
}

function renderPacks(rows: readonly CountryPackRow[], canManage: boolean): string {
  if (rows.length === 0) return `<tr><td colspan="8" class="modf-empty-cell">No published country-pack versions in this scope.</td></tr>`;
  return rows.map((row) => `<tr data-pack-id="${escapeHtml(row.packId)}" data-support-level="${row.supportLevel}">
    <td><strong>${escapeHtml(row.countryCode)} · ${escapeHtml(row.packId)}</strong><span>Version ${escapeHtml(row.version)}</span></td>
    <td><span class="modf-badge modf-badge--${supportTone(row.supportLevel)}">${humanize(row.supportLevel)}</span></td>
    <td>${escapeHtml(humanize(row.lifecycleStatus))}</td>
    <td><strong>${escapeHtml(row.defaultLocale)}</strong><span>From ${escapeHtml(row.effectiveFrom)}</span></td>
    <td>${escapeHtml(humanize(row.offlineLegalCapability))}</td>
    <td><span>${row.fiscalSubmission ? "Enabled" : "Disabled"}</span><small>E-invoice ${row.electronicInvoicing ? "enabled" : "disabled"}</small></td>
    <td>${renderLimitations(row.limitations)}</td>
    <td><button type="button" class="modf-table-action"${canManage ? "" : " disabled"}>Review activation</button></td>
  </tr>`).join("");
}

function renderQueue(rows: readonly ComplianceQueueRow[], canManage: boolean): string {
  if (rows.length === 0) return `<tr><td colspan="6" class="modf-empty-cell">No compliance exceptions require attention.</td></tr>`;
  return rows.map((row) => `<tr data-resource-id="${escapeHtml(row.resourceId)}" data-status="${row.status}">
    <td><strong>${escapeHtml(row.resourceId)}</strong><span>${escapeHtml(humanize(row.kind))}</span></td>
    <td><span class="modf-badge modf-badge--${queueTone(row.status)}">${humanize(row.status)}</span></td>
    <td>${escapeHtml(row.detail)}</td>
    <td>${escapeHtml(row.countryPackVersion)}</td>
    <td>${escapeHtml(row.observedAt)}</td>
    <td>${row.actionRequired ? `<button type="button" class="modf-table-action"${canManage ? "" : " disabled"}>Open evidence</button>` : `<span class="modf-clear">No action</span>`}</td>
  </tr>`).join("");
}

function renderActivePack(pack: CountryPackRow | undefined): string {
  if (!pack) {
    return `<section class="modf-active modf-active--missing" role="alert"><div><p class="modf-eyebrow">Active country pack</p><h2>Not configured</h2></div><p>Legal documents, fiscal submission and offline legal behavior must remain blocked until an effective pack is activated.</p></section>`;
  }
  const limitationMessage = pack.limitations.length === 0
    ? "No pack limitations are recorded for this validated version."
    : `${pack.limitations.length} documented limitation${pack.limitations.length === 1 ? "" : "s"} must remain visible to operators.`;
  return `<section class="modf-active" aria-labelledby="modf-active-title">
    <div><p class="modf-eyebrow">Active country pack</p><h2 id="modf-active-title">${escapeHtml(pack.countryCode)} · ${escapeHtml(pack.version)}</h2><p>${escapeHtml(pack.defaultLocale)} · Effective ${escapeHtml(pack.effectiveFrom)}</p></div>
    <div><span class="modf-badge modf-badge--${supportTone(pack.supportLevel)}">${humanize(pack.supportLevel)} support</span><p>${escapeHtml(limitationMessage)}</p></div>
    <dl><div><dt>Offline legal</dt><dd>${escapeHtml(humanize(pack.offlineLegalCapability))}</dd></div><div><dt>Fiscal submission</dt><dd>${pack.fiscalSubmission ? "Enabled" : "Disabled"}</dd></div><div><dt>Electronic invoicing</dt><dd>${pack.electronicInvoicing ? "Enabled" : "Disabled"}</dd></div></dl>
  </section>`;
}

export function renderLocalizationControlPage(page: LocalizationControlPage): string {
  const state = page.state ?? "ready";
  const focus = page.focus ?? "country_packs";
  const attentionCount = page.unknownFiscalCount + page.pendingPrivacyCount + page.queue.filter((row) => row.status === "rejected" || row.status === "review").length;
  const actionCopy = focus === "country_packs" ? "Publish pack" : "Open compliance report";
  const actionDisabled = focus === "country_packs" ? !page.canManagePacks : !page.canManageCompliance;

  return `<style>${MOD_F_LOCALIZATION_STYLES}</style>
  <main class="modf-control" data-state="${state}" data-focus="${focus}" aria-labelledby="modf-title">
    <header class="modf-header">
      <div><p class="modf-eyebrow">International operations control</p><h1 id="modf-title">Localization &amp; compliance</h1><p>${escapeHtml(page.scopeLabel)} · Refreshed ${escapeHtml(page.refreshedAt)}</p></div>
      <button type="button" class="modf-primary"${actionDisabled ? " disabled" : ""}>${actionCopy}</button>
    </header>
    <nav class="modf-tabs" aria-label="Localization workspaces"><a href="/localization"${focus === "country_packs" ? ' aria-current="page"' : ""}>Country packs</a><a href="/compliance"${focus === "compliance" ? ' aria-current="page"' : ""}>Compliance evidence</a></nav>
    ${statePanel(state)}
    ${renderActivePack(page.activePack)}
    <section class="modf-signals" aria-label="Localization and compliance summary">
      <div><span>Legal numbers remaining</span><strong>${escapeHtml(page.legalNumbersRemaining)}</strong></div>
      <div><span>Unknown fiscal status</span><strong>${page.unknownFiscalCount}</strong></div>
      <div><span>Privacy requests pending</span><strong>${page.pendingPrivacyCount}</strong></div>
      <div><span>Immutable documents</span><strong>${page.immutableDocumentCount}</strong></div>
    </section>
    <section class="modf-notice" role="status" aria-live="polite"><strong>${attentionCount === 0 ? "No unresolved compliance exception is hidden." : `${attentionCount} item${attentionCount === 1 ? "" : "s"} require explicit review.`}</strong><span>Unknown fiscal state blocks blind retry. Privacy disposition must preserve legally required evidence.</span></section>
    <section class="modf-panel" aria-labelledby="modf-packs-title">
      <header><div><h2 id="modf-packs-title">Country-pack versions</h2><p>Effective-dated versions remain immutable after publication.</p></div><span>${page.packs.length} version${page.packs.length === 1 ? "" : "s"}</span></header>
      <div class="modf-table-wrap"><table><thead><tr><th scope="col">Pack</th><th scope="col">Support</th><th scope="col">Lifecycle</th><th scope="col">Locale / effective</th><th scope="col">Offline legal</th><th scope="col">Fiscal</th><th scope="col">Limitations</th><th scope="col">Action</th></tr></thead><tbody>${renderPacks(page.packs, page.canManagePacks)}</tbody></table></div>
    </section>
    <section class="modf-panel" aria-labelledby="modf-queue-title">
      <header><div><h2 id="modf-queue-title">Compliance evidence queue</h2><p>Rejected, unknown and review-required outcomes remain visible after resolution.</p></div><a href="/audit?module=localization">Open audit history</a></header>
      <div class="modf-table-wrap"><table><thead><tr><th scope="col">Resource</th><th scope="col">Status</th><th scope="col">Detail</th><th scope="col">Pack version</th><th scope="col">Observed</th><th scope="col">Action</th></tr></thead><tbody>${renderQueue(page.queue, page.canManageCompliance)}</tbody></table></div>
    </section>
    <footer class="modf-residency"><strong>Data residency</strong><span>${escapeHtml(page.dataResidencySummary)}</span><a href="/compliance/residency">Review provider matrix</a></footer>
  </main>`;
}

export const MOD_F_LOCALIZATION_STYLES = `
.modf-control{--ink:#17231e;--muted:#59675f;--paper:#f5f3ec;--surface:#fffefa;--line:#d7ddd8;--deep:#14251e;--accent:#1f6a51;--attention:#8a5a00;--danger:#9b2c2c;color:var(--ink);background:var(--paper);padding:clamp(16px,3vw,30px);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.4}.modf-control *{box-sizing:border-box}.modf-control button,.modf-control input{font:inherit}.modf-control button{min-height:44px}.modf-control button:disabled{cursor:not-allowed;opacity:.48}.modf-control :focus-visible{outline:3px solid #276e8f;outline-offset:3px}.modf-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-block-end:14px}.modf-header h1{margin:2px 0 7px;font-size:clamp(2rem,4vw,3rem);line-height:1}.modf-header p{margin:0;color:var(--muted)}.modf-eyebrow{font-size:.76rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.modf-primary{border:0;background:var(--deep);color:white;font-weight:850;padding:9px 16px}.modf-tabs{display:flex;gap:5px;border-block-end:1px solid var(--line);margin-block-end:14px}.modf-tabs a{color:var(--muted);font-weight:800;text-decoration:none;padding:10px 13px;border-block-end:3px solid transparent}.modf-tabs a[aria-current=page]{color:var(--accent);border-block-end-color:var(--accent)}.modf-state{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;padding:13px 15px;border:1px solid var(--line);background:var(--surface);margin-block-end:14px}.modf-state span{color:var(--muted)}.modf-state--error,.modf-state--denied{border-color:var(--danger);background:#fff2f0}.modf-state--loading{border-color:#d8b96f;background:#fff8e8}.modf-active{display:grid;grid-template-columns:minmax(220px,.8fr) minmax(260px,1fr) minmax(260px,1fr);gap:18px;align-items:start;background:var(--deep);color:white;padding:18px;margin-block-end:14px}.modf-active h2{margin:2px 0 5px;font-size:1.55rem}.modf-active p{margin:3px 0;color:#dcece5}.modf-active dl{margin:0;display:grid;gap:8px}.modf-active dl div{display:flex;justify-content:space-between;gap:14px;border-block-end:1px solid rgba(255,255,255,.16);padding-block-end:7px}.modf-active dt,.modf-active dd{margin:0}.modf-active dd{font-weight:800;text-align:end}.modf-active--missing{grid-template-columns:minmax(220px,.7fr) 1fr;background:#fff2f0;color:var(--danger);border:1px solid var(--danger)}.modf-active--missing p{color:#6a3a38}.modf-signals{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--surface);border:1px solid var(--line);margin-block-end:14px}.modf-signals div{padding:14px;border-inline-end:1px solid var(--line)}.modf-signals div:last-child{border-inline-end:0}.modf-signals span,.modf-signals strong{display:block}.modf-signals span{font-size:.78rem;color:var(--muted)}.modf-signals strong{font-size:1.65rem;margin-block-start:4px;font-variant-numeric:tabular-nums}.modf-notice{display:grid;gap:3px;border:1px solid #d8b96f;background:#fff8e8;padding:13px 15px;margin-block-end:14px}.modf-notice span{color:var(--muted)}.modf-panel{background:var(--surface);border:1px solid var(--line);margin-block-end:14px}.modf-panel>header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border-block-end:1px solid var(--line)}.modf-panel h2{margin:0;font-size:1.08rem}.modf-panel header p{margin:3px 0 0;color:var(--muted)}.modf-panel header>a{color:var(--accent);font-weight:800}.modf-table-wrap{overflow:auto}.modf-control table{width:100%;min-width:1060px;border-collapse:collapse}.modf-control th,.modf-control td{padding:11px 12px;text-align:start;vertical-align:top;border-block-end:1px solid var(--line)}.modf-control th{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.modf-control td span,.modf-control td small{display:block}.modf-control td small,.modf-control td>span:not(.modf-badge):not(.modf-clear){color:var(--muted);margin-block-start:3px}.modf-badge{display:inline-flex!important;align-items:center;min-height:28px;padding:3px 8px;border:1px solid currentColor;font-size:.72rem;font-weight:900;text-transform:uppercase}.modf-badge--success{color:var(--accent)}.modf-badge--attention{color:var(--attention)}.modf-badge--danger{color:var(--danger)}.modf-badge--neutral{color:var(--muted)}.modf-limitations{margin:0;padding-inline-start:18px;max-width:270px}.modf-limitations li+li{margin-block-start:4px}.modf-clear{color:var(--accent);font-weight:800}.modf-table-action{border:1px solid #7c8b83;background:white;color:var(--ink);font-weight:800;padding:6px 10px}.modf-empty-cell{text-align:center!important;color:var(--muted);padding:34px!important}.modf-residency{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;background:#e9e4d8;padding:13px 15px}.modf-residency span{color:var(--muted)}.modf-residency a{color:var(--accent);font-weight:800}@media(max-width:900px){.modf-active{grid-template-columns:1fr 1fr}.modf-active dl{grid-column:1/-1}.modf-signals{grid-template-columns:repeat(2,minmax(0,1fr))}.modf-signals div:nth-child(2){border-inline-end:0}.modf-signals div:nth-child(-n+2){border-block-end:1px solid var(--line)}}@media(max-width:620px){.modf-header,.modf-panel>header,.modf-residency{display:grid}.modf-tabs{overflow:auto}.modf-active,.modf-active--missing{grid-template-columns:1fr}.modf-active dl{grid-column:auto}.modf-signals{grid-template-columns:1fr}.modf-signals div{border-inline-end:0;border-block-end:1px solid var(--line)}}@media(prefers-reduced-motion:reduce){.modf-control *{scroll-behavior:auto!important}}
`;
