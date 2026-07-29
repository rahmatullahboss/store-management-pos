export type RegisterWorkspaceState = "ready" | "loading" | "empty" | "error" | "denied" | "conflict";
export type RegisterTenderKind = "cash" | "external_card" | "stored_value";

export interface RegisterCartLineView {
  readonly lineId: string;
  readonly name: string;
  readonly variant: string;
  readonly quantity: string;
  readonly lineTotalMinor: bigint;
  readonly warning?: string;
}

export interface RegisterTenderView {
  readonly tenderId: string;
  readonly kind: RegisterTenderKind;
  readonly label: string;
  readonly amountMinor: bigint;
  readonly state: "accepted" | "captured" | "authorized" | "unknown" | "declined";
}

export interface RegisterWorkspaceModel {
  readonly state?: RegisterWorkspaceState;
  readonly locale: string;
  readonly currency: string;
  readonly scale: number;
  readonly online: boolean;
  readonly pendingOperations: number;
  readonly registerLabel: string;
  readonly shiftStatus: "not_open" | "open" | "closing" | "closed";
  readonly cashierName: string;
  readonly cartReference: string;
  readonly lines: readonly RegisterCartLineView[];
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly taxMinor: bigint;
  readonly payableMinor: bigint;
  readonly tenders: readonly RegisterTenderView[];
  readonly canCheckout: boolean;
  readonly checkoutBlockReason?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(amountMinor: bigint, currency: string, scale: number, locale: string): string {
  const divisor = 10 ** scale;
  const safeAmount = Number(amountMinor) / divisor;
  if (!Number.isSafeInteger(Number(amountMinor))) return `${currency} ${amountMinor.toString()} × 10^-${scale}`;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(safeAmount);
}

function statePanel(state: RegisterWorkspaceState): string {
  if (state === "ready") return "";
  const copy: Record<Exclude<RegisterWorkspaceState, "ready">, readonly [string, string]> = {
    loading: ["Loading register", "Confirmed local operations remain durable while the workspace starts."],
    empty: ["Cart is empty", "Scan a barcode, search the catalog or resume a suspended cart."],
    error: ["Register could not refresh", "Do not repeat a completed payment. Check sync and provider status first."],
    denied: ["Register permission required", "A manager must grant the narrow checkout permission for this register."],
    conflict: ["Operation needs review", "The local receipt remains unchanged until an explicit resolution is recorded."],
  };
  const [title, detail] = copy[state];
  const role = state === "error" || state === "denied" || state === "conflict" ? "alert" : "status";
  return `<section class="modd-state modd-state--${state}" role="${role}" aria-live="polite"${state === "loading" ? ' aria-busy="true"' : ""}>
    <strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>
  </section>`;
}

function tenderTone(state: RegisterTenderView["state"]): "ok" | "warn" | "danger" | "neutral" {
  if (state === "accepted" || state === "captured") return "ok";
  if (state === "authorized" || state === "unknown") return "warn";
  if (state === "declined") return "danger";
  return "neutral";
}

export function renderRegisterWorkspace(model: RegisterWorkspaceModel): string {
  const state = model.state ?? "ready";
  const lineRows = model.lines.length === 0
    ? `<tr><td colspan="5" class="modd-empty-cell">No items in this cart.</td></tr>`
    : model.lines.map((line) => `<tr data-line-id="${escapeHtml(line.lineId)}">
        <td><strong>${escapeHtml(line.name)}</strong><span>${escapeHtml(line.variant)}</span>${line.warning ? `<small role="alert">${escapeHtml(line.warning)}</small>` : ""}</td>
        <td><button type="button" class="modd-icon-button" aria-label="Decrease ${escapeHtml(line.name)} quantity">−</button></td>
        <td><output aria-label="${escapeHtml(line.name)} quantity">${escapeHtml(line.quantity)}</output></td>
        <td><button type="button" class="modd-icon-button" aria-label="Increase ${escapeHtml(line.name)} quantity">+</button></td>
        <td class="modd-money">${escapeHtml(formatMoney(line.lineTotalMinor, model.currency, model.scale, model.locale))}</td>
      </tr>`).join("");

  const tenderRows = model.tenders.length === 0
    ? `<li class="modd-empty-tender">No tender selected.</li>`
    : model.tenders.map((tender) => `<li>
        <span><strong>${escapeHtml(tender.label)}</strong><small>${escapeHtml(tender.kind.replaceAll("_", " "))}</small></span>
        <span class="modd-tender-state modd-tender-state--${tenderTone(tender.state)}">${escapeHtml(tender.state)}</span>
        <span class="modd-money">${escapeHtml(formatMoney(tender.amountMinor, model.currency, model.scale, model.locale))}</span>
      </li>`).join("");

  const connection = model.online
    ? `<span class="modd-connection modd-connection--online">Online</span>`
    : `<span class="modd-connection modd-connection--offline">Offline · ${model.pendingOperations} queued</span>`;
  const offlineNotice = model.online ? "" : `<section class="modd-offline" role="status" aria-live="polite">
      <strong>Approved offline window</strong>
      <span>Local success is shown only after the operation is committed. Unsupported payment and country actions remain blocked.</span>
    </section>`;
  const blockReason = model.canCheckout ? "" : `<p class="modd-block" role="alert">${escapeHtml(model.checkoutBlockReason ?? "Checkout requirements are incomplete.")}</p>`;

  return `<style>${MOD_D_REGISTER_STYLES}</style>
  <main class="modd-register" data-state="${state}" data-online="${String(model.online)}">
    <header class="modd-register__header">
      <div><p class="modd-eyebrow">${escapeHtml(model.registerLabel)} · ${escapeHtml(model.cashierName)}</p><h1>Checkout</h1><p>Cart ${escapeHtml(model.cartReference)}</p></div>
      <div class="modd-register__status">${connection}<span>Shift: ${escapeHtml(model.shiftStatus.replaceAll("_", " "))}</span></div>
    </header>
    ${offlineNotice}
    ${statePanel(state)}
    <form class="modd-command" role="search" action="#" method="get">
      <label for="modd-product-search">Scan barcode or find a product</label>
      <div><input id="modd-product-search" name="query" type="search" autocomplete="off" inputmode="search" placeholder="Barcode, SKU or product name"><button type="submit">Add item</button></div>
    </form>
    <div class="modd-workspace">
      <section class="modd-cart" aria-labelledby="modd-cart-title">
        <header><div><h2 id="modd-cart-title">Current cart</h2><p>${model.lines.length} line${model.lines.length === 1 ? "" : "s"}</p></div><button type="button" class="modd-secondary">Suspend cart</button></header>
        <div class="modd-table-wrap"><table><thead><tr><th scope="col">Item</th><th scope="col" colspan="3">Quantity</th><th scope="col">Total</th></tr></thead><tbody>${lineRows}</tbody></table></div>
      </section>
      <aside class="modd-checkout" aria-labelledby="modd-summary-title">
        <header><h2 id="modd-summary-title">Payment summary</h2><span>${escapeHtml(model.currency)}</span></header>
        <dl class="modd-totals">
          <div><dt>Subtotal</dt><dd>${escapeHtml(formatMoney(model.subtotalMinor, model.currency, model.scale, model.locale))}</dd></div>
          <div><dt>Discount</dt><dd>−${escapeHtml(formatMoney(model.discountMinor, model.currency, model.scale, model.locale))}</dd></div>
          <div><dt>Tax</dt><dd>${escapeHtml(formatMoney(model.taxMinor, model.currency, model.scale, model.locale))}</dd></div>
          <div class="modd-payable"><dt>Payable</dt><dd>${escapeHtml(formatMoney(model.payableMinor, model.currency, model.scale, model.locale))}</dd></div>
        </dl>
        <fieldset class="modd-tender-buttons"><legend>Add tender</legend><button type="button">Cash</button><button type="button">Card</button><button type="button">Split</button></fieldset>
        <ul class="modd-tenders" aria-label="Selected tenders">${tenderRows}</ul>
        ${blockReason}
        <button class="modd-complete" type="button"${model.canCheckout ? "" : " disabled"}>Complete checkout</button>
        <p class="modd-safety">Unknown provider status blocks retry. Query payment status before taking another card action.</p>
      </aside>
    </div>
    <footer class="modd-shortcuts"><strong>Keyboard</strong><span>F2 search</span><span>F4 quantity</span><span>F8 payment</span><span>F10 complete</span></footer>
  </main>`;
}

export const MOD_D_REGISTER_STYLES = `
.modd-register{--ink:#17231e;--muted:#5b665f;--paper:#f5f3ec;--panel:#fffefa;--line:#d7ddd8;--deep:#14251e;--accent:#1f6a51;--warn:#8a5a00;--danger:#9b2c2c;color:var(--ink);background:var(--paper);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100%;padding:20px;line-height:1.4}.modd-register *{box-sizing:border-box}.modd-register button,.modd-register input{font:inherit}.modd-register button{min-height:46px;cursor:pointer}.modd-register button:disabled{cursor:not-allowed;opacity:.5}.modd-register :focus-visible{outline:3px solid #276e8f;outline-offset:2px}.modd-register__header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-block-end:16px}.modd-register__header h1{font-size:clamp(1.8rem,3vw,2.6rem);line-height:1;margin:2px 0 6px}.modd-register__header p{margin:0;color:var(--muted)}.modd-eyebrow{font-size:.78rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.modd-register__status{display:grid;justify-items:end;gap:7px;color:var(--muted)}.modd-connection{font-weight:800;padding:5px 9px;border:1px solid currentColor}.modd-connection--online{color:var(--accent)}.modd-connection--offline{color:var(--warn)}.modd-offline,.modd-state{display:grid;grid-template-columns:auto 1fr;gap:8px 14px;align-items:start;padding:13px 15px;border:1px solid #d8b96f;background:#fff8e8;margin-block-end:14px}.modd-offline span,.modd-state span{color:var(--muted)}.modd-state--error,.modd-state--conflict{border-color:var(--danger);background:#fff2f0}.modd-command{background:#e9e4d8;padding:12px;margin-block-end:14px}.modd-command label{display:block;font-weight:800;margin-block-end:6px}.modd-command>div{display:grid;grid-template-columns:1fr auto;gap:8px}.modd-command input{min-height:48px;border:1px solid #9a958b;background:var(--panel);padding:10px 12px}.modd-command button,.modd-complete{border:0;background:var(--deep);color:white;font-weight:800;padding:10px 18px}.modd-workspace{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(300px,.75fr);gap:14px;align-items:start}.modd-cart,.modd-checkout{background:var(--panel);border:1px solid var(--line);box-shadow:0 4px 14px rgba(23,35,30,.1)}.modd-cart>header,.modd-checkout>header{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line)}.modd-cart h2,.modd-checkout h2{font-size:1.05rem;margin:0}.modd-cart header p{margin:3px 0 0;color:var(--muted)}.modd-secondary{background:var(--panel);color:var(--ink);border:1px solid #8f9892;padding:8px 12px;font-weight:700}.modd-table-wrap{overflow:auto}.modd-cart table{border-collapse:collapse;width:100%;min-width:620px}.modd-cart th,.modd-cart td{padding:12px;border-bottom:1px solid var(--line);text-align:start}.modd-cart th{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.modd-cart td:first-child span,.modd-cart td:first-child small{display:block;color:var(--muted)}.modd-cart td:first-child small{color:var(--danger);margin-block-start:4px}.modd-icon-button{width:46px;border:1px solid #909991;background:white;font-size:1.25rem}.modd-money{text-align:end!important;font-variant-numeric:tabular-nums}.modd-empty-cell{text-align:center!important;color:var(--muted);padding:38px!important}.modd-totals{padding:8px 16px;margin:0}.modd-totals>div{display:flex;justify-content:space-between;gap:14px;padding:8px 0}.modd-totals dt,.modd-totals dd{margin:0}.modd-totals dd{font-variant-numeric:tabular-nums}.modd-payable{border-top:2px solid var(--deep);font-size:1.15rem;font-weight:900}.modd-tender-buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;border:0;padding:10px 16px;margin:0}.modd-tender-buttons legend{font-weight:800;padding:0;margin-block-end:6px}.modd-tender-buttons button{border:1px solid #87928b;background:white;font-weight:800}.modd-tenders{list-style:none;padding:0 16px;margin:4px 0 10px}.modd-tenders li{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}.modd-tenders small{display:block;color:var(--muted)}.modd-tender-state{font-size:.75rem;font-weight:900;text-transform:uppercase}.modd-tender-state--ok{color:var(--accent)}.modd-tender-state--warn{color:var(--warn)}.modd-tender-state--danger{color:var(--danger)}.modd-empty-tender{color:var(--muted)}.modd-block{margin:10px 16px;color:var(--danger);font-weight:700}.modd-complete{width:calc(100% - 32px);margin:6px 16px 10px;min-height:54px;font-size:1.05rem}.modd-safety{font-size:.78rem;color:var(--muted);padding:0 16px 14px;margin:0}.modd-shortcuts{display:flex;flex-wrap:wrap;gap:10px 18px;margin-block-start:12px;color:var(--muted);font-size:.82rem}.modd-shortcuts strong{color:var(--ink)}@media(max-width:900px){.modd-workspace{grid-template-columns:1fr}.modd-register__header{align-items:stretch}.modd-register__status{justify-items:start}}@media(max-width:560px){.modd-register{padding:12px}.modd-register__header{display:grid}.modd-command>div{grid-template-columns:1fr}.modd-tender-buttons{grid-template-columns:1fr}.modd-shortcuts{display:none}}@media(prefers-reduced-motion:reduce){.modd-register *{scroll-behavior:auto!important}}
`;
