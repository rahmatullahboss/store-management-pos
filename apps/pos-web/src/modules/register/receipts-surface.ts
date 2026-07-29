export type ReceiptWorkspaceState = "idle" | "loading" | "ready" | "not_found" | "error";

export interface ReceiptWorkspaceReceipt {
  readonly id: string;
  readonly receiptNumber: string;
  readonly businessDate: string;
  readonly currency: string;
  readonly scale: number;
  readonly totalMinor: bigint;
  readonly renderStatus: "pending" | "rendered" | "failed";
  readonly contentHash: string;
  readonly createdAt: string;
}

export interface ReceiptWorkspaceModel {
  readonly state: ReceiptWorkspaceState;
  readonly locale: string;
  readonly online: boolean;
  readonly query: string;
  readonly receipt?: ReceiptWorkspaceReceipt;
  readonly canReprint: boolean;
  readonly canDeliver: boolean;
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

function money(value: bigint, currency: string, scale: number, locale: string): string {
  if (!Number.isSafeInteger(Number(value))) return `${currency} ${value.toString()} × 10^-${scale}`;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(value) / 10 ** scale);
}

function stateNotice(model: ReceiptWorkspaceModel): string {
  if (model.state === "ready" || model.state === "idle") return "";
  const fallback: Record<Exclude<ReceiptWorkspaceState, "ready" | "idle">, string> = {
    loading: "Looking up the immutable receipt snapshot.",
    not_found: "No receipt matched that number or receipt ID.",
    error: "Receipt lookup could not be completed. Do not create a replacement sale.",
  };
  const role = model.state === "loading" ? "status" : "alert";
  return `<section class="modd-receipt-notice" role="${role}" aria-live="polite"${model.state === "loading" ? ' aria-busy="true"' : ""}>${escapeHtml(model.message ?? fallback[model.state])}</section>`;
}

export function renderReceiptWorkspace(model: ReceiptWorkspaceModel): string {
  const receipt = model.receipt;
  const details = model.state === "ready" && receipt
    ? `<article class="modd-receipt-card" aria-labelledby="modd-receipt-title">
        <header><div><p>Immutable receipt snapshot</p><h2 id="modd-receipt-title">${escapeHtml(receipt.receiptNumber)}</h2></div><span>${escapeHtml(receipt.renderStatus)}</span></header>
        <dl>
          <div><dt>Business date</dt><dd>${escapeHtml(receipt.businessDate)}</dd></div>
          <div><dt>Created</dt><dd>${escapeHtml(new Intl.DateTimeFormat(model.locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(receipt.createdAt)))}</dd></div>
          <div><dt>Total</dt><dd>${escapeHtml(money(receipt.totalMinor, receipt.currency, receipt.scale, model.locale))}</dd></div>
          <div><dt>Integrity</dt><dd><code>${escapeHtml(receipt.contentHash.slice(0, 16))}…</code></dd></div>
        </dl>
        <section class="modd-receipt-actions" aria-labelledby="modd-receipt-actions-title">
          <h3 id="modd-receipt-actions-title">Deliver a copy</h3>
          <p>Every print, email or SMS request is recorded separately. The original receipt never changes.</p>
          <div>
            <button type="button" data-receipt-action="print" data-receipt-id="${escapeHtml(receipt.id)}"${model.canReprint ? "" : " disabled"}>Print copy</button>
            <button type="button" data-receipt-action="email" data-receipt-id="${escapeHtml(receipt.id)}"${model.canDeliver && model.online ? "" : " disabled"}>Email copy</button>
            <button type="button" data-receipt-action="sms" data-receipt-id="${escapeHtml(receipt.id)}"${model.canDeliver && model.online ? "" : " disabled"}>SMS copy</button>
          </div>
          ${model.online ? "" : '<p class="modd-receipt-offline" role="status">Offline: local print remains available when permitted; email and SMS wait for reconnection.</p>'}
        </section>
      </article>`
    : `<section class="modd-receipt-empty"><h2>Find a receipt</h2><p>Use the exact receipt number or receipt ID. Searching never changes financial records.</p></section>`;

  return `<style>${MOD_D_RECEIPT_STYLES}</style>
  <main class="modd-receipts" data-state="${model.state}" data-online="${String(model.online)}">
    <header><div><p>Point of sale</p><h1>Receipts</h1></div><span>${model.online ? "Online" : "Offline"}</span></header>
    <form class="modd-receipt-search" role="search" action="#" method="get">
      <label for="modd-receipt-query">Receipt number or receipt ID</label>
      <div><input id="modd-receipt-query" name="receipt" type="search" autocomplete="off" value="${escapeHtml(model.query)}" placeholder="R-20260729-0001"><button type="submit">Find receipt</button></div>
    </form>
    ${stateNotice(model)}
    ${details}
  </main>`;
}

