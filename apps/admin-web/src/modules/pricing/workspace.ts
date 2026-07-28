import { MOD_A_ADMIN_STYLES, direction, escapeHtml, renderAdminState, statusChip, type ModAAdminLocale, type ModAAdminRenderOptions } from "../catalog/surface.js";

const directionContract = `<!--
THESIS: Pricing and tax operations expose effective versions, calculation provenance and approval risk; they refuse unexplained totals and hidden rule precedence.
OWN-WORLD: The established Operations Ledger shell, warm work surfaces, ledger-green actions, dense tables and immutable version timelines.
STORY: An operator can identify the active rule, simulate its exact effect, see why it won and publish or approve only with the required control.
FIRST VIEWPORT: Version ledger and scope filters dominate; the adjacent simulator explains price, promotion, tax and approval effects before any publish action.
FORM: Established operate surface extended as a master-detail control room; no new visual identity or shared primitive is introduced.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

interface PriceListRow {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly scope: string;
  readonly currency: string;
  readonly version: number;
  readonly state: "Active" | "Scheduled" | "Draft" | "Retired";
  readonly effective: string;
}

const priceLists: readonly PriceListRow[] = Object.freeze([
  { id: "retail-gbp", name: "Retail GBP", code: "RETAIL-GBP", scope: "All stores · All channels", currency: "GBP", version: 7, state: "Active", effective: "1 Jul 2026" },
  { id: "dhaka-pos", name: "Dhaka POS", code: "DHAKA-POS", scope: "Dhaka Central · POS", currency: "GBP", version: 3, state: "Scheduled", effective: "1 Aug 2026" },
  { id: "wholesale", name: "Wholesale tier", code: "WHOLESALE", scope: "Customer group · Wholesale", currency: "GBP", version: 5, state: "Draft", effective: "Not published" },
  { id: "legacy-web", name: "Legacy web price", code: "WEB-OLD", scope: "Web channel", currency: "GBP", version: 12, state: "Retired", effective: "Ended 30 Jun 2026" },
]);

const copy: Record<ModAAdminLocale, { title: string; intro: string; newList: string; simulate: string; publish: string; search: string; ledger: string; inspector: string }> = {
  en: { title: "Pricing and tax control", intro: "Resolve effective prices, promotions and tax with exact arithmetic, then retain the calculation trail.", newList: "New price list", simulate: "Run simulation", publish: "Publish version", search: "Search price list or scope", ledger: "Effective price ledger", inspector: "Resolution inspector" },
  bn: { title: "প্রাইসিং ও ট্যাক্স নিয়ন্ত্রণ", intro: "সঠিক হিসাব দিয়ে কার্যকর মূল্য, প্রোমোশন ও কর নির্ধারণ করুন এবং গণনার ট্রেইল সংরক্ষণ করুন।", newList: "নতুন মূল্য তালিকা", simulate: "সিমুলেশন চালান", publish: "সংস্করণ প্রকাশ", search: "মূল্য তালিকা বা স্কোপ খুঁজুন", ledger: "কার্যকর মূল্য লেজার", inspector: "রেজোলিউশন পরিদর্শন" },
  ar: { title: "التحكم في التسعير والضريبة", intro: "حدّد الأسعار والعروض والضريبة الفعالة بحسابات دقيقة واحتفظ بمسار القرار.", newList: "قائمة أسعار جديدة", simulate: "تشغيل المحاكاة", publish: "نشر الإصدار", search: "البحث في قائمة الأسعار أو النطاق", ledger: "سجل الأسعار الفعالة", inspector: "فاحص الحل" },
  ja: { title: "価格・税制御", intro: "有効な価格、販促、税を正確に解決し、計算経路を保存します。", newList: "新規価格表", simulate: "シミュレーション", publish: "版を公開", search: "価格表または適用範囲を検索", ledger: "有効価格台帳", inspector: "解決インスペクター" },
};

function listRow(row: PriceListRow, activeId: string): string {
  const tone = row.state === "Active" ? "success" : row.state === "Scheduled" || row.state === "Draft" ? "warning" : "neutral";
  return `<tr aria-selected="${String(row.id === activeId)}">
    <td><div class="moda-cell"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.code)}</span></div></td>
    <td>${escapeHtml(row.scope)}</td><td>${escapeHtml(row.currency)}</td><td class="moda-number">v${row.version}</td>
    <td>${statusChip(row.state, tone)}</td><td><div class="moda-cell"><strong>${escapeHtml(row.effective)}</strong><span>Immutable version history</span></div></td>
    <td><button class="moda-row-action" type="button" aria-label="Open ${escapeHtml(row.name)}">Open</button></td>
  </tr>`;
}

export function renderPricingTaxAdmin(options: ModAAdminRenderOptions = {}): string {
  const locale = options.locale ?? "en";
  const state = options.state ?? "ready";
  const activeId = options.activeId ?? "retail-gbp";
  const text = copy[locale];
  const selected = priceLists.find((row) => row.id === activeId) ?? priceLists[0]!;
  const rows = state === "empty" ? "" : priceLists.map((row) => listRow(row, activeId)).join("");
  return `${directionContract}<style>${MOD_A_ADMIN_STYLES}</style>
  <section class="moda-shell" dir="${direction(locale)}" lang="${locale}" data-module="pricing-tax" data-state="${state}" aria-label="Pricing and tax control workspace">
    <div class="fixture-notice" role="note"><strong>Synthetic interface fixture</strong><span>Values demonstrate MOD-A controls only and are not production prices or customer data.</span></div>
    <header class="moda-topline"><div><h1>${escapeHtml(text.title)}</h1><p>${escapeHtml(text.intro)}</p></div>
      <div class="moda-actions"><button class="moda-button moda-button--secondary" type="button">Export versions</button><button class="moda-button moda-button--secondary" type="button">${escapeHtml(text.simulate)}</button><button class="moda-button moda-button--primary" type="button">${escapeHtml(text.newList)}</button></div></header>
    <form class="moda-command" aria-label="Pricing filters"><div class="moda-field moda-search"><label for="pricing-search">${escapeHtml(text.search)}</label><span class="moda-search__mark" aria-hidden="true">⌕</span><input id="pricing-search" name="query" type="search" placeholder="RETAIL-GBP" autocomplete="off"></div>
      <div class="moda-field"><label for="pricing-status">Status</label><select id="pricing-status"><option>Active and scheduled</option><option>Draft</option><option>Retired</option></select></div>
      <div class="moda-field"><label for="pricing-channel">Channel</label><select id="pricing-channel"><option>All channels</option><option>POS</option><option>Web</option><option>Wholesale</option></select></div>
      <div class="moda-field"><label for="pricing-currency">Currency</label><select id="pricing-currency"><option>GBP</option></select></div></form>
    ${renderAdminState(state, locale)}
    <section class="moda-workspace"><article class="moda-ledger"><header class="moda-ledger__head"><div><h2>${escapeHtml(text.ledger)}</h2><p>Precedence: customer group → channel → store → legal entity → global.</p></div>${statusChip("No effective overlap", "success")}</header>
      <div class="moda-table-wrap" tabindex="0" role="region" aria-label="Scrollable price list table"><table class="moda-table"><caption class="moda-visually-hidden">Price list versions and scopes</caption><thead><tr><th>Price list</th><th>Scope</th><th>Currency</th><th class="moda-number">Version</th><th>State</th><th>Effective</th><th><span class="moda-visually-hidden">Action</span></th></tr></thead><tbody>${rows}</tbody></table></div></article>
      <aside class="moda-inspector" aria-label="${escapeHtml(text.inspector)}"><header class="moda-inspector__head"><div><h2>${escapeHtml(selected.name)}</h2><p>${escapeHtml(selected.code)} · selected version ${selected.version}</p></div>${statusChip(selected.state, selected.state === "Active" ? "success" : "warning")}</header>
        <div class="moda-tabs" role="tablist" aria-label="Pricing detail sections"><button class="moda-tab" role="tab" aria-selected="true">Resolution</button><button class="moda-tab" role="tab" aria-selected="false">Rules</button><button class="moda-tab" role="tab" aria-selected="false">Promotions</button><button class="moda-tab" role="tab" aria-selected="false">History</button></div>
        <div class="moda-inspector__body"><dl class="moda-detail-grid"><div><dt>Variant</dt><dd>SHIRT-BLUE-M</dd></div><div><dt>Quantity</dt><dd>12 EA</dd></div><div><dt>Channel</dt><dd>POS</dd></div><div><dt>Store</dt><dd>Dhaka Central</dd></div><div><dt>Customer group</dt><dd>Retail</dd></div><div><dt>Business instant</dt><dd>28 Jul 2026 · 10:30</dd></div></dl>
          <h3 class="moda-divider-title">Winning rule</h3><div class="moda-kv"><span>Scope specificity</span><strong>Store + channel</strong></div><div class="moda-kv"><span>Quantity tier</span><strong>10+ EA</strong></div><div class="moda-kv"><span>Rule version</span><strong>v3 · immutable</strong></div>
          <h3 class="moda-divider-title">Exact result</h3><div class="moda-kv"><span>Unit price</span><strong>£8.00</strong></div><div class="moda-kv"><span>Line subtotal</span><strong>£96.00</strong></div><div class="moda-kv"><span>Minimum margin price</span><strong>£7.50</strong></div><div class="moda-kv"><span>Calculation hash</span><strong>7af2…d910</strong></div>
          <div class="moda-actions"><button class="moda-button moda-button--secondary" type="button">Open snapshot</button><button class="moda-button moda-button--primary" type="button">Edit draft rule</button></div></div></aside></section>
    <section class="moda-lower"><article class="moda-simulator"><header class="moda-section-head"><div><h2>Promotion simulator</h2><p>Evaluate targeting, coupons, stacking groups and exact allocation before activation.</p></div>${statusChip("2 applied · 1 rejected", "info")}</header><div class="moda-simulator__body"><div class="moda-field"><label for="coupon-code">Coupon</label><div class="moda-inline-form"><input id="coupon-code" value="SAVE10"><button class="moda-button moda-button--secondary" type="button">Recalculate</button></div></div><div class="moda-kv"><span>Subtotal</span><strong>£96.00</strong></div><div class="moda-kv"><span>SAVE10 · 10%</span><strong>−£9.60</strong></div><div class="moda-kv"><span>Category fixed discount</span><strong>−£1.00</strong></div><div class="moda-kv"><span>Rejected promotion</span><strong>Same stacking group</strong></div><div class="moda-kv moda-total"><span>Price after promotions</span><strong>£85.40</strong></div><p class="moda-note">Every applied promotion retains its version and line-level allocation.</p></div></article>
      <article class="moda-strip"><header class="moda-section-head"><div><h2>Manual discount control</h2><p>Approval is required above the operator threshold or below the margin floor.</p></div>${statusChip("Approval pending", "warning")}</header><div class="moda-strip__body"><div class="moda-kv"><span>Current price</span><strong>£85.40</strong></div><div class="moda-kv"><span>Requested discount</span><strong>£10.00</strong></div><div class="moda-kv"><span>Resulting price</span><strong>£75.40</strong></div><div class="moda-kv"><span>Automatic limit</span><strong>£8.54</strong></div><div class="moda-field"><label for="discount-reason">Reason</label><textarea id="discount-reason">Customer recovery after delayed fulfilment</textarea></div><div class="moda-actions"><button class="moda-button moda-button--danger" type="button">Reject</button><button class="moda-button moda-button--primary" type="button">Approve with audit</button></div></div></article></section>
    <section class="moda-lower"><article class="moda-strip"><header class="moda-section-head"><div><h2>Tax calculation snapshot</h2><p>Jurisdiction, treatment, rate versions and rounding remain explainable.</p></div>${statusChip("Reconciled", "success")}</header><div class="moda-strip__body"><div class="moda-kv"><span>Tax code</span><strong>VAT-STANDARD · v1</strong></div><div class="moda-kv"><span>Jurisdiction</span><strong>GB · Standard</strong></div><div class="moda-kv"><span>Price mode</span><strong>Inclusive</strong></div><div class="moda-kv"><span>Net</span><strong>£80.00</strong></div><div class="moda-kv"><span>VAT 20%</span><strong>£16.00</strong></div><div class="moda-kv moda-total"><span>Gross</span><strong>£96.00</strong></div><p class="moda-note">Net + tax equals gross exactly in minor units. The immutable snapshot can be reused by returns.</p><button class="moda-button moda-button--secondary" type="button">Trace tax components</button></div></article>
      <article class="moda-strip"><header class="moda-section-head"><div><h2>Configuration timeline</h2><p>Published tax and pricing versions cannot be silently edited.</p></div>${statusChip("Next change scheduled", "warning")}</header><div class="moda-strip__body"><ol class="moda-timeline"><li><div><strong>Retail GBP v7 active</strong><span>Published 1 Jul 2026 · all stores</span></div></li><li><div><strong>Dhaka POS v3 scheduled</strong><span>Starts 1 Aug 2026 · approval APR-0042</span></div></li><li><div><strong>VAT-STANDARD v1 active</strong><span>Inclusive · half-up rounding · effective 1 Jan 2026</span></div></li></ol><button class="moda-button moda-button--primary" type="button">${escapeHtml(text.publish)}</button></div></article></section>
    <p class="moda-route-note">Mount contract: export <code>PRICING_TAX_ADMIN_ROUTES</code> into the shared app-shell registry only after the recorded contract-change request is accepted.</p>
  </section>`;
}
