export interface InventoryDashboardFixture {
  readonly reconciledAt: string;
  readonly availableUnits: string;
  readonly reservedUnits: string;
  readonly exceptionCount: number;
  readonly balances: readonly {
    readonly variant: string;
    readonly sku: string;
    readonly warehouse: string;
    readonly sellable: string;
    readonly reserved: string;
    readonly inTransit: string;
    readonly value: string;
    readonly status: "healthy" | "attention" | "blocked";
  }[];
  readonly tasks: readonly {
    readonly priority: "critical" | "attention" | "routine";
    readonly task: string;
    readonly source: string;
    readonly quantity: string;
    readonly age: string;
    readonly action: string;
  }[];
  readonly trace: readonly { readonly label: string; readonly reference: string; readonly detail: string }[];
}

const styles = `<style>
.modb-ledger-map{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr);align-items:stretch;margin:1.2rem 0;background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
.modb-ledger-map article{padding:1rem 1.1rem}.modb-ledger-map strong,.modb-ledger-map span{display:block}.modb-ledger-map span{margin-top:.25rem;color:var(--muted);font-size:.76rem}.modb-ledger-map b{display:grid;place-items:center;padding:.5rem;background:#edf0eb;color:var(--accent-strong);font-size:1.1rem}
.modb-table-surface{margin-top:1.2rem;background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}.modb-number{font-variant-numeric:tabular-nums;text-align:end;white-space:nowrap}.modb-source{font-size:.72rem;color:var(--muted);font-variant-numeric:tabular-nums}.modb-inline-actions{display:flex;gap:.45rem;flex-wrap:wrap}.modb-inline-actions a{display:inline-flex;align-items:center;min-height:2.25rem;padding:.42rem .65rem;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface-raised);color:var(--accent-strong);font-size:.75rem;font-weight:780;text-decoration:none}.modb-inline-actions a:hover{background:var(--accent-soft)}
.modb-priority{display:inline-flex;align-items:center;gap:.4rem;font-weight:780;font-size:.72rem}.modb-priority::before{content:"";width:.5rem;height:.5rem;border-radius:50%;background:currentColor}.modb-priority--critical{color:var(--danger)}.modb-priority--attention{color:var(--attention)}.modb-priority--routine{color:var(--accent)}
@media(max-width:760px){.modb-ledger-map{grid-template-columns:1fr}.modb-ledger-map b{min-height:2rem;transform:rotate(90deg)}.modb-number{text-align:start}}
</style>`;

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function chip(status: InventoryDashboardFixture["balances"][number]["status"]): string {
  if (status === "healthy") return '<span class="status-chip status-chip--success"><span class="status-chip__dot"></span>Healthy</span>';
  if (status === "attention") return '<span class="status-chip status-chip--warning"><span class="status-chip__dot"></span>Attention</span>';
  return '<span class="status-chip status-chip--danger"><span class="status-chip__dot"></span>Blocked</span>';
}

export function inventoryFixture(): InventoryDashboardFixture {
  return {
    reconciledAt: "28 Jul 2026 · 15:36",
    availableUnits: "18,420",
    reservedUnits: "1,184",
    exceptionCount: 7,
    balances: [
      { variant: "USB-C Hub · 8-port", sku: "HUB-8P-GR", warehouse: "Dhaka Central", sellable: "342", reserved: "48", inTransit: "120", value: "£14,706.00", status: "healthy" },
      { variant: "Thermal paper · 80 mm", sku: "PAPER-80", warehouse: "Gulshan Store", sellable: "16", reserved: "12", inTransit: "0", value: "£64.00", status: "attention" },
      { variant: "Wireless scanner · S2", sku: "SCAN-S2", warehouse: "Dhaka Central", sellable: "0", reserved: "5", inTransit: "0", value: "£0.00", status: "blocked" },
      { variant: "Receipt printer · RP-4", sku: "PRINT-RP4", warehouse: "Chattogram", sellable: "31", reserved: "3", inTransit: "8", value: "£3,348.00", status: "healthy" },
    ],
    tasks: [
      { priority: "critical", task: "Resolve negative availability override", source: "Reservation RSV-10482", quantity: "−5 EA", age: "12 min", action: "Review approval" },
      { priority: "attention", task: "Receive transfer discrepancy", source: "Transfer TRF-00918", quantity: "2 missing", age: "41 min", action: "Record outcome" },
      { priority: "attention", task: "Approve recount variance", source: "Count CNT-00277", quantity: "+7 EA", age: "2 h", action: "Compare counts" },
      { priority: "routine", task: "Release expired reservations", source: "Expiry job · batch 226", quantity: "18 lines", age: "4 h", action: "Inspect batch" },
    ],
    trace: [
      { label: "Source document", reference: "GRN-000184", detail: "Supplier receipt · 40 accepted units" },
      { label: "Posting group", reference: "PG-20260728-9184", detail: "Two immutable stock entries" },
      { label: "Cost layer", reference: "CL-003811", detail: "FIFO · £43.00 per unit" },
      { label: "Balance projection", reference: "Dhaka Central / HUB-8P-GR", detail: "342 sellable · cursor 18,442" },
    ],
  };
}

