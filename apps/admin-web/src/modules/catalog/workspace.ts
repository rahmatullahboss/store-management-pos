import { MOD_A_ADMIN_STYLES, direction, escapeHtml, renderAdminState, statusChip, type ModAAdminLocale, type ModAAdminRenderOptions } from "./surface.js";

const directionContract = `<!--
THESIS: Catalog operations keep identifiers, variants and effective conversions traceable; they refuse detached edit forms and destructive lifecycle shortcuts.
OWN-WORLD: The established Operations Ledger shell, warm work surfaces, ledger-green actions, dense product tables and immutable version timelines.
STORY: An operator finds a product by barcode or SKU, inspects its exact version and applies controlled changes without breaking downstream references.
FIRST VIEWPORT: Search and scope controls lead into a product ledger with a sticky adjacent inspector; import and unit controls remain visible below.
FORM: Established operate surface extended as a master-detail catalog control room; no new visual identity or shared primitive is introduced.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

interface CatalogRow {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly sku: string;
  readonly barcode: string;
  readonly variants: number;
  readonly unit: string;
  readonly status: "Active" | "Draft" | "Inactive";
  readonly updated: string;
}

const rows: readonly CatalogRow[] = Object.freeze([
  { id: "oxford-shirt", name: "Oxford shirt", code: "SHIRT-001", sku: "SHIRT-BLUE-M", barcode: "1234567890128", variants: 8, unit: "EA", status: "Active", updated: "12 min ago" },
  { id: "arabica-coffee", name: "Arabica coffee", code: "COFFEE-250", sku: "COFFEE-250G", barcode: "5012345678900", variants: 4, unit: "PACK", status: "Active", updated: "34 min ago" },
  { id: "delivery-service", name: "Express delivery", code: "SERVICE-EXP", sku: "SERVICE-EXP", barcode: "Internal", variants: 1, unit: "JOB", status: "Draft", updated: "2 h ago" },
  { id: "summer-bundle", name: "Summer essentials kit", code: "BUNDLE-SUM", sku: "BUNDLE-SUM-01", barcode: "9988776655443", variants: 1, unit: "KIT", status: "Inactive", updated: "Yesterday" },
]);

const copy: Record<ModAAdminLocale, { title: string; intro: string; newProduct: string; import: string; export: string; search: string; products: string; detail: string }> = {
  en: { title: "Catalog operations", intro: "Control products, variants, units and identifiers without losing version history.", newProduct: "New product", import: "Import", export: "Export", search: "Search SKU, barcode or name", products: "Product ledger", detail: "Product inspector" },
  bn: { title: "ক্যাটালগ অপারেশন", intro: "সংস্করণের ইতিহাস অক্ষুণ্ণ রেখে পণ্য, ভ্যারিয়েন্ট, ইউনিট ও পরিচিতি নিয়ন্ত্রণ করুন।", newProduct: "নতুন পণ্য", import: "ইমপোর্ট", export: "এক্সপোর্ট", search: "SKU, বারকোড বা নাম খুঁজুন", products: "পণ্য লেজার", detail: "পণ্য পরিদর্শন" },
  ar: { title: "عمليات الكتالوج", intro: "تحكم في المنتجات والمتغيرات والوحدات والمعرّفات مع الحفاظ على سجل الإصدارات.", newProduct: "منتج جديد", import: "استيراد", export: "تصدير", search: "البحث بالرمز أو الباركود أو الاسم", products: "سجل المنتجات", detail: "فاحص المنتج" },
  ja: { title: "カタログ運用", intro: "版履歴を保ったまま商品、バリエーション、単位、識別子を管理します。", newProduct: "新規商品", import: "取込", export: "出力", search: "SKU・バーコード・名称で検索", products: "商品台帳", detail: "商品インスペクター" },
};

function rowMarkup(row: CatalogRow, activeId: string): string {
  const tone = row.status === "Active" ? "success" : row.status === "Draft" ? "warning" : "neutral";
  return `<tr aria-selected="${String(row.id === activeId)}">
    <td><div class="moda-cell"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.code)}</span></div></td>
    <td><div class="moda-cell"><strong>${escapeHtml(row.sku)}</strong><span>${escapeHtml(row.barcode)}</span></div></td>
    <td class="moda-number">${row.variants}</td><td>${escapeHtml(row.unit)}</td><td>${statusChip(row.status, tone)}</td>
    <td><div class="moda-cell"><strong>v${row.status === "Draft" ? "1" : "7"}</strong><span>${escapeHtml(row.updated)}</span></div></td>
    <td><button class="moda-row-action" type="button" aria-label="Open ${escapeHtml(row.name)}">Open</button></td>
  </tr>`;
}

export function renderCatalogAdmin(options: ModAAdminRenderOptions = {}): string {
  const locale = options.locale ?? "en";
  const state = options.state ?? "ready";
  const activeId = options.activeId ?? "oxford-shirt";
  const text = copy[locale];
  const selected = rows.find((row) => row.id === activeId) ?? rows[0]!;
  const tableRows = state === "empty" ? "" : rows.map((row) => rowMarkup(row, activeId)).join("");
  return `${directionContract}<style>${MOD_A_ADMIN_STYLES}</style>
  <section class="moda-shell" dir="${direction(locale)}" lang="${locale}" data-module="catalog" data-state="${state}" aria-label="Catalog operations workspace">
    <div class="fixture-notice" role="note"><strong>Synthetic interface fixture</strong><span>Values demonstrate MOD-A controls only and are not production catalog or customer data.</span></div>
    <header class="moda-topline"><div><h1>${escapeHtml(text.title)}</h1><p>${escapeHtml(text.intro)}</p></div>
      <div class="moda-actions"><button class="moda-button moda-button--secondary" type="button">${escapeHtml(text.export)}</button><button class="moda-button moda-button--secondary" type="button">${escapeHtml(text.import)}</button><button class="moda-button moda-button--primary" type="button">${escapeHtml(text.newProduct)}</button></div></header>
    <form class="moda-command" aria-label="Catalog filters"><div class="moda-field moda-search"><label for="catalog-search">${escapeHtml(text.search)}</label><span class="moda-search__mark" aria-hidden="true">⌕</span><input id="catalog-search" name="query" type="search" placeholder="SHIRT-BLUE-M" autocomplete="off"></div>
      <div class="moda-field"><label for="catalog-status">Status</label><select id="catalog-status"><option>All statuses</option><option>Active</option><option>Draft</option><option>Inactive</option></select></div>
      <div class="moda-field"><label for="catalog-kind">Kind</label><select id="catalog-kind"><option>All kinds</option><option>Stock</option><option>Service</option><option>Bundle</option></select></div>
      <div class="moda-field"><label for="catalog-locale">Locale</label><select id="catalog-locale"><option>en-GB</option><option>bn-BD</option><option>ar-SA</option><option>ja-JP</option></select></div></form>
    ${renderAdminState(state, locale)}
    <section class="moda-workspace"><article class="moda-ledger"><header class="moda-ledger__head"><div><h2>${escapeHtml(text.products)}</h2><p>4 visible · 3 controlled changes pending</p></div>${statusChip("250k-ready index", "info")}</header>
      <div class="moda-table-wrap" tabindex="0" role="region" aria-label="Scrollable catalog product table"><table class="moda-table"><caption class="moda-visually-hidden">Catalog products and variants</caption><thead><tr><th>Product</th><th>SKU / barcode</th><th class="moda-number">Variants</th><th>Unit</th><th>Status</th><th>Version</th><th><span class="moda-visually-hidden">Action</span></th></tr></thead><tbody>${tableRows}</tbody></table></div></article>
      <aside class="moda-inspector" aria-label="${escapeHtml(text.detail)}"><header class="moda-inspector__head"><div><h2>${escapeHtml(selected.name)}</h2><p>${escapeHtml(selected.code)} · optimistic version 7</p></div>${statusChip(selected.status, selected.status === "Active" ? "success" : "warning")}</header>
        <div class="moda-tabs" role="tablist" aria-label="Product detail sections"><button class="moda-tab" role="tab" aria-selected="true">Overview</button><button class="moda-tab" role="tab" aria-selected="false">Variants</button><button class="moda-tab" role="tab" aria-selected="false">Attributes</button><button class="moda-tab" role="tab" aria-selected="false">Media</button></div>
        <div class="moda-inspector__body"><dl class="moda-detail-grid"><div><dt>Default locale</dt><dd>en-GB</dd></div><div><dt>Tax code</dt><dd>VAT-STANDARD</dd></div><div><dt>Stock unit</dt><dd>EA</dd></div><div><dt>Tracking</dt><dd>None</dd></div><div><dt>Primary SKU</dt><dd>${escapeHtml(selected.sku)}</dd></div><div><dt>Primary barcode</dt><dd>${escapeHtml(selected.barcode)}</dd></div></dl>
          <h3 class="moda-divider-title">Variant axes</h3><div class="moda-kv"><span>Colour</span><strong>Blue · White · Red · Black</strong></div><div class="moda-kv"><span>Size</span><strong>S · M</strong></div>
          <h3 class="moda-divider-title">Version trail</h3><ol class="moda-timeline"><li><div><strong>Version 7 published</strong><span>Barcode validation and Bengali name · 12 min ago</span></div></li><li><div><strong>Version 6</strong><span>Added supplier reference SUP-184 · yesterday</span></div></li><li><div><strong>Version 5</strong><span>Unit conversion PACK → EA activated · 3 days ago</span></div></li></ol>
          <div class="moda-actions"><button class="moda-button moda-button--secondary" type="button">Compare versions</button><button class="moda-button moda-button--primary" type="button">Edit draft</button></div></div></aside></section>
    <section class="moda-lower"><article class="moda-strip"><header class="moda-section-head"><div><h2>Import control</h2><p>Dry-run validation before any database write.</p></div>${statusChip("2 warnings", "warning")}</header><div class="moda-strip__body"><div class="moda-kv"><span>File</span><strong>summer-catalog.csv</strong></div><div class="moda-kv"><span>Accepted products</span><strong>1,248</strong></div><div class="moda-kv"><span>Rejected rows</span><strong>0</strong></div><p class="moda-note">Source hash and row-level issues are retained with the import audit record.</p><div class="moda-actions"><button class="moda-button moda-button--secondary" type="button">Download issues</button><button class="moda-button moda-button--primary" type="button">Execute import</button></div></div></article>
      <article class="moda-strip"><header class="moda-section-head"><div><h2>Units and conversions</h2><p>Append-only effective versions; exact representation required.</p></div>${statusChip("No overlap", "success")}</header><div class="moda-strip__body"><div class="moda-kv"><span>PACK → EA</span><strong>1 : 12 · v3</strong></div><div class="moda-kv"><span>KG → G</span><strong>1 : 1,000 · v1</strong></div><div class="moda-kv"><span>Effective next</span><strong>1 Aug 2026</strong></div><button class="moda-button moda-button--secondary" type="button">Manage conversions</button></div></article></section>
    <p class="moda-route-note">Mount contract: export <code>CATALOG_ADMIN_ROUTES</code> into the shared app-shell registry after the recorded contract-change request is accepted.</p>
  </section>`;
}
