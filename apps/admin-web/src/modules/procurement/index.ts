export interface ProcurementDashboardFixture {
  readonly approvedOpenValue: string;
  readonly receiptsDue: number;
  readonly matchExceptions: number;
  readonly purchaseOrders: readonly {
    readonly order: string;
    readonly supplier: string;
    readonly destination: string;
    readonly promised: string;
    readonly ordered: string;
    readonly received: string;
    readonly value: string;
    readonly state: "submitted" | "approved" | "partially_received" | "exception";
  }[];
  readonly suppliers: readonly {
    readonly supplier: string;
    readonly openOrders: number;
    readonly averageReceipt: string;
    readonly exceptionRate: string;
    readonly lastReceipt: string;
    readonly state: "healthy" | "attention";
  }[];
}

const styles = `<style>
.modb-procurement-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(19rem,.65fr);gap:1.2rem;align-items:start}.modb-receive-panel{padding:1.15rem;background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow)}.modb-receive-panel form{display:grid;gap:.85rem}.modb-receive-panel label{display:grid;gap:.32rem;font-size:.76rem;font-weight:780}.modb-receive-panel input,.modb-receive-panel select{width:100%;min-height:2.75rem;padding:.62rem .7rem;border:1px solid var(--line-strong);border-radius:9px;background:var(--surface-raised);color:var(--ink)}.modb-receive-assurance{margin:0;padding:.72rem .8rem;border-radius:9px;background:var(--accent-soft);color:var(--accent-strong);font-size:.75rem}.modb-document-chain{display:grid;grid-template-columns:repeat(4,minmax(9rem,1fr));margin:1.2rem 0;background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);overflow:auto}.modb-document-chain article{position:relative;padding:1rem 1.1rem;border-inline-end:1px solid var(--line)}.modb-document-chain article:last-child{border:0}.modb-document-chain article:not(:last-child)::after{content:"→";position:absolute;inset-inline-end:-.45rem;inset-block-start:1rem;z-index:2;display:grid;place-items:center;width:.9rem;height:1.5rem;background:var(--surface);color:var(--accent-strong);font-weight:900}.modb-document-chain strong,.modb-document-chain span{display:block}.modb-document-chain span{margin-top:.25rem;color:var(--muted);font-size:.74rem}.modb-table-surface{margin-top:1.2rem;background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}.modb-number{text-align:end;white-space:nowrap;font-variant-numeric:tabular-nums}@media(max-width:980px){.modb-procurement-grid{grid-template-columns:1fr}.modb-receive-panel{order:-1}}@media(max-width:680px){.modb-document-chain{grid-template-columns:1fr}.modb-document-chain article{border-inline-end:0;border-bottom:1px solid var(--line)}.modb-document-chain article:not(:last-child)::after{content:"↓";inset-inline-end:1rem;inset-block-start:auto;inset-block-end:-.75rem}.modb-number{text-align:start}}
</style>`;

function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function orderChip(state: ProcurementDashboardFixture["purchaseOrders"][number]["state"]): string {
  if (state === "approved") return '<span class="status-chip status-chip--success"><span class="status-chip__dot"></span>Approved</span>';
  if (state === "submitted") return '<span class="status-chip status-chip--warning"><span class="status-chip__dot"></span>Approval pending</span>';
  if (state === "partially_received") return '<span class="status-chip status-chip--neutral"><span class="status-chip__dot"></span>Part received</span>';
  return '<span class="status-chip status-chip--danger"><span class="status-chip__dot"></span>Exception</span>';
}

export function procurementFixture(): ProcurementDashboardFixture {
  return {
    approvedOpenValue: "£48,216.00", receiptsDue: 9, matchExceptions: 3,
    purchaseOrders: [
      { order: "PO-000184", supplier: "Northstar Distribution", destination: "Dhaka Central", promised: "28 Jul", ordered: "120 EA", received: "80 EA", value: "£5,160.00", state: "partially_received" },
      { order: "PO-000191", supplier: "Paperline Wholesale", destination: "Gulshan Store", promised: "29 Jul", ordered: "400 EA", received: "0 EA", value: "£1,600.00", state: "approved" },
      { order: "PO-000194", supplier: "Axis Devices", destination: "Chattogram", promised: "31 Jul", ordered: "24 EA", received: "0 EA", value: "£4,896.00", state: "submitted" },
      { order: "PO-000179", supplier: "Metro Packaging", destination: "Dhaka Central", promised: "26 Jul", ordered: "250 EA", received: "245 EA", value: "£2,450.00", state: "exception" },
    ],
    suppliers: [
      { supplier: "Northstar Distribution", openOrders: 4, averageReceipt: "6.4 days", exceptionRate: "1.8%", lastReceipt: "28 Jul", state: "healthy" },
      { supplier: "Paperline Wholesale", openOrders: 2, averageReceipt: "3.1 days", exceptionRate: "0.4%", lastReceipt: "27 Jul", state: "healthy" },
      { supplier: "Metro Packaging", openOrders: 3, averageReceipt: "9.7 days", exceptionRate: "6.2%", lastReceipt: "26 Jul", state: "attention" },
    ],
  };
}