export const MOD_D_RECEIPT_STYLES = `
.modd-receipts{--ink:#17231e;--muted:#5b665f;--paper:#f5f3ec;--panel:#fffefa;--line:#d7ddd8;--deep:#14251e;color:var(--ink);background:var(--paper);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100%;padding:20px;line-height:1.45}.modd-receipts *{box-sizing:border-box}.modd-receipts>header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-block-end:16px}.modd-receipts h1{font-size:clamp(1.8rem,3vw,2.5rem);line-height:1;margin:3px 0}.modd-receipts header p{margin:0;color:var(--muted);font-size:.78rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.modd-receipts>header>span{border:1px solid currentColor;padding:5px 9px;font-weight:800}.modd-receipt-search{background:#e9e4d8;padding:14px;margin-block-end:14px}.modd-receipt-search label{display:block;font-weight:800;margin-block-end:7px}.modd-receipt-search>div{display:grid;grid-template-columns:1fr auto;gap:8px}.modd-receipt-search input{min-height:48px;border:1px solid #928f86;background:var(--panel);padding:10px 12px;font:inherit}.modd-receipt-search button,.modd-receipt-actions button{min-height:46px;border:0;background:var(--deep);color:white;font:inherit;font-weight:800;padding:10px 16px}.modd-receipts button:disabled{cursor:not-allowed;opacity:.45}.modd-receipts :focus-visible{outline:3px solid #276e8f;outline-offset:2px}.modd-receipt-notice{border:1px solid #a36b28;background:#fff8e8;padding:13px 15px;margin-block-end:14px}.modd-receipt-card,.modd-receipt-empty{background:var(--panel);border:1px solid var(--line);box-shadow:0 4px 14px rgba(23,35,30,.1);padding:18px}.modd-receipt-card>header{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line);padding-block-end:14px}.modd-receipt-card h2{margin:3px 0 0}.modd-receipt-card>header>span{font-weight:800;text-transform:capitalize}.modd-receipt-card dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);margin:16px 0}.modd-receipt-card dl>div{background:var(--panel);padding:13px}.modd-receipt-card dt{color:var(--muted);font-size:.78rem;font-weight:800;text-transform:uppercase}.modd-receipt-card dd{margin:4px 0 0;font-weight:800}.modd-receipt-card code{overflow-wrap:anywhere}.modd-receipt-actions{border-top:2px solid var(--deep);padding-block-start:16px}.modd-receipt-actions h3{margin:0}.modd-receipt-actions>p{color:var(--muted)}.modd-receipt-actions>div{display:flex;flex-wrap:wrap;gap:8px}.modd-receipt-offline{border:1px solid #a36b28;padding:10px 12px;color:var(--ink)!important}.modd-receipt-empty{text-align:center;padding-block:46px}.modd-receipt-empty h2{margin:0}.modd-receipt-empty p{color:var(--muted)}@media(max-width:560px){.modd-receipts{padding:12px}.modd-receipt-search>div{grid-template-columns:1fr}.modd-receipt-card dl{grid-template-columns:1fr}.modd-receipt-actions>div{display:grid}.modd-receipts>header{display:grid}}
`;
