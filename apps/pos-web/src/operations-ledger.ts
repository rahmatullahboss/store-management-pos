import {
  renderLedgerEvidenceRail,
  renderLedgerSignalBand,
  renderLedgerState,
  renderLedgerStatus,
  type LedgerEvidenceItem,
  type LedgerSurfaceState,
  type LedgerTone,
} from "../../../packages/ui/src/operations-ledger.js";

export interface PosRegisterProductRow {
  readonly sku: string;
  readonly name: string;
  readonly unit: string;
  readonly available: string;
  readonly price: string;
  readonly currency: string;
  readonly status: "sellable" | "restricted" | "out_of_stock";
}

export interface PosCartLine {
  readonly lineId: string;
  readonly sku: string;
  readonly name: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly lineTotal: string;
}

export interface PosRegisterWorkspace {
  readonly state: LedgerSurfaceState;
  readonly registerLabel: string;
  readonly deviceLabel: string;
  readonly businessDateLabel: string;
  readonly syncLabel: string;
  readonly pendingOperations: number;
  readonly customerLabel?: string;
  readonly products: readonly PosRegisterProductRow[];
  readonly cart: readonly PosCartLine[];
  readonly subtotal: string;
  readonly discount: string;
  readonly tax: string;
  readonly total: string;
  readonly currency: string;
  readonly evidence: readonly LedgerEvidenceItem[];
  readonly canSell: boolean;
  readonly canDiscount: boolean;
  readonly message?: string;
}

export interface PosSyncOperationRow {
  readonly localOperationId: string;
  readonly kind: string;
  readonly createdAtLabel: string;
  readonly status: "queued" | "syncing" | "confirmed" | "conflict" | "failed";
  readonly serverReference?: string;
  readonly attempts: number;
}

export interface PosSyncWorkspace {
  readonly state: LedgerSurfaceState;
  readonly registerLabel: string;
  readonly businessDateLabel: string;
  readonly lastSyncLabel: string;
  readonly queued: number;
  readonly conflicts: number;
  readonly failed: number;
  readonly operations: readonly PosSyncOperationRow[];
  readonly evidence: readonly LedgerEvidenceItem[];
  readonly canRetry: boolean;
  readonly message?: string;
}

export interface PosDeviceHealthRow {
  readonly component: string;
  readonly identity: string;
  readonly status: "healthy" | "degraded" | "offline" | "attention";
  readonly observedAtLabel: string;
  readonly detail: string;
}

