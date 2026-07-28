function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export type FoundationLocale = "en" | "bn" | "ar" | "ja";
export type FoundationUiState = "ready" | "loading" | "empty" | "error" | "denied" | "conflict" | "offline";

export interface FoundationReferenceOptions {
  readonly locale?: FoundationLocale;
  readonly state?: FoundationUiState;
}

interface FoundationCopy {
  readonly preview: string;
  readonly previewDetail: string;
  readonly adminTitle: string;
  readonly adminIntro: string;
  readonly posTitle: string;
  readonly posSubtitle: string;
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
}

const copyByLocale: Record<FoundationLocale, FoundationCopy> = {
  en: {
    preview: "Foundation preview",
    previewDetail: "Synthetic operational data for interface validation only.",
    adminTitle: "Today’s operating picture",
    adminIntro: "Start with exceptions, then trace every decision back to its source record and audit effect.",
    posTitle: "New sale",
    posSubtitle: "Register 02 · Business date 28 Jul 2026",
    searchLabel: "Scan barcode or search products",
    searchPlaceholder: "Barcode, SKU or product name",
  },
  bn: {
    preview: "ফাউন্ডেশন প্রিভিউ",
    previewDetail: "ইন্টারফেস যাচাইয়ের জন্য কৃত্রিম অপারেশনাল তথ্য; এটি কোনো বাস্তব গ্রাহকের তথ্য নয়।",
    adminTitle: "আজকের পরিচালন চিত্র",
    adminIntro: "প্রথমে ব্যতিক্রম ও ঝুঁকি দেখুন, তারপর প্রতিটি সিদ্ধান্তের উৎস নথি ও অডিট প্রভাব অনুসরণ করুন।",
    posTitle: "নতুন বিক্রয়",
    posSubtitle: "রেজিস্টার ০২ · ব্যবসায়িক তারিখ ২৮ জুলাই ২০২৬",
    searchLabel: "বারকোড স্ক্যান করুন অথবা পণ্য খুঁজুন",
    searchPlaceholder: "বারকোড, এসকেইউ অথবা পণ্যের নাম",
  },
  ar: {
    preview: "معاينة الأساس",
    previewDetail: "بيانات تشغيلية اصطناعية للتحقق من الواجهة فقط، وليست بيانات عميل حقيقية.",
    adminTitle: "صورة التشغيل اليوم",
    adminIntro: "ابدأ بالاستثناءات ثم تتبّع كل قرار إلى مستند المصدر وأثر التدقيق الخاص به.",
    posTitle: "عملية بيع جديدة",
    posSubtitle: "نقطة البيع 02 · تاريخ العمل 28 يوليو 2026",
    searchLabel: "امسح الرمز الشريطي أو ابحث عن المنتجات",
    searchPlaceholder: "الرمز الشريطي أو رمز الصنف أو اسم المنتج",
  },
  ja: {
    preview: "基盤プレビュー",
    previewDetail: "画面検証用の合成運用データです。実在する顧客データではありません。",
    adminTitle: "本日の運用状況",
    adminIntro: "例外から確認し、各判断を元文書と監査上の影響まで追跡します。",
    posTitle: "新規販売",
    posSubtitle: "レジ 02 · 営業日 2026年7月28日",
    searchLabel: "バーコードを読み取るか商品を検索",
    searchPlaceholder: "バーコード、SKU、商品名",
  },
};

const stateCopy: Record<FoundationLocale, Record<Exclude<FoundationUiState, "ready">, readonly [string, string, string]>> = {
  en: {
    loading: ["Loading operational data", "The current workspace is being reconciled. Existing actions remain unchanged.", "Loading"],
    empty: ["Nothing requires attention", "No matching work is available in this location and business date.", "Refresh"],
    error: ["Operational data could not be loaded", "The last confirmed values remain visible. Retry without repeating completed actions.", "Retry"],
    denied: ["Permission required", "Your role cannot open this operational view. Request the narrow permission from an administrator.", "Request access"],
    conflict: ["A synchronisation conflict needs review", "Two queued operations affect the same record. Review both versions before posting.", "Review conflict"],
    offline: ["Offline operating mode", "New operations are stored locally and require review after synchronisation.", "View queue"],
  },
  bn: {
    loading: ["অপারেশনাল তথ্য লোড হচ্ছে", "বর্তমান ওয়ার্কস্পেস মিলিয়ে দেখা হচ্ছে; সম্পন্ন কাজ পুনরায় করা হবে না।", "লোড হচ্ছে"],
    empty: ["কোনো কাজ অপেক্ষমাণ নেই", "এই লোকেশন ও ব্যবসায়িক তারিখে মিল পাওয়া কোনো কাজ নেই।", "রিফ্রেশ"],
    error: ["অপারেশনাল তথ্য লোড করা যায়নি", "সর্বশেষ নিশ্চিত তথ্য দৃশ্যমান আছে; সম্পন্ন কাজ পুনরাবৃত্তি না করে আবার চেষ্টা করুন।", "আবার চেষ্টা"],
    denied: ["অনুমতি প্রয়োজন", "আপনার ভূমিকা এই অপারেশনাল ভিউ খুলতে পারে না; প্রশাসকের কাছে নির্দিষ্ট অনুমতি চান।", "অনুমতি চান"],
    conflict: ["সিঙ্ক দ্বন্দ্ব পর্যালোচনা প্রয়োজন", "একই রেকর্ডে দুটি কিউ করা অপারেশন প্রভাব ফেলছে; পোস্ট করার আগে উভয় সংস্করণ দেখুন।", "দ্বন্দ্ব দেখুন"],
    offline: ["অফলাইন অপারেটিং মোড", "নতুন অপারেশন স্থানীয়ভাবে সংরক্ষিত হচ্ছে এবং সিঙ্কের পরে পর্যালোচনা প্রয়োজন।", "কিউ দেখুন"],
  },
  ar: {
    loading: ["جارٍ تحميل بيانات التشغيل", "تتم مطابقة مساحة العمل الحالية دون تكرار الإجراءات المكتملة.", "جارٍ التحميل"],
    empty: ["لا توجد أعمال تتطلب الانتباه", "لا توجد عناصر مطابقة لهذا الموقع وتاريخ العمل.", "تحديث"],
    error: ["تعذر تحميل بيانات التشغيل", "تظل آخر القيم المؤكدة ظاهرة. أعد المحاولة دون تكرار الإجراءات المكتملة.", "إعادة المحاولة"],
    denied: ["يلزم الحصول على إذن", "لا يسمح دورك بفتح هذا العرض. اطلب الإذن المحدد من المسؤول.", "طلب الوصول"],
    conflict: ["تعارض مزامنة يحتاج إلى مراجعة", "تؤثر عمليتان في قائمة الانتظار على السجل نفسه. راجع النسختين قبل الترحيل.", "مراجعة التعارض"],
    offline: ["وضع التشغيل دون اتصال", "تُحفظ العمليات الجديدة محلياً وتحتاج إلى مراجعة بعد المزامنة.", "عرض قائمة الانتظار"],
  },
  ja: {
    loading: ["運用データを読み込み中", "完了済みの操作を繰り返さず、現在のワークスペースを照合しています。", "読み込み中"],
    empty: ["対応が必要な項目はありません", "この拠点と営業日に一致する作業はありません。", "更新"],
    error: ["運用データを読み込めませんでした", "最後に確認された値を表示しています。完了済みの操作を繰り返さず再試行してください。", "再試行"],
    denied: ["権限が必要です", "現在の役割ではこの画面を開けません。管理者に必要最小限の権限を依頼してください。", "アクセス申請"],
    conflict: ["同期競合の確認が必要です", "同じレコードに影響する二つの保留操作があります。転記前に両方を確認してください。", "競合を確認"],
    offline: ["オフライン運用モード", "新しい操作は端末内に保存され、同期後に確認が必要です。", "キューを表示"],
  },
};