export function renderInventoryOperationsPage(data: InventoryDashboardFixture = inventoryFixture()): string {
  const tasks = data.tasks.map((task) => `<tr><td><span class="modb-priority modb-priority--${task.priority}">${escapeHtml(task.priority)}</span></td><td><strong>${escapeHtml(task.task)}</strong><span class="cell-detail">${escapeHtml(task.source)}</span></td><td class="modb-number">${escapeHtml(task.quantity)}</td><td>${escapeHtml(task.age)}</td><td><button class="row-action" type="button">${escapeHtml(task.action)}</button></td></tr>`).join("");
  const balances = data.balances.map((balance) => `<tr><td><strong>${escapeHtml(balance.variant)}</strong><span class="cell-detail">${escapeHtml(balance.sku)}</span></td><td>${escapeHtml(balance.warehouse)}</td><td class="modb-number"><strong>${escapeHtml(balance.sellable)}</strong><span class="cell-detail">sellable</span></td><td class="modb-number">${escapeHtml(balance.reserved)}</td><td class="modb-number">${escapeHtml(balance.inTransit)}</td><td class="modb-number">${escapeHtml(balance.value)}</td><td>${chip(balance.status)}</td><td><button class="row-action" type="button">Trace</button></td></tr>`).join("");
  const trace = data.trace.map((step) => `<li><span class="provenance-chain__step">${escapeHtml(step.label)}</span><strong>${escapeHtml(step.reference)}</strong><span>${escapeHtml(step.detail)}</span></li>`).join("");
  return `${styles}<div class="fixture-notice"><strong>Synthetic operational fixture</strong><span>Replace with authenticated API data; no customer records are shown.</span></div>
  <header class="page-heading"><div><h1>Know what is available, where, and why.</h1><p>Operate from derived balances, then trace every reservation, receipt, transfer, count and cost effect back to immutable evidence.</p></div><div class="page-actions"><a class="button button--secondary" href="/inventory/movements">Export movement</a><a class="button button--secondary" href="/inventory/counts/new">Start count</a><a class="button button--primary" href="/inventory/transfers/new">New transfer</a></div></header>
  <section class="signal-band" aria-label="Inventory operating state"><div class="signal-band__primary"><span class="signal-band__label">Ledger control</span><strong>Stock projection reconciled</strong><span>Last full comparison ${escapeHtml(data.reconciledAt)} · no unexplained balance drift.</span></div><dl class="signal-band__facts"><div><dt>Available</dt><dd>${escapeHtml(data.availableUnits)}</dd></div><div><dt>Reserved</dt><dd>${escapeHtml(data.reservedUnits)}</dd></div><div><dt>Exceptions</dt><dd>${data.exceptionCount}</dd></div></dl></section>
  <div class="modb-ledger-map" aria-label="Inventory effect chain"><article><strong>Operational document</strong><span>Receipt, sale, return, transfer, adjustment or count</span></article><b aria-hidden="true">→</b><article><strong>Immutable stock posting</strong><span>Idempotent operation and posting-group lineage</span></article><b aria-hidden="true">→</b><article><strong>Availability and value</strong><span>On hand minus active reservations, with FIFO cost</span></article></div>
  <div class="operations-layout"><section class="work-queue"><div class="section-heading"><div><h2>Exception work queue</h2><p>Risk ordered. Actions preserve approval and source evidence.</p></div><span class="status-chip status-chip--warning"><span class="status-chip__dot"></span>${data.exceptionCount} open</span></div><div class="table-wrap"><table><thead><tr><th>Risk</th><th>Task and source</th><th>Effect</th><th>Age</th><th>Action</th></tr></thead><tbody>${tasks}</tbody></table></div></section>
  <aside class="trace-panel"><div class="section-heading section-heading--compact"><div><h2>Trace a stock effect</h2><p>Search a receipt, posting group, variant, batch or serial.</p></div></div><form class="trace-form" action="/inventory/trace" method="get"><label for="inventory-trace">Reference</label><div class="input-action"><input id="inventory-trace" name="reference" autocomplete="off" placeholder="GRN, posting group, batch…"><button type="submit">Trace</button></div></form><ol class="provenance-chain">${trace}</ol><div class="modb-inline-actions"><a href="/inventory/movements">Open ledger</a><a href="/audit">Audit trail</a></div></aside></div>
  <section class="modb-table-surface"><div class="section-heading"><div><h2>Stock by operating dimension</h2><p>Values are projections; Trace opens the ledger and source-document chain.</p></div><div class="modb-inline-actions"><a href="/inventory/reconciliation">Reconcile</a><a href="/inventory/reorder-policies">Reorder rules</a></div></div><div class="table-wrap"><table><thead><tr><th>Variant</th><th>Warehouse</th><th>Sellable</th><th>Reserved</th><th>In transit</th><th>Inventory value</th><th>State</th><th></th></tr></thead><tbody>${balances}</tbody></table></div></section>`;
}