export interface PosDeviceWorkspace {
  readonly state: LedgerSurfaceState;
  readonly registerLabel: string;
  readonly deviceLabel: string;
  readonly appVersion: string;
  readonly lastHeartbeatLabel: string;
  readonly syncLabel: string;
  readonly components: readonly PosDeviceHealthRow[];
  readonly evidence: readonly LedgerEvidenceItem[];
  readonly canManageDevice: boolean;
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

function stateTone(state: LedgerSurfaceState): LedgerTone {
  if (state === "ready") return "success";
  if (state === "error" || state === "denied") return "danger";
  if (state === "offline" || state === "conflict") return "warning";
  return "neutral";
}

function operationalState(state: LedgerSurfaceState, message?: string): string {
  if (state === "ready") return "";
  const copy: Record<Exclude<LedgerSurfaceState, "ready">, readonly [string, string, string]> = {
    loading: ["Loading register state", "Register data is being restored. No sale has been posted.", "Retry"],
    empty: ["No operational records", "There is no activity in this scope yet.", "Refresh"],
    error: ["Register data unavailable", "Do not repeat a payment or stock action until current state is confirmed.", "Retry safely"],
    denied: ["Permission required", "Your role cannot perform this register operation.", "Review access"],
    offline: ["Offline operating mode", "Permitted actions remain local and visibly queued until server confirmation.", "Open sync queue"],
    conflict: ["Sync conflict requires review", "Local and server evidence disagree. Resolve the conflict before treating this operation as posted.", "Review conflict"],
  };
  const [title, detail, actionLabel] = copy[state];
  return renderLedgerState({ state, title, detail: message ?? detail, actionLabel });
}

function statusForProduct(status: PosRegisterProductRow["status"]): string {
  if (status === "sellable") return renderLedgerStatus("Sellable", "success");
  if (status === "restricted") return renderLedgerStatus("Restricted", "warning");
  return renderLedgerStatus("Out of stock", "danger");
}

function syncOperationTone(status: PosSyncOperationRow["status"]): LedgerTone {
  if (status === "confirmed") return "success";
  if (status === "conflict" || status === "failed") return "danger";
  if (status === "queued" || status === "syncing") return "warning";
  return "neutral";
}

function deviceTone(status: PosDeviceHealthRow["status"]): LedgerTone {
  if (status === "healthy") return "success";
  if (status === "offline") return "danger";
  return "warning";
}

export function renderPosRegisterWorkspace(page: PosRegisterWorkspace): string {
  const cartCount = page.cart.length;
  const blocked = !page.canSell || page.state === "denied" || page.state === "error" || page.state === "conflict";
  return `<section class="pos-ledger" data-pos-surface="register" data-state="${escapeHtml(page.state)}">
    <header class="pos-heading"><div><p class="ledger-eyebrow">Register operations</p><h1>POS Register</h1><p>${escapeHtml(page.registerLabel)} · ${escapeHtml(page.deviceLabel)} · ${escapeHtml(page.businessDateLabel)}</p></div><div class="pos-heading__state">${renderLedgerStatus(page.syncLabel, stateTone(page.state))}${renderLedgerStatus(`${page.pendingOperations} queued`, page.pendingOperations > 0 ? "warning" : "success")}</div></header>
    ${renderLedgerSignalBand(page.state === "offline" ? "Selling with bounded offline authority" : "Register ready for controlled checkout", page.state === "offline" ? "Local operations remain distinct from server-confirmed posting." : "Payment confirmation remains the authority boundary for stock and ledger effects.", [
      { label: "Cart lines", value: String(cartCount) },
      { label: "Customer", value: page.customerLabel ?? "Walk-in" },
      { label: "Total", value: `${page.currency} ${page.total}` },
    ])}
    ${operationalState(page.state, page.message)}
    <div class="checkout-layout">
      <section class="product-workspace" aria-labelledby="pos-products-title">
        <div class="scan-panel"><label for="pos-scan">Scan barcode or search product</label><div class="scan-input"><span aria-hidden="true">⌁</span><input id="pos-scan" type="search" autocomplete="off" placeholder="Barcode, SKU or product name"><kbd>F2</kbd></div><div class="filter-row" aria-label="Product filters"><button type="button" class="filter-chip filter-chip--active">Available</button><button type="button" class="filter-chip">Recent</button><button type="button" class="filter-chip">Favorites</button></div></div>
        <div class="section-heading"><div><h2 id="pos-products-title">Sellable product ledger</h2><p>Availability and price are explicit before a line enters the cart.</p></div><span>${page.products.length} rows</span></div>
        <div class="table-wrap" tabindex="0" role="region" aria-label="POS product results"><table><thead><tr><th scope="col">SKU / product</th><th scope="col">Unit</th><th scope="col">Available</th><th scope="col">Status</th><th scope="col">Price</th><th scope="col">Action</th></tr></thead><tbody>${page.products.length === 0 ? '<tr><td colspan="6">No products match the current register scope.</td></tr>' : page.products.map((product) => `<tr><td><strong>${escapeHtml(product.name)}</strong><span class="cell-detail">${escapeHtml(product.sku)}</span></td><td>${escapeHtml(product.unit)}</td><td data-numeric>${escapeHtml(product.available)}</td><td>${statusForProduct(product.status)}</td><td data-numeric><strong>${escapeHtml(product.currency)} ${escapeHtml(product.price)}</strong></td><td><button type="button" class="row-action"${blocked || product.status !== "sellable" ? " disabled" : ""}>Add</button></td></tr>`).join("")}</tbody></table></div>
      </section>
      <aside class="cart-panel" aria-labelledby="pos-cart-title"><div class="cart-panel__header"><div><h2 id="pos-cart-title">Current sale</h2><p>${escapeHtml(page.customerLabel ?? "Walk-in customer")}</p></div>${renderLedgerStatus(`${cartCount} lines`, "neutral")}</div><ul class="cart-lines">${page.cart.length === 0 ? '<li><div><strong>Cart is empty</strong><span>Scan or select a sellable product.</span></div></li>' : page.cart.map((line) => `<li><div><strong>${escapeHtml(line.name)}</strong><span>${escapeHtml(line.sku)} · ${escapeHtml(line.quantity)} × ${escapeHtml(line.unitPrice)}</span></div><strong data-numeric>${escapeHtml(page.currency)} ${escapeHtml(line.lineTotal)}</strong></li>`).join("")}</ul><dl class="sale-totals"><div><dt>Subtotal</dt><dd>${escapeHtml(page.currency)} ${escapeHtml(page.subtotal)}</dd></div><div><dt>Discount</dt><dd>${escapeHtml(page.currency)} ${escapeHtml(page.discount)}</dd></div><div><dt>Tax</dt><dd>${escapeHtml(page.currency)} ${escapeHtml(page.tax)}</dd></div><div class="sale-totals__total"><dt>Total</dt><dd>${escapeHtml(page.currency)} ${escapeHtml(page.total)}</dd></div></dl><div class="checkout-actions"><button type="button" class="button button--secondary"${!page.canDiscount ? " disabled" : ""}>Discount</button><button type="button" class="button button--pay"${blocked || cartCount === 0 ? " disabled" : ""}><span>Take payment</span><strong>${escapeHtml(page.currency)} ${escapeHtml(page.total)}</strong></button></div><p class="cart-assurance"><span aria-hidden="true">✓</span>Stock, cash and accounting effects post only after payment confirmation.</p></aside>
    </div>
    <div class="pos-ledger__evidence">${renderLedgerEvidenceRail("Sale provenance", page.evidence)}</div>
  </section>${POS_LEDGER_STYLES}`;
}

export function renderPosSyncWorkspace(page: PosSyncWorkspace): string {
  return `<section class="pos-ledger" data-pos-surface="sync" data-state="${escapeHtml(page.state)}"><header class="pos-heading"><div><p class="ledger-eyebrow">Offline operations</p><h1>Sync &amp; Offline Operations</h1><p>${escapeHtml(page.registerLabel)} · ${escapeHtml(page.businessDateLabel)}</p></div><div class="pos-heading__state">${renderLedgerStatus(page.lastSyncLabel, page.state === "offline" ? "warning" : "success")}</div></header>${renderLedgerSignalBand(page.conflicts > 0 ? "Conflicts block blind replay" : page.queued > 0 ? "Queued operations await confirmation" : "Local queue reconciled", "Offline and server-confirmed states remain deliberately distinct.", [{ label: "Queued", value: String(page.queued) }, { label: "Conflicts", value: String(page.conflicts) }, { label: "Failed", value: String(page.failed) }])}${operationalState(page.state, page.message)}<div class="operations-layout"><section class="work-queue" aria-labelledby="sync-ledger-title"><div class="section-heading"><div><h2 id="sync-ledger-title">Local operation ledger</h2><p>Idempotent operation IDs, attempts and server references are retained.</p></div><button type="button" class="button button--secondary"${!page.canRetry ? " disabled" : ""}>Retry eligible</button></div><div class="table-wrap" tabindex="0" role="region" aria-label="Offline operation queue"><table><thead><tr><th scope="col">Local operation</th><th scope="col">Type</th><th scope="col">Created</th><th scope="col">State</th><th scope="col">Attempts</th><th scope="col">Server reference</th></tr></thead><tbody>${page.operations.length === 0 ? '<tr><td colspan="6">No local operations are waiting for synchronization.</td></tr>' : page.operations.map((row) => `<tr><td><strong>${escapeHtml(row.localOperationId)}</strong></td><td>${escapeHtml(row.kind)}</td><td>${escapeHtml(row.createdAtLabel)}</td><td>${renderLedgerStatus(row.status, syncOperationTone(row.status))}</td><td data-numeric>${row.attempts}</td><td>${escapeHtml(row.serverReference ?? "Not confirmed")}</td></tr>`).join("")}</tbody></table></div></section>${renderLedgerEvidenceRail("Sync provenance", page.evidence)}</div></section>${POS_LEDGER_STYLES}`;
}

export function renderPosDeviceWorkspace(page: PosDeviceWorkspace): string {
  const unhealthy = page.components.filter((item) => item.status !== "healthy").length;
  return `<section class="pos-ledger" data-pos-surface="device" data-state="${escapeHtml(page.state)}"><header class="pos-heading"><div><p class="ledger-eyebrow">Register diagnostics</p><h1>Register &amp; Device Diagnostics</h1><p>${escapeHtml(page.registerLabel)} · ${escapeHtml(page.deviceLabel)} · App ${escapeHtml(page.appVersion)}</p></div><div class="pos-heading__state">${renderLedgerStatus(page.syncLabel, unhealthy > 0 ? "warning" : "success")}</div></header>${renderLedgerSignalBand(unhealthy > 0 ? "Device attention required before the next shift" : "Register device is operational", "Hardware and connectivity evidence is captured separately from transaction state.", [{ label: "Attention", value: String(unhealthy) }, { label: "Components", value: String(page.components.length) }, { label: "Heartbeat", value: page.lastHeartbeatLabel }])}${operationalState(page.state, page.message)}<div class="operations-layout"><section class="work-queue" aria-labelledby="device-health-title"><div class="section-heading"><div><h2 id="device-health-title">Device health ledger</h2><p>Scanner, printer, drawer, payment terminal and application state.</p></div><button type="button" class="button button--secondary"${!page.canManageDevice ? " disabled" : ""}>Run diagnostics</button></div><div class="table-wrap" tabindex="0" role="region" aria-label="Device component health"><table><thead><tr><th scope="col">Component</th><th scope="col">Identity</th><th scope="col">Status</th><th scope="col">Observed</th><th scope="col">Evidence</th></tr></thead><tbody>${page.components.length === 0 ? '<tr><td colspan="5">No registered hardware components were reported.</td></tr>' : page.components.map((row) => `<tr><td><strong>${escapeHtml(row.component)}</strong></td><td>${escapeHtml(row.identity)}</td><td>${renderLedgerStatus(row.status, deviceTone(row.status))}</td><td>${escapeHtml(row.observedAtLabel)}</td><td>${escapeHtml(row.detail)}</td></tr>`).join("")}</tbody></table></div></section>${renderLedgerEvidenceRail("Device provenance", page.evidence)}</div></section>${POS_LEDGER_STYLES}`;
}

export const POS_LEDGER_STYLES = `<style data-pos-ledger-styles>
.pos-ledger{display:grid;gap:1.2rem}.ledger-eyebrow{margin:0 0 .3rem;color:var(--accent-strong);font-size:.72rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.pos-ledger .pos-heading{margin-block-end:0}.pos-ledger .signal-band{margin-block-end:0}.pos-ledger .signal-band__facts span{display:block;margin-block-start:.15rem;color:#bed0c7;font-size:.68rem}.pos-ledger .work-queue{border:1px solid var(--line);box-shadow:none}.pos-ledger .product-workspace,.pos-ledger .cart-panel,.pos-ledger .trace-panel{border:1px solid var(--line);box-shadow:none}.pos-ledger .table-wrap table{min-inline-size:48rem}.pos-ledger .row-action:disabled{color:var(--muted);cursor:not-allowed;text-decoration:none}.pos-ledger__evidence{max-inline-size:34rem}.pos-ledger .ledger-evidence{inline-size:100%}@media(max-width:1080px){.pos-ledger__evidence{max-inline-size:none}.pos-ledger .operations-layout .trace-panel{order:0}}@media(max-width:620px){.pos-ledger .table-wrap{max-inline-size:calc(100vw - 2rem)}}
</style>`;