function statusChip(label: string, tone: "success" | "warning" | "danger" | "neutral" = "neutral"): string {
  return `<span class="status-chip status-chip--${tone}"><span aria-hidden="true" class="status-chip__dot"></span>${escapeHtml(label)}</span>`;
}

function renderSystemState(state: FoundationUiState, locale: FoundationLocale): string {
  if (state === "ready") return "";
  const [title, body, action] = stateCopy[locale][state];
  const role = state === "error" || state === "denied" || state === "conflict" ? "alert" : "status";
  const mark = state === "loading" ? "…" : state === "empty" ? "0" : state === "error" ? "!" : state === "denied" ? "×" : state === "conflict" ? "↔" : "⇄";
  const busy = state === "loading" ? ' aria-busy="true"' : "";
  const progress = state === "loading" ? '<span class="state-progress" aria-hidden="true"></span>' : "";
  return `<section class="system-state system-state--${state}" role="${role}" aria-live="polite"${busy}><span class="system-state__mark" aria-hidden="true">${mark}</span><div class="system-state__copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span>${progress}</div><button class="system-state__action" type="button">${escapeHtml(action)}</button></section>`;
}

export function renderAdminFoundationReference(options: FoundationReferenceOptions = {}): string {
  const locale = options.locale ?? "en";
  const state = options.state ?? "ready";
  const copy = copyByLocale[locale];
  return `<div class="fixture-notice" role="note"><strong>${escapeHtml(copy.preview)}</strong><span>${escapeHtml(copy.previewDetail)}</span></div>
<section class="page-heading" aria-labelledby="admin-overview-title">
  <div>
    <h1 id="admin-overview-title">${escapeHtml(copy.adminTitle)}</h1>
    <p>${escapeHtml(copy.adminIntro)}</p>
  </div>
  <div class="page-actions" aria-label="Overview actions">
    <button class="button button--secondary" type="button">Export snapshot</button>
    <button class="button button--primary" type="button">Open approval queue</button>
  </div>
</section>
${renderSystemState(state, locale)}
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

export function renderPosFoundationReference(options: FoundationReferenceOptions = {}): string {
  const locale = options.locale ?? "en";
  const state = options.state ?? "ready";
  const copy = copyByLocale[locale];
  return `<div class="fixture-notice" role="note"><strong>${escapeHtml(copy.preview)}</strong><span>${escapeHtml(copy.previewDetail)}</span></div>
<section class="pos-heading" aria-labelledby="checkout-title">
  <div><h1 id="checkout-title">${escapeHtml(copy.posTitle)}</h1><p>${escapeHtml(copy.posSubtitle)}</p></div>
  <div class="pos-heading__state">${statusChip(state === "offline" ? "Offline · 3 queued" : "Online · synced", state === "offline" ? "warning" : "success")}<kbd>F2</kbd><span>Customer</span><kbd>F8</kbd><span>Pay</span></div>
</section>
${renderSystemState(state, locale)}
<div class="checkout-layout">
  <section class="product-workspace" aria-labelledby="product-search-title">
    <div class="scan-panel">
      <label id="product-search-title" for="product-search">${escapeHtml(copy.searchLabel)}</label>
      <div class="scan-input"><span aria-hidden="true">⌁</span><input id="product-search" name="product-search" placeholder="${escapeHtml(copy.searchPlaceholder)}" autocomplete="off"><kbd>Enter</kbd></div>
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
