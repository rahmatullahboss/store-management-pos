export type StorefrontOperationsState =
  | "ready"
  | "loading"
  | "empty"
  | "error"
  | "denied";

export interface StorefrontOperationsSummary {
  readonly storefrontCount: number;
  readonly activeChannelCount: number;
  readonly publishedItemCount: number;
  readonly scheduledItemCount: number;
  readonly domainAttentionCount: number;
}

export interface StorefrontOperationsRow {
  readonly storefrontId: string;
  readonly displayName: string;
  readonly status: "draft" | "active" | "suspended" | "archived";
  readonly channelCount: number;
  readonly primaryDomain: string;
  readonly domainStatus:
    | "verification_pending"
    | "certificate_pending"
    | "active"
    | "suspended"
    | "failed";
  readonly locale: string;
  readonly currency: string;
  readonly updatedAtLabel: string;
}

export interface StorefrontPublicationQueueRow {
  readonly id: string;
  readonly kind:
    | "variant"
    | "category"
    | "collection"
    | "navigation"
    | "content_page"
    | "homepage";
  readonly label: string;
  readonly state:
    | "draft"
    | "scheduled"
    | "published"
    | "hidden"
    | "archived";
  readonly scopeLabel: string;
  readonly revisionLabel: string;
  readonly scheduledForLabel?: string;
  readonly updatedAtLabel: string;
}

