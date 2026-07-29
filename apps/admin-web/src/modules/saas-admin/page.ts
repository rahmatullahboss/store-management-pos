export type SaasAdminState = "ready" | "loading" | "empty" | "error" | "denied";

export interface SaasSubscriptionSummary {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly planName: string;
  readonly planVersion: string;
  readonly status: "trial" | "active" | "past_due" | "suspended" | "cancelled";
  readonly periodLabel: string;
  readonly version: string;
}

export interface SaasUsageMeterRow {
  readonly meterCode: string;
  readonly label: string;
  readonly quantity: string;
  readonly limit?: string;
  readonly enforcement: "hard" | "soft" | "observe";
  readonly periodLabel: string;
}

export interface SaasLifecycleRow {
  readonly jobId: string;
  readonly operation: "provision" | "suspend" | "resume" | "offboard" | "export";
  readonly status: "queued" | "running" | "review" | "completed" | "failed" | "cancelled";
  readonly requestedBy: string;
  readonly requestedAtLabel: string;
  readonly reason: string;
}

export interface SaasRolloutRow {
  readonly featureCode: string;
  readonly status: "planned" | "enabled" | "paused" | "disabled";
  readonly percentage: number;
  readonly reason: string;
  readonly version: string;
}

export interface SaasIncidentRow {
  readonly incidentCode: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly status: "open" | "investigating" | "monitoring" | "resolved" | "closed";
  readonly summary: string;
  readonly ageLabel: string;
}

export interface SaasImpersonationRow {
  readonly grantId: string;
  readonly supportActor: string;
  readonly approvedBy: string;
  readonly scopeLabel: string;
  readonly expiresAtLabel: string;
  readonly status: "active" | "expired" | "revoked";
}

