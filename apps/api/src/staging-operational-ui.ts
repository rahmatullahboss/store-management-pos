import type {
  StagingCatalogRow,
  StagingDashboardModel,
} from "./staging-operational-data.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusChip(status: StagingCatalogRow["status"]): string {
  if (status === "healthy") {
    return '<span class="rc-status rc-status--healthy">Available</span>';
  }
  if (status === "attention") {
    return '<span class="rc-status rc-status--attention">Low stock</span>';
  }
  return '<span class="rc-status rc-status--blocked">Unavailable</span>';
}

const styles = `<style>
.rc-page{display:grid;gap:1.25rem;color:var(--ink,#17231e)}
.rc-release{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap;padding:1rem 1.1rem;background:var(--accent-soft,#dcece5);color:var(--accent-strong,#15523d);border-radius:14px}
.rc-release strong,.rc-release span{display:block}.rc-release span{max-width:72ch;margin-top:.25rem}.rc-release a{display:inline-flex;align-items:center;min-height:44px;padding:.65rem .9rem;background:var(--rail,#14251e);color:#fff;border-radius:9px;font-weight:800;text-decoration:none}
.rc-heading{display:flex;align-items:end;justify-content:space-between;gap:1rem;flex-wrap:wrap}.rc-heading h1{max-width:15ch;margin:0;font-size:clamp(2.15rem,4.5vw,4.2rem);line-height:.98;letter-spacing:-.035em;text-wrap:balance}.rc-heading p{max-width:72ch;margin:.75rem 0 0;color:var(--ink-soft,#405049)}
.rc-control-strip{display:grid;grid-template-columns:minmax(0,1.5fr) repeat(3,minmax(9rem,.5fr));background:var(--rail,#14251e);color:#fff;border-radius:14px;overflow:hidden}.rc-control-strip>div{padding:1rem 1.1rem;border-inline-end:1px solid rgba(255,255,255,.14)}.rc-control-strip>div:last-child{border:0}.rc-control-strip span,.rc-control-strip small{display:block;color:#bed0c7}.rc-control-strip strong{display:block;margin-top:.3rem;font-size:clamp(1.25rem,2vw,1.85rem);font-variant-numeric:tabular-nums}
.rc-flow{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(18rem,.6fr);gap:1.25rem;align-items:start}.rc-surface{min-width:0;background:var(--surface,#fffefa);border-radius:14px;box-shadow:0 10px 24px rgba(23,35,30,.08);overflow:hidden}.rc-section-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.1rem;border-bottom:1px solid var(--line,#d7ddd8)}.rc-section-head h2{margin:0;font-size:1.15rem}.rc-section-head p{margin:.25rem 0 0;color:var(--muted,#59675f)}.rc-section-head a{color:var(--accent-strong,#15523d);font-weight:800}.rc-table-wrap{overflow-x:auto}.rc-table{width:100%;min-width:43rem;border-collapse:collapse}.rc-table th,.rc-table td{padding:.85rem 1rem;text-align:start;border-bottom:1px solid var(--line,#d7ddd8)}.rc-table th{font-size:.76rem;color:var(--muted,#59675f)}.rc-table td[data-money],.rc-table td[data-number]{font-variant-numeric:tabular-nums;font-weight:780}.rc-table a{color:var(--accent-strong,#15523d);font-weight:800}.rc-state-list{list-style:none;padding:0;margin:0}.rc-state-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.75rem;padding:1rem 1.1rem;border-bottom:1px solid var(--line,#d7ddd8)}.rc-state-list li:last-child{border:0}.rc-state-list strong,.rc-state-list span{display:block}.rc-state-list span{margin-top:.25rem;color:var(--muted,#59675f)}.rc-status{display:inline-flex;align-items:center;min-height:28px;padding:.25rem .55rem;border-radius:999px;font-size:.74rem;font-weight:850}.rc-status--healthy{background:var(--accent-soft,#dcece5);color:var(--accent-strong,#15523d)}.rc-status--attention{background:var(--attention-soft,#fff0c7);color:var(--attention,#8a5a00)}.rc-status--blocked{background:var(--danger-soft,#fbe1df);color:var(--danger,#9b2c2c)}
.rc-catalog-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.rc-catalog-summary>div{padding:1rem 1.1rem;background:var(--surface,#fffefa);border-radius:14px;box-shadow:0 10px 24px rgba(23,35,30,.08)}.rc-catalog-summary span,.rc-catalog-summary strong{display:block}.rc-catalog-summary span{color:var(--muted,#59675f)}.rc-catalog-summary strong{margin-top:.25rem;font-size:1.35rem;font-variant-numeric:tabular-nums}
@media(max-width:980px){.rc-control-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.rc-control-strip>div{border-bottom:1px solid rgba(255,255,255,.14)}.rc-flow{grid-template-columns:1fr}}
@media(max-width:650px){.rc-control-strip,.rc-catalog-summary{grid-template-columns:1fr}.rc-control-strip>div{border-inline-end:0}.rc-heading{align-items:flex-start}.rc-release{display:grid}}
@media(prefers-reduced-motion:no-preference){.rc-table tbody tr{transition:background-color 160ms ease-out}.rc-table tbody tr:hover{background:var(--accent-soft,#dcece5)}}
</style>`;