export interface StorefrontOperationsPage {
  readonly state: StorefrontOperationsState;
  readonly tenantName: string;
  readonly observedAtLabel: string;
  readonly summary: StorefrontOperationsSummary;
  readonly storefronts: readonly StorefrontOperationsRow[];
  readonly publicationQueue: readonly StorefrontPublicationQueueRow[];
  readonly canManageStorefront: boolean;
  readonly canManagePublication: boolean;
  readonly canManageContent: boolean;
  readonly canManageDomains: boolean;
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

function badge(value: string): string {
  return `<span class="modh-badge modh-badge--${escapeHtml(value)}">${escapeHtml(
    value.replaceAll("_", " "),
  )}</span>`;
}

function renderState(page: StorefrontOperationsPage): string {
  if (page.state === "ready") return "";
  const heading =
    page.state === "denied"
      ? "Access restricted"
      : page.state === "error"
        ? "Storefront operations unavailable"
        : page.state === "empty"
          ? "No storefronts yet"
          : "Loading storefront operations";
  const message =
    page.message ??
    (page.state === "denied"
      ? "Your role cannot read storefront configuration or publication history."
      : page.state === "error"
        ? "Tenant-scoped storefront data could not be loaded. No publication or domain state was changed."
        : page.state === "empty"
          ? "Create a storefront and sales channel to begin publishing buyer-facing content."
          : "Loading storefront, domain and publication evidence…");
  return `<section class="modh-state" role="${
    page.state === "error" ? "alert" : "status"
  }"><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(message)}</p></section>`;
}

function renderStorefronts(page: StorefrontOperationsPage): string {
  return `<section class="modh-panel" aria-labelledby="modh-storefronts-title">
    <div class="modh-heading"><div><p>Tenant storefronts</p><h2 id="modh-storefronts-title">Storefront and domain health</h2></div><button type="button"${
      page.canManageStorefront ? "" : " disabled"
    }>New storefront</button></div>
    ${
      page.storefronts.length === 0
        ? '<p class="modh-empty">No storefront configuration is available.</p>'
        : `<div class="modh-table" tabindex="0" role="region" aria-label="Storefront and domain health table"><table><thead><tr><th>Storefront</th><th>Status</th><th>Channels</th><th>Primary domain</th><th>Locale</th><th>Updated</th></tr></thead><tbody>${page.storefronts
            .map(
              (row) =>
                `<tr><td><strong>${escapeHtml(row.displayName)}</strong><small>${escapeHtml(
                  row.storefrontId,
                )}</small></td><td>${badge(row.status)}</td><td>${row.channelCount}</td><td><strong>${escapeHtml(
                  row.primaryDomain,
                )}</strong><small>${badge(row.domainStatus)}</small></td><td>${escapeHtml(
                  row.locale,
                )}<small>${escapeHtml(row.currency)}</small></td><td>${escapeHtml(
                  row.updatedAtLabel,
                )}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
    }
  </section>`;
}

function renderPublicationQueue(page: StorefrontOperationsPage): string {
  return `<section class="modh-panel" aria-labelledby="modh-publication-title">
    <div class="modh-heading"><div><p>Publication control</p><h2 id="modh-publication-title">Content and catalog queue</h2></div><div class="modh-actions"><button type="button"${
      page.canManagePublication ? "" : " disabled"
    }>Manage catalog</button><button type="button"${
      page.canManageContent ? "" : " disabled"
    }>New content revision</button></div></div>
    ${
      page.publicationQueue.length === 0
        ? '<p class="modh-empty">No publication revisions require attention.</p>'
        : `<div class="modh-list">${page.publicationQueue
            .map(
              (row) =>
                `<article><div><div><p>${escapeHtml(row.kind.replaceAll("_", " "))}</p><h3>${escapeHtml(
                  row.label,
                )}</h3></div>${badge(row.state)}</div><dl><div><dt>Scope</dt><dd>${escapeHtml(
                  row.scopeLabel,
                )}</dd></div><div><dt>Revision</dt><dd>${escapeHtml(
                  row.revisionLabel,
                )}</dd></div><div><dt>Schedule</dt><dd>${escapeHtml(
                  row.scheduledForLabel ?? "Not scheduled",
                )}</dd></div><div><dt>Updated</dt><dd>${escapeHtml(
                  row.updatedAtLabel,
                )}</dd></div></dl></article>`,
            )
            .join("")}</div>`
    }
  </section>`;
}

export function renderStorefrontOperationsPage(
  page: StorefrontOperationsPage,
): string {
  const state = renderState(page);
  const summary = page.summary;
  return `<style>${STOREFRONT_OPERATIONS_STYLES}</style><main class="modh-page" data-state="${escapeHtml(
    page.state,
  )}"><header><div><p class="modh-eyebrow">Buyer storefront operations</p><h1>Storefront publishing</h1><p>${escapeHtml(
    page.tenantName,
  )} · Observed ${escapeHtml(
    page.observedAtLabel,
  )}</p></div><dl><div><dt>Storefronts</dt><dd>${summary.storefrontCount}</dd></div><div><dt>Active channels</dt><dd>${summary.activeChannelCount}</dd></div><div><dt>Published</dt><dd>${summary.publishedItemCount}</dd></div><div><dt>Scheduled</dt><dd>${summary.scheduledItemCount}</dd></div><div><dt>Domain attention</dt><dd>${summary.domainAttentionCount}</dd></div></dl></header>${
    state || `${renderStorefronts(page)}${renderPublicationQueue(page)}`
  }<footer><p>Price, tax, inventory, customer, order, payment and accounting authority remain in their owning modules.</p><button type="button"${
    page.canManageDomains ? "" : " disabled"
  }>Manage domains</button></footer></main>`;
}

export const STOREFRONT_OPERATIONS_STYLES = `
.modh-page{display:grid;gap:1rem;color:#e8edf2;background:#0b1217;padding:1rem;border-radius:1rem;min-width:0}.modh-page>header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem;padding:1.25rem;background:#121b22;border:1px solid #293742;border-radius:1rem}.modh-page h1,.modh-page h2,.modh-page h3{margin:.2rem 0;overflow-wrap:anywhere}.modh-page header p,.modh-page footer p{margin:.3rem 0;color:#a9b7c0}.modh-eyebrow,.modh-heading p,.modh-list article>div>div>p{color:#9ce5d6!important;text-transform:uppercase;letter-spacing:.1em;font-size:.72rem;margin:0}.modh-page header dl{display:grid;grid-template-columns:repeat(5,minmax(4.7rem,1fr));gap:.55rem;margin:0}.modh-page header dl div{padding:.65rem;background:#0d151a;border-radius:.6rem;text-align:center;min-width:0}.modh-page dt{font-size:.7rem;color:#9aabb6}.modh-page dd{margin:.2rem 0 0;overflow-wrap:anywhere}.modh-page header dd{font-size:1.2rem}.modh-panel{padding:1rem;background:#111a20;border:1px solid #293742;border-radius:.85rem;min-width:0}.modh-heading{display:flex;justify-content:space-between;gap:.75rem;align-items:end}.modh-actions,.modh-page>footer{display:flex;gap:.55rem;align-items:center}.modh-page button{border:0;border-radius:.55rem;background:#286e68;color:#fff;padding:.56rem .72rem}.modh-page button:focus-visible,.modh-table:focus-visible{outline:3px solid #65c9d0;outline-offset:2px}.modh-page button:disabled{opacity:.42}.modh-table{overflow:auto;margin-top:.8rem;max-width:100%}.modh-table table{width:100%;min-width:58rem;border-collapse:collapse}.modh-table th,.modh-table td{text-align:start;padding:.72rem;border-bottom:1px solid #293640}.modh-table th{font-size:.72rem;color:#a7b6c0;background:#131f26}.modh-table td{background:#111a20}.modh-table small{display:block;color:#91a3ae;margin-top:.25rem;overflow-wrap:anywhere}.modh-badge{display:inline-flex;padding:.2rem .5rem;border-radius:999px;background:#28353e;color:#e3eaee;font-size:.7rem;text-transform:capitalize}.modh-badge--active,.modh-badge--published{background:#153c35;color:#b6f4e7}.modh-badge--draft,.modh-badge--scheduled,.modh-badge--verification_pending,.modh-badge--certificate_pending{background:#453b1f;color:#ffe79a}.modh-badge--suspended,.modh-badge--failed,.modh-badge--archived,.modh-badge--hidden{background:#47242a;color:#ffc0c6}.modh-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;margin-top:.8rem}.modh-list article{padding:.85rem;border:1px solid #2a3842;border-radius:.7rem;background:#0d151a;min-width:0}.modh-list article>div{display:flex;justify-content:space-between;gap:.65rem}.modh-list dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem;margin:.75rem 0 0}.modh-list dl div{padding:.55rem;background:#131f26;border-radius:.5rem;min-width:0}.modh-empty,.modh-state p{color:#a9b7c0}.modh-state{padding:2rem;border:1px dashed #40505a;border-radius:.8rem;text-align:center}.modh-page>footer{justify-content:space-between;padding:.85rem 1rem;border:1px solid #293742;border-radius:.75rem;background:#111a20}@media(max-width:1100px){.modh-page>header{grid-template-columns:minmax(0,1fr)}.modh-page header dl{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:760px){.modh-heading,.modh-page>footer{align-items:start;flex-direction:column}.modh-actions{display:grid;width:100%;grid-template-columns:1fr}.modh-list{grid-template-columns:1fr}.modh-page header dl{grid-template-columns:repeat(2,minmax(0,1fr))}}[dir=rtl] .modh-page{text-align:right}
`;
