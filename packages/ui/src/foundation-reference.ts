function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function statusChip(label: string, tone: "success" | "warning" | "danger" | "neutral" = "neutral"): string {
  return `<span class="status-chip status-chip--${tone}"><span aria-hidden="true" class="status-chip__dot"></span>${escapeHtml(label)}</span>`;
}

export function renderAdminFoundationReference(): string {
  return `<div class="fixture-notice" role="note"><strong>Foundation preview</strong><span>Synthetic operational data for UI validation only.</span></div>
<section class="page-heading" aria-labelledby="admin-overview-title">
  <div>
    <h1 id="admin-overview-title">Today’s operating picture</h1>
    <p>Start with exceptions, then trace every decision back to its source record and audit effect.</p>
  </div>
  <div class="page-actions" aria-label="Overview actions">
    <button class="button button--secondary" type="button">Export snapshot</button>
    <button class="button button--primary" type="button">Open approval queue</button>
  </div>
</section>
<section class="signal-band" aria-label="Business status">
  <div class="signal-band__primary">
    <span class="signal-band__label">Operating state</span>
    <strong>All stores reporting</strong>
    <span>Latest synthetic sync 2 minutes ago</span>
  </div>
  <dl class="signal-band__facts">
    <div><dt>Open registers</dt><dd>4</dd></div>
    <div><dt>Queued approvals</dt><dd>3</dd></div>
    <div><dt>Sync exceptions</dt><dd>1</dd></div>
  </dl>
</section>
<div class="operations-layout">
  <section class="work-queue" aria-labelledby="work-queue-title">
    <div class="section-heading">
      <div><h2 id="work-queue-title">Work requiring attention</h2><p>Ordered by operational risk, not by creation time.</p></div>
      <button class="text-action" type="button">View all work</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Work item</th><th scope="col">Context</th><th scope="col">Owner</th><th scope="col">State</th><th scope="col"><span class="visually-hidden">Action</span></th></tr></thead>
        <tbody>
          <tr><td><strong>Price override approval</strong><span class="cell-detail">REF-2026-0042</span></td><td>Dhaka Central · Register 02</td><td>Store manager</td><td>${statusChip("Approval pending", "warning")}</td><td><button class="row-action" type="button" aria-label="Review price override REF-2026-0042">Review</button></td></tr>
          <tr><td><strong>Inventory sync conflict</strong><span class="cell-detail">SYNC-2026-0017</span></td><td>Warehouse A · 2 operations</td><td>Inventory lead</td><td>${statusChip("Needs resolution", "danger")}</td><td><button class="row-action" type="button" aria-label="Resolve inventory sync conflict SYNC-2026-0017">Resolve</button></td></tr>
          <tr><td><strong>Daily close review</strong><span class="cell-detail">SHIFT-2026-0188</span></td><td>Chattogram · Register 01</td><td>Finance</td><td>${statusChip("Ready to review", "success")}</td><td><button class="row-action" type="button" aria-label="Review daily close SHIFT-2026-0188">Review</button></td></tr>
        </tbody>
      </table>
    </div>
  </section>
  <aside class="trace-panel" aria-labelledby="trace-title">
    <div class="section-heading section-heading--compact"><div><h2 id="trace-title">Trace a number</h2><p>Every summary must reveal its provenance.</p></div></div>
    <form class="trace-form">
      <label for="trace-reference">Document or reference</label>
      <div class="input-action"><input id="trace-reference" name="trace-reference" value="REF-2026-0042"><button type="submit">Trace</button></div>
    </form>
    <ol class="provenance-chain">
      <li><span class="provenance-chain__step">Source</span><strong>Price override request</strong><span>Requested by Synthetic Cashier</span></li>
      <li><span class="provenance-chain__step">Decision</span><strong>Manager approval pending</strong><span>Policy: high-value override</span></li>
      <li><span class="provenance-chain__step">Effects</span><strong>No ledger effect yet</strong><span>Posting waits for approval</span></li>
    </ol>
    <button class="button button--secondary button--full" type="button">Open audit history</button>
  </aside>
</div>
<section class="foundation-states" aria-labelledby="foundation-state-title">
  <div class="section-heading"><div><h2 id="foundation-state-title">Foundation controls</h2><p>Critical platform services and the recovery path users can understand.</p></div></div>
  <div class="state-list">
    <article><div><strong>Identity and access</strong><p>OIDC verification, MFA assurance and active membership checks.</p></div>${statusChip("Healthy", "success")}</article>
    <article><div><strong>Database isolation</strong><p>Tenant context and forced row-level security are active.</p></div>${statusChip("Healthy", "success")}</article>
    <article><div><strong>Event delivery</strong><p>One synthetic operation is waiting for retry.</p></div>${statusChip("Attention", "warning")}</article>
  </div>
</section>`;
}