export function renderProcurementOperationsPage(data: ProcurementDashboardFixture = procurementFixture()): string {
  const orders = data.purchaseOrders.map((order) => `<tr><td><strong>${escapeHtml(order.order)}</strong><span class="cell-detail">${escapeHtml(order.supplier)}</span></td><td>${escapeHtml(order.destination)}</td><td>${escapeHtml(order.promised)}</td><td class="modb-number">${escapeHtml(order.ordered)}</td><td class="modb-number">${escapeHtml(order.received)}</td><td class="modb-number">${escapeHtml(order.value)}</td><td>${orderChip(order.state)}</td><td><button type="button" class="row-action">Open</button></td></tr>`).join("");
  const suppliers = data.suppliers.map((supplier) => `<tr><td><strong>${escapeHtml(supplier.supplier)}</strong></td><td class="modb-number">${supplier.openOrders}</td><td>${escapeHtml(supplier.averageReceipt)}</td><td>${supplier.state === "healthy" ? `<span class="status-chip status-chip--success"><span class="status-chip__dot"></span>${escapeHtml(supplier.exceptionRate)}</span>` : `<span class="status-chip status-chip--warning"><span class="status-chip__dot"></span>${escapeHtml(supplier.exceptionRate)}</span>`}</td><td>${escapeHtml(supplier.lastReceipt)}</td><td><button type="button" class="row-action">Review</button></td></tr>`).join("");
  return `${styles}<div class="fixture-notice"><strong>Synthetic operational fixture</strong><span>Illustrates workflow and hierarchy; values are not production claims.</span></div>
  <header class="page-heading"><div><h1>Buy with control. Receive with evidence.</h1><p>Move from requisition to approved order, inspection, immutable stock receipt, supplier return and three-way match without losing document lineage.</p></div><div class="page-actions"><a class="button button--secondary" href="/procurement/suppliers/import">Import suppliers</a><a class="button button--secondary" href="/procurement/requisitions/new">New requisition</a><a class="button button--primary" href="/procurement/purchase-orders/new">New purchase order</a></div></header>
  <section class="signal-band" aria-label="Procurement operating state"><div class="signal-band__primary"><span class="signal-band__label">Receiving control</span><strong>Three receipts need inspection decisions</strong><span>Quarantine, damage and over-receipt outcomes must be resolved before close.</span></div><dl class="signal-band__facts"><div><dt>Approved open</dt><dd>${escapeHtml(data.approvedOpenValue)}</dd></div><div><dt>Receipts due</dt><dd>${data.receiptsDue}</dd></div><div><dt>Match exceptions</dt><dd>${data.matchExceptions}</dd></div></dl></section>
  <div class="modb-document-chain" aria-label="Procurement document chain"><article><strong>Requisition</strong><span>Need, destination, required date and reason</span></article><article><strong>Approved PO</strong><span>Supplier, quantity, price, tolerance and approval</span></article><article><strong>Goods receipt</strong><span>Accepted, quarantine, damaged or rejected</span></article><article><strong>Match and cost</strong><span>Bill evidence, return and landed-cost allocation</span></article></div>
  <div class="modb-procurement-grid"><section class="work-queue"><div class="section-heading"><div><h2>Open purchase orders</h2><p>Orders do not create stock. Posted receipt lines do.</p></div><span class="status-chip status-chip--warning"><span class="status-chip__dot"></span>${data.receiptsDue} due</span></div><div class="table-wrap"><table><thead><tr><th>Order and supplier</th><th>Destination</th><th>Promised</th><th>Ordered</th><th>Received</th><th>Value</th><th>State</th><th></th></tr></thead><tbody>${orders}</tbody></table></div></section>
  <aside class="modb-receive-panel"><div class="section-heading section-heading--compact"><div><h2>Receive against an approved PO</h2><p>Start with the document. Inspection comes before stock posting.</p></div></div><form action="/procurement/goods-receipts/new" method="get"><label for="receive-po">Purchase order<input id="receive-po" name="purchaseOrder" placeholder="PO number or supplier" autocomplete="off"></label><label for="receive-location">Receiving location<select id="receive-location" name="warehouse"><option>Dhaka Central</option><option>Gulshan Store</option><option>Chattogram</option></select></label><button class="button button--primary button--full" type="submit">Open receiving workspace</button><p class="modb-receive-assurance">Stock, cost layer, audit evidence and outbox event post together only after confirmation.</p></form></aside></div>
  <section class="modb-table-surface"><div class="section-heading"><div><h2>Supplier delivery evidence</h2><p>Lead time and exceptions derive from approved orders and posted receipts.</p></div><a class="text-action" href="/procurement/reports/supplier-performance">Open report</a></div><div class="table-wrap"><table><thead><tr><th>Supplier</th><th>Open orders</th><th>Average receipt</th><th>Exception rate</th><th>Last receipt</th><th></th></tr></thead><tbody>${suppliers}</tbody></table></div></section>`;
}