export function renderStagingDashboard(model: StagingDashboardModel): string {
  const recent = model.recentOrders.length > 0
    ? model.recentOrders.map((order) => `<tr><td><a href="/sales">${escapeHtml(order.number)}</a></td><td>${escapeHtml(order.customer)}</td><td data-money>${escapeHtml(order.total)}</td><td>${escapeHtml(order.state)}</td></tr>`).join("")
    : '<tr><td colspan="4">No active sales orders.</td></tr>';
  const attention = [
    {
      title: `${model.lowStockCount} catalog lines need stock attention`,
      detail: "Availability is derived from inventory balances minus active reservations.",
      href: "/inventory",
      label: "Open inventory",
    },
    {
      title: `${model.openPurchaseOrders} purchase orders are open`,
      detail: `${model.openPurchaseValue} remains ordered across submitted, approved and part-received documents.`,
      href: "/procurement",
      label: "Open procurement",
    },
    {
      title: `${model.activeSalesOrders} sales orders are active`,
      detail: `${model.salesOrderValue} is represented by immutable order snapshots in this release candidate.`,
      href: "/sales",
      label: "Open sales",
    },
  ];
  return `${styles}<section class="rc-page" data-staging-page="operational-dashboard">
    <section class="rc-release" role="status"><div><strong>Usable release candidate · synthetic business data</strong><span>The workspace now reads the real catalog, pricing, inventory, procurement, customer and sales schemas. Authoritative commands remain disabled until write controls pass.</span></div><a href="/auth/context">View access context</a></section>
    <header class="rc-heading"><div><h1>Run the store from evidence, not empty screens.</h1><p>See what can be sold, what is reserved, what must be purchased and which customer orders need attention. Every number below is queried from the dedicated staging database.</p></div></header>
    <section class="rc-control-strip" aria-label="Operating control totals"><div><span>Inventory control</span><strong>${escapeHtml(model.availableUnits)} available</strong><small>${escapeHtml(model.reservedUnits)} reserved · ${escapeHtml(model.inventoryValue)} stock value</small></div><div><span>Catalog</span><strong>${model.productCount}</strong><small>active products</small></div><div><span>Customers</span><strong>${model.activeCustomers}</strong><small>active profiles</small></div><div><span>Sales</span><strong>${model.activeSalesOrders}</strong><small>active orders</small></div></section>
    <div class="rc-flow"><section class="rc-surface"><div class="rc-section-head"><div><h2>Recent sales work</h2><p>Independent order and payment states remain visible.</p></div><a href="/sales">All sales</a></div><div class="rc-table-wrap"><table class="rc-table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>State</th></tr></thead><tbody>${recent}</tbody></table></div></section>
    <aside class="rc-surface"><div class="rc-section-head"><div><h2>Needs attention</h2><p>Risk and replenishment signals.</p></div></div><ul class="rc-state-list">${attention.map((item) => `<li><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div><a href="${item.href}">${escapeHtml(item.label)}</a></li>`).join("")}</ul></aside></div>
  </section>`;
}

export function renderStagingCatalog(rows: readonly StagingCatalogRow[]): string {
  const availableCount = rows.filter((row) => row.status === "healthy").length;
  const attentionCount = rows.filter((row) => row.status === "attention").length;
  const blockedCount = rows.filter((row) => row.status === "blocked").length;
  const body = rows.length > 0
    ? rows.map((row) => `<tr><td><a href="/catalog">${escapeHtml(row.product)}</a><span class="cell-detail">${escapeHtml(row.category)}</span></td><td><strong>${escapeHtml(row.variant)}</strong><span class="cell-detail">${escapeHtml(row.sku)}</span></td><td data-money>${escapeHtml(row.price)}</td><td data-number>${escapeHtml(row.available)} EA</td><td data-money>${escapeHtml(row.inventoryValue)}</td><td>${statusChip(row.status)}</td></tr>`).join("")
    : '<tr><td colspan="6">No active catalog lines were returned for this tenant.</td></tr>';
  return `${styles}<section class="rc-page" data-staging-page="operational-catalog"><section class="rc-release" role="status"><div><strong>Database-backed catalog</strong><span>Products, variants, active POS prices, available quantity and projected inventory value come from their module-owned tables.</span></div><a href="/inventory">Open stock</a></section><header class="rc-heading"><div><h1>Catalog, price and availability in one operating view.</h1><p>Use SKU-level evidence to decide what can be sold now and what needs replenishment. Values are synthetic but follow the production schema and exact-money contracts.</p></div></header><section class="rc-catalog-summary" aria-label="Catalog state"><div><span>Available</span><strong>${availableCount}</strong></div><div><span>Low stock</span><strong>${attentionCount}</strong></div><div><span>Unavailable</span><strong>${blockedCount}</strong></div></section><section class="rc-surface"><div class="rc-section-head"><div><h2>Active sellable variants</h2><p>Availability equals sellable balance minus active reservation quantity.</p></div></div><div class="rc-table-wrap"><table class="rc-table"><thead><tr><th>Product</th><th>Variant / SKU</th><th>POS price</th><th>Available</th><th>Inventory value</th><th>State</th></tr></thead><tbody>${body}</tbody></table></div></section></section>`;
}