export interface SaasAdminPage {
  readonly state: SaasAdminState;
  readonly observedAtLabel: string;
  readonly subscription?: SaasSubscriptionSummary;
  readonly usage: readonly SaasUsageMeterRow[];
  readonly lifecycle: readonly SaasLifecycleRow[];
  readonly rollouts: readonly SaasRolloutRow[];
  readonly incidents: readonly SaasIncidentRow[];
  readonly impersonation: readonly SaasImpersonationRow[];
  readonly canManageSubscription: boolean;
  readonly canManageLifecycle: boolean;
  readonly canManageSupport: boolean;
  readonly message?: string;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function badge(value: string): string {
  return `<span class="modg-saas-badge modg-saas-badge--${escapeHtml(value)}">${escapeHtml(value.replaceAll("_", " "))}</span>`;
}

function statePanel(page: SaasAdminPage): string {
  if (page.state === "ready") return "";
  const heading = page.state === "denied" ? "Access restricted" : page.state === "error" ? "SaaS control plane unavailable" : page.state === "empty" ? "No subscription assigned" : "Loading platform controls";
  const message = page.message ?? (page.state === "denied" ? "Your role cannot read tenant subscription and support controls." : page.state === "error" ? "Platform controls could not be loaded. Tenant business data remains unchanged." : page.state === "empty" ? "Assign an active plan before enabling tenant services." : "Loading subscription, usage, rollout and support evidence…");
  return `<section class="modg-saas-state" role="${page.state === "error" ? "alert" : "status"}"><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(message)}</p></section>`;
}

function subscriptionPanel(page: SaasAdminPage): string {
  const subscription = page.subscription;
  if (!subscription) return "";
  return `<section class="modg-saas-subscription" aria-labelledby="modg-subscription-title"><div><p class="modg-saas-eyebrow">Tenant subscription</p><h2 id="modg-subscription-title">${escapeHtml(subscription.tenantName)}</h2><span>${escapeHtml(subscription.tenantId)}</span></div><dl><div><dt>Plan</dt><dd>${escapeHtml(subscription.planName)} <small>${escapeHtml(subscription.planVersion)}</small></dd></div><div><dt>Status</dt><dd>${badge(subscription.status)}</dd></div><div><dt>Current period</dt><dd>${escapeHtml(subscription.periodLabel)}</dd></div><div><dt>Version</dt><dd>${escapeHtml(subscription.version)}</dd></div></dl><div class="modg-saas-actions"><button type="button"${page.canManageSubscription ? "" : " disabled"}>Change plan</button><button type="button" class="modg-saas-secondary"${page.canManageSubscription ? "" : " disabled"}>Subscription actions</button></div></section>`;
}

function usagePanel(page: SaasAdminPage): string {
  return `<section class="modg-saas-panel" aria-labelledby="modg-usage-title"><div class="modg-saas-heading"><div><p class="modg-saas-eyebrow">Exact counters</p><h2 id="modg-usage-title">Usage and entitlements</h2></div><span>${page.usage.length} meters</span></div>${page.usage.length === 0 ? '<p class="modg-saas-empty">No usage has been recorded in this period.</p>' : `<div class="modg-saas-meter-grid">${page.usage.map((meter) => { const limited = meter.limit !== undefined; const ratio = limited && /^\d+$/u.test(meter.quantity) && /^\d+$/u.test(meter.limit!) && BigInt(meter.limit!) > 0n ? Number((BigInt(meter.quantity) * 100n) / BigInt(meter.limit!)) : undefined; const width = ratio === undefined ? 0 : Math.min(100, ratio); return `<article><div><strong>${escapeHtml(meter.label)}</strong>${badge(meter.enforcement)}</div><p><span>${escapeHtml(meter.quantity)}</span>${limited ? ` / ${escapeHtml(meter.limit!)}` : ""}</p><div class="modg-saas-meter" role="progressbar" aria-label="${escapeHtml(meter.label)} usage" aria-valuemin="0"${ratio === undefined ? "" : ` aria-valuemax="100" aria-valuenow="${Math.min(100, ratio)}"`}><span style="inline-size:${width}%"></span></div><footer>${escapeHtml(meter.meterCode)} · ${escapeHtml(meter.periodLabel)}</footer></article>`; }).join("")}</div>`}</section>`;
}

function lifecyclePanel(page: SaasAdminPage): string {
  return `<section class="modg-saas-panel" aria-labelledby="modg-lifecycle-title"><div class="modg-saas-heading"><div><p class="modg-saas-eyebrow">Data-preserving orchestration</p><h2 id="modg-lifecycle-title">Tenant lifecycle jobs</h2></div><button type="button"${page.canManageLifecycle ? "" : " disabled"}>Request job</button></div>${page.lifecycle.length === 0 ? '<p class="modg-saas-empty">No lifecycle jobs are active.</p>' : `<ul class="modg-saas-list">${page.lifecycle.map((job) => `<li><div><strong>${escapeHtml(job.operation)}</strong><span>${escapeHtml(job.reason)}</span><small>${escapeHtml(job.jobId)} · ${escapeHtml(job.requestedBy)} · ${escapeHtml(job.requestedAtLabel)}</small></div>${badge(job.status)}</li>`).join("")}</ul>`}</section>`;
}

function operationalControls(page: SaasAdminPage): string {
  return `<div class="modg-saas-columns"><section class="modg-saas-panel" aria-labelledby="modg-rollout-title"><div class="modg-saas-heading"><div><p class="modg-saas-eyebrow">Controlled exposure</p><h2 id="modg-rollout-title">Feature rollouts</h2></div><button type="button"${page.canManageSupport ? "" : " disabled"}>Configure</button></div>${page.rollouts.length === 0 ? '<p class="modg-saas-empty">No tenant rollouts configured.</p>' : `<ul class="modg-saas-list">${page.rollouts.map((row) => `<li><div><strong>${escapeHtml(row.featureCode)}</strong><span>${escapeHtml(row.reason)}</span><small>${row.percentage}% · version ${escapeHtml(row.version)}</small></div>${badge(row.status)}</li>`).join("")}</ul>`}</section><section class="modg-saas-panel" aria-labelledby="modg-incidents-title"><div class="modg-saas-heading"><div><p class="modg-saas-eyebrow">Support health</p><h2 id="modg-incidents-title">Incidents</h2></div><button type="button"${page.canManageSupport ? "" : " disabled"}>Open incident</button></div>${page.incidents.length === 0 ? '<p class="modg-saas-empty">No active incidents.</p>' : `<ul class="modg-saas-list">${page.incidents.map((row) => `<li><div><strong>${escapeHtml(row.incidentCode)} · ${escapeHtml(row.summary)}</strong><span>${escapeHtml(row.ageLabel)}</span></div><div>${badge(row.severity)}${badge(row.status)}</div></li>`).join("")}</ul>`}</section></div>`;
}

function impersonationPanel(page: SaasAdminPage): string {
  return `<section class="modg-saas-panel" aria-labelledby="modg-impersonation-title"><div class="modg-saas-heading"><div><p class="modg-saas-eyebrow">Visible and independently approved</p><h2 id="modg-impersonation-title">Support access</h2></div><button type="button"${page.canManageSupport ? "" : " disabled"}>Issue grant</button></div>${page.impersonation.length === 0 ? '<p class="modg-saas-empty">No support impersonation grants are active.</p>' : `<div class="modg-saas-table" tabindex="0" role="region" aria-label="Support impersonation grants table"><table><thead><tr><th>Support actor</th><th>Approved by</th><th>Scope</th><th>Expires</th><th>Status</th></tr></thead><tbody>${page.impersonation.map((row) => `<tr><td><strong>${escapeHtml(row.supportActor)}</strong><small>${escapeHtml(row.grantId)}</small></td><td>${escapeHtml(row.approvedBy)}</td><td>${escapeHtml(row.scopeLabel)}</td><td>${escapeHtml(row.expiresAtLabel)}</td><td>${badge(row.status)}</td></tr>`).join("")}</tbody></table></div>`}</section>`;
}

export function renderSaasAdminPage(page: SaasAdminPage): string {
  const state = statePanel(page);
  const incidentCount = page.incidents.filter((row) => row.status !== "closed").length;
  const runningJobs = page.lifecycle.filter((row) => row.status === "queued" || row.status === "running" || row.status === "review").length;
  const supportAccess = page.impersonation.filter((row) => row.status === "active").length;
  return `<style>${SAAS_ADMIN_STYLES}</style><main class="modg-saas" data-state="${escapeHtml(page.state)}"><header><div><p class="modg-saas-eyebrow">Multi-tenant operating layer</p><h1>SaaS administration</h1><p>Observed ${escapeHtml(page.observedAtLabel)}</p></div><dl><div><dt>Lifecycle jobs</dt><dd>${runningJobs}</dd></div><div><dt>Open incidents</dt><dd>${incidentCount}</dd></div><div><dt>Support grants</dt><dd>${supportAccess}</dd></div></dl></header>${state || `${subscriptionPanel(page)}${usagePanel(page)}${lifecyclePanel(page)}${operationalControls(page)}${impersonationPanel(page)}`}</main>`;
}

export const SAAS_ADMIN_STYLES = `
.modg-saas{display:grid;gap:1rem;color:#e8edf2}.modg-saas>header{display:flex;justify-content:space-between;gap:1rem;padding:1.45rem;border:1px solid #2a3741;background:linear-gradient(135deg,#17232b,#10171c);border-radius:1rem}.modg-saas h1,.modg-saas h2{margin:.2rem 0}.modg-saas header p{margin:.35rem 0;color:#90a3ae}.modg-saas-eyebrow{margin:0!important;color:#7acabc!important;text-transform:uppercase;letter-spacing:.12em;font-size:.72rem}.modg-saas header dl{display:flex;gap:.65rem;margin:0}.modg-saas header dl div{min-width:6rem;padding:.65rem;background:#0c1419;border-radius:.6rem;text-align:center}.modg-saas dt{font-size:.7rem;color:#8295a1}.modg-saas dd{margin:.2rem 0}.modg-saas-subscription,.modg-saas-panel{padding:1rem;border:1px solid #2a3741;background:#111a20;border-radius:.85rem}.modg-saas-subscription{display:grid;grid-template-columns:minmax(12rem,.7fr) minmax(20rem,1.5fr) auto;gap:1rem;align-items:center}.modg-saas-subscription>div>span{color:#778b97;font-size:.75rem}.modg-saas-subscription dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.6rem;margin:0}.modg-saas-subscription dl div{padding:.55rem;background:#0c1419;border-radius:.55rem}.modg-saas-subscription small{color:#7e919d}.modg-saas-actions{display:flex;gap:.45rem}.modg-saas button{border:0;border-radius:.55rem;background:#2a716b;color:#fff;padding:.58rem .72rem}.modg-saas button.modg-saas-secondary{background:#283740}.modg-saas button:disabled{opacity:.42}.modg-saas-heading{display:flex;justify-content:space-between;align-items:end;gap:1rem}.modg-saas-heading>span{color:#8194a0}.modg-saas-meter-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7rem;margin-top:.8rem}.modg-saas-meter-grid article{padding:.8rem;background:#0c1419;border-radius:.65rem;border:1px solid #24323b}.modg-saas-meter-grid article>div{display:flex;justify-content:space-between;gap:.5rem}.modg-saas-meter-grid p{font-size:1.35rem;margin:.8rem 0}.modg-saas-meter-grid footer{font-size:.72rem;color:#758995;margin-top:.5rem}.modg-saas-meter{height:.38rem;border-radius:999px;background:#27343d;overflow:hidden}.modg-saas-meter span{display:block;height:100%;background:#3c9b8f}.modg-saas-list{list-style:none;padding:0;margin:.8rem 0 0;display:grid;gap:.45rem}.modg-saas-list li{display:flex;justify-content:space-between;gap:.8rem;padding:.7rem;border-top:1px solid #28353f}.modg-saas-list span,.modg-saas-list small{display:block;color:#8194a0;margin-top:.2rem}.modg-saas-list li>div:last-child{display:flex;gap:.35rem;align-items:center}.modg-saas-columns{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.modg-saas-badge{display:inline-flex;padding:.2rem .48rem;border-radius:999px;background:#283640;color:#c6d1d8;font-size:.7rem;text-transform:capitalize}.modg-saas-badge--active,.modg-saas-badge--completed,.modg-saas-badge--enabled,.modg-saas-badge--resolved,.modg-saas-badge--low{background:#153b35;color:#85d9ca}.modg-saas-badge--trial,.modg-saas-badge--past_due,.modg-saas-badge--queued,.modg-saas-badge--review,.modg-saas-badge--monitoring,.modg-saas-badge--medium,.modg-saas-badge--soft,.modg-saas-badge--observe{background:#443a20;color:#efd47d}.modg-saas-badge--running,.modg-saas-badge--investigating{background:#183a51;color:#92cdf0}.modg-saas-badge--suspended,.modg-saas-badge--cancelled,.modg-saas-badge--failed,.modg-saas-badge--critical,.modg-saas-badge--high,.modg-saas-badge--revoked{background:#48242b;color:#ff9da7}.modg-saas-table{overflow:auto;margin-top:.8rem}.modg-saas-table:focus-visible{outline:3px solid #3b929c}.modg-saas table{width:100%;min-width:48rem;border-collapse:collapse}.modg-saas th,.modg-saas td{text-align:start;padding:.65rem;border-bottom:1px solid #283640}.modg-saas th{font-size:.72rem;color:#8295a1}.modg-saas td small{display:block;color:#758995}.modg-saas-empty,.modg-saas-state p{color:#879aa6}.modg-saas-state{padding:2rem;border:1px dashed #41515b;border-radius:.8rem;text-align:center}@media(max-width:1100px){.modg-saas-subscription{grid-template-columns:1fr}.modg-saas-subscription dl{grid-template-columns:repeat(2,1fr)}.modg-saas-meter-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:760px){.modg-saas>header{display:grid}.modg-saas header dl{overflow:auto}.modg-saas-columns,.modg-saas-meter-grid{grid-template-columns:1fr}.modg-saas-heading{align-items:start}.modg-saas-list li{align-items:start;flex-direction:column}.modg-saas-subscription dl{grid-template-columns:1fr 1fr}}[dir=rtl] .modg-saas{text-align:right}`;
