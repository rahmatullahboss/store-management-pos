export type IntegrationConsoleState = "ready" | "loading" | "empty" | "error" | "denied";

export interface IntegrationConnectionRow {
  readonly connectionId: string;
  readonly displayName: string;
  readonly connectorType: string;
  readonly provider: string;
  readonly status: "draft" | "active" | "degraded" | "paused" | "revoked";
  readonly credentialLabel: string;
  readonly resourceTypes: readonly string[];
  readonly cursorLabel: string;
  readonly lastHealthyLabel?: string;
  readonly conflictCount: number;
}

export interface WebhookHealthRow {
  readonly subscriptionId: string;
  readonly endpointLabel: string;
  readonly eventTypes: readonly string[];
  readonly status: "active" | "paused" | "revoked";
  readonly queued: number;
  readonly retrying: number;
  readonly deadLetter: number;
  readonly lastDeliveryLabel?: string;
}

export interface IntegrationConsolePage {
  readonly state: IntegrationConsoleState;
  readonly tenantName: string;
  readonly observedAtLabel: string;
  readonly connections: readonly IntegrationConnectionRow[];
  readonly webhooks: readonly WebhookHealthRow[];
  readonly canManage: boolean;
  readonly canReplay: boolean;
  readonly message?: string;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function badge(value: string): string {
  return `<span class="modg-int-badge modg-int-badge--${escapeHtml(value)}">${escapeHtml(value)}</span>`;
}

function renderState(page: IntegrationConsolePage): string {
  if (page.state === "ready") return "";
  const heading = page.state === "denied" ? "Access restricted" : page.state === "error" ? "Integration health unavailable" : page.state === "empty" ? "No connections yet" : "Loading integration health";
  const message = page.message ?? (page.state === "denied" ? "Your role cannot read integration configuration." : page.state === "error" ? "Provider health could not be loaded. Stored cursors and outcomes were not changed." : page.state === "empty" ? "Create a connector or webhook subscription to begin." : "Loading tenant-scoped connector and webhook evidence…");
  return `<section class="modg-int-state" role="${page.state === "error" ? "alert" : "status"}"><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(message)}</p></section>`;
}

function renderConnections(page: IntegrationConsolePage): string {
  return `<section class="modg-int-panel" aria-labelledby="modg-connections-title"><div class="modg-int-heading"><div><p>Connector framework</p><h2 id="modg-connections-title">Connections</h2></div><button type="button"${page.canManage ? "" : " disabled"}>New connection</button></div>
  ${page.connections.length === 0 ? '<p class="modg-int-empty">No connector connections are configured.</p>' : `<div class="modg-int-table" tabindex="0" role="region" aria-label="Connector connections table"><table><thead><tr><th>Connection</th><th>Provider</th><th>Resources</th><th>Health</th><th>Cursor</th><th>Conflicts</th></tr></thead><tbody>${page.connections.map((row) => `<tr><td><strong>${escapeHtml(row.displayName)}</strong><small>${escapeHtml(row.connectionId)} · ${escapeHtml(row.credentialLabel)}</small></td><td>${escapeHtml(row.provider)}<small>${escapeHtml(row.connectorType)}</small></td><td>${escapeHtml(row.resourceTypes.join(", ") || "None")}</td><td>${badge(row.status)}<small>${escapeHtml(row.lastHealthyLabel ?? "Never healthy")}</small></td><td>${escapeHtml(row.cursorLabel)}</td><td>${row.conflictCount === 0 ? badge("clear") : badge("review")} <span>${row.conflictCount}</span></td></tr>`).join("")}</tbody></table></div>`}
  </section>`;
}

function renderWebhooks(page: IntegrationConsolePage): string {
  return `<section class="modg-int-panel" aria-labelledby="modg-webhooks-title"><div class="modg-int-heading"><div><p>Signed delivery</p><h2 id="modg-webhooks-title">Webhooks and DLQ</h2></div><button type="button"${page.canManage ? "" : " disabled"}>New webhook</button></div>
  ${page.webhooks.length === 0 ? '<p class="modg-int-empty">No webhook subscriptions are configured.</p>' : `<div class="modg-int-cards">${page.webhooks.map((row) => `<article><div><strong>${escapeHtml(row.endpointLabel)}</strong>${badge(row.status)}</div><p>${escapeHtml(row.eventTypes.join(", "))}</p><dl><div><dt>Queued</dt><dd>${row.queued}</dd></div><div><dt>Retrying</dt><dd>${row.retrying}</dd></div><div><dt>Dead letter</dt><dd>${row.deadLetter}</dd></div></dl><footer><span>${escapeHtml(row.lastDeliveryLabel ?? "No delivery yet")}</span><button type="button"${page.canReplay && row.deadLetter > 0 ? "" : " disabled"}>Open replay queue</button></footer></article>`).join("")}</div>`}
  </section>`;
}

export function renderIntegrationConsolePage(page: IntegrationConsolePage): string {
  const state = renderState(page);
  const active = page.connections.filter((row) => row.status === "active").length;
  const degraded = page.connections.filter((row) => row.status === "degraded").length;
  const deadLetter = page.webhooks.reduce((total, row) => total + row.deadLetter, 0);
  return `<style>${INTEGRATION_CONSOLE_STYLES}</style><main class="modg-int" data-state="${escapeHtml(page.state)}"><header><div><p class="modg-int-eyebrow">Provider-neutral operations</p><h1>Integration health</h1><p>${escapeHtml(page.tenantName)} · Observed ${escapeHtml(page.observedAtLabel)}</p></div><dl><div><dt>Active</dt><dd>${active}</dd></div><div><dt>Degraded</dt><dd>${degraded}</dd></div><div><dt>DLQ</dt><dd>${deadLetter}</dd></div></dl></header>${state || `${renderConnections(page)}${renderWebhooks(page)}`}</main>`;
}

export const INTEGRATION_CONSOLE_STYLES = `
.modg-int{display:grid;gap:1rem;color:#e8edf2}.modg-int>header{display:flex;justify-content:space-between;gap:1rem;padding:1.4rem;background:#121b22;border:1px solid #293742;border-radius:1rem}.modg-int h1,.modg-int h2{margin:.2rem 0}.modg-int header p{margin:.3rem 0;color:#91a4b0}.modg-int-eyebrow,.modg-int-heading p{color:#78c8bd!important;text-transform:uppercase;letter-spacing:.12em;font-size:.72rem;margin:0}.modg-int header dl{display:flex;gap:.65rem;margin:0}.modg-int header dl div{min-width:5rem;padding:.65rem;background:#0d151a;border-radius:.6rem;text-align:center}.modg-int dt{font-size:.7rem;color:#8396a2}.modg-int dd{margin:.2rem 0 0;font-size:1.25rem}.modg-int-panel{padding:1rem;background:#111a20;border:1px solid #293742;border-radius:.85rem}.modg-int-heading{display:flex;justify-content:space-between;align-items:end}.modg-int button{border:0;border-radius:.55rem;background:#286e68;color:#fff;padding:.56rem .72rem}.modg-int button:disabled{opacity:.4}.modg-int-table{overflow:auto;margin-top:.8rem}.modg-int-table:focus-visible{outline:3px solid #398f99}.modg-int table{width:100%;min-width:58rem;border-collapse:collapse}.modg-int th,.modg-int td{text-align:start;padding:.7rem;border-bottom:1px solid #293640}.modg-int th{font-size:.72rem;color:#8396a2}.modg-int td small{display:block;color:#778b97;margin-top:.25rem}.modg-int-badge{display:inline-flex;padding:.2rem .5rem;border-radius:999px;background:#28353e;color:#cad4db;font-size:.7rem;text-transform:capitalize}.modg-int-badge--active,.modg-int-badge--clear{background:#153c35;color:#86dacb}.modg-int-badge--degraded,.modg-int-badge--review,.modg-int-badge--paused{background:#453b1f;color:#efd47b}.modg-int-badge--revoked{background:#47242a;color:#ff9ca6}.modg-int-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;margin-top:.8rem}.modg-int-cards article{padding:.85rem;border:1px solid #2a3842;border-radius:.7rem;background:#0d151a}.modg-int-cards article>div,.modg-int-cards footer{display:flex;justify-content:space-between;gap:.6rem}.modg-int-cards p{color:#8fa1ad}.modg-int-cards dl{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem}.modg-int-cards dl div{padding:.55rem;background:#131f26;border-radius:.5rem}.modg-int-cards footer{align-items:center;color:#8194a0;font-size:.78rem}.modg-int-empty,.modg-int-state p{color:#8fa1ad}.modg-int-state{padding:2rem;border:1px dashed #40505a;border-radius:.8rem;text-align:center}@media(max-width:850px){.modg-int>header{display:grid}.modg-int header dl{overflow:auto}.modg-int-cards{grid-template-columns:1fr}.modg-int-heading{align-items:start}}[dir=rtl] .modg-int{text-align:right}`;