export function renderPosFoundationReference(): string {
  return `<div class="fixture-notice" role="note"><strong>Illustrative Dhaka fixture</strong><span>Products, prices and people are synthetic.</span></div>
<section class="pos-heading" aria-labelledby="checkout-title">
  <div><h1 id="checkout-title">New sale</h1><p>Register 02 · Business date 28 Jul 2026</p></div>
  <div class="pos-heading__state">${statusChip("Online · synced", "success")}<kbd>F2</kbd><span>Customer</span><kbd>F8</kbd><span>Pay</span></div>
</section>
<div class="checkout-layout">
  <section class="product-workspace" aria-labelledby="product-search-title">
    <div class="scan-panel">
      <label id="product-search-title" for="product-search">Scan barcode or search products</label>
      <div class="scan-input"><span aria-hidden="true">⌁</span><input id="product-search" name="product-search" placeholder="Barcode, SKU or product name" autocomplete="off"><kbd>Enter</kbd></div>
      <div class="filter-row" aria-label="Product filters"><button class="filter-chip filter-chip--active" type="button">All</button><button class="filter-chip" type="button">Recent</button><button class="filter-chip" type="button">Low stock</button><button class="filter-chip" type="button">Favourites</button></div>
    </div>
    <div class="product-results" aria-live="polite">
      <button class="product-row" type="button"><span class="product-row__code">SKU 10021</span><span class="product-row__name">Everyday cotton shirt</span><span class="product-row__stock">12 in stock</span><strong>BDT 1,250.00</strong></button>
      <button class="product-row" type="button"><span class="product-row__code">SKU 10034</span><span class="product-row__name">Canvas carry bag</span><span class="product-row__stock">8 in stock</span><strong>BDT 620.00</strong></button>
      <button class="product-row" type="button"><span class="product-row__code">SKU 10051</span><span class="product-row__name">Stainless water bottle</span><span class="product-row__stock">21 in stock</span><strong>BDT 890.00</strong></button>
      <div class="empty-inline" role="status"><span aria-hidden="true">↳</span><span>Scan a barcode to add immediately. Search results remain keyboard navigable.</span></div>
    </div>
  </section>
  <section class="cart-panel" aria-labelledby="cart-title">
    <div class="cart-panel__header"><div><h2 id="cart-title">Current sale</h2><p>2 items · No customer selected</p></div><button class="text-action" type="button">Hold sale</button></div>
    <ol class="cart-lines">
      <li><div><strong>Everyday cotton shirt</strong><span>Blue · Medium · SKU 10021</span></div><div class="quantity-control" aria-label="Quantity for Everyday cotton shirt"><button type="button" aria-label="Decrease quantity">−</button><output>1</output><button type="button" aria-label="Increase quantity">+</button></div><strong>BDT 1,250.00</strong></li>
      <li><div><strong>Canvas carry bag</strong><span>Natural · SKU 10034</span></div><div class="quantity-control" aria-label="Quantity for Canvas carry bag"><button type="button" aria-label="Decrease quantity">−</button><output>1</output><button type="button" aria-label="Increase quantity">+</button></div><strong>BDT 620.00</strong></li>
    </ol>
    <button class="cart-note" type="button"><span>Add customer or sale note</span><span aria-hidden="true">+</span></button>
    <dl class="sale-totals"><div><dt>Subtotal</dt><dd>BDT 1,870.00</dd></div><div><dt>Tax</dt><dd>BDT 0.00</dd></div><div class="sale-totals__total"><dt>Total</dt><dd>BDT 1,870.00</dd></div></dl>
    <div class="checkout-actions"><button class="button button--secondary" type="button">More actions</button><button class="button button--pay" type="button"><span>Pay BDT 1,870.00</span><kbd>F8</kbd></button></div>
    <p class="cart-assurance"><span aria-hidden="true">✓</span> Stock and ledger effects post only after payment confirmation.</p>
  </section>
</div>`;
}
