export type ModAAdminLocale = "en" | "bn" | "ar" | "ja";
export type ModAAdminState = "ready" | "loading" | "empty" | "error" | "denied" | "conflict" | "offline";

export interface ModAAdminRenderOptions {
  readonly locale?: ModAAdminLocale;
  readonly state?: ModAAdminState;
  readonly activeId?: string;
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function direction(locale: ModAAdminLocale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function statusChip(label: string, tone: "success" | "warning" | "danger" | "neutral" | "info" = "neutral"): string {
  return `<span class="moda-chip moda-chip--${tone}"><span class="moda-chip__dot" aria-hidden="true"></span>${escapeHtml(label)}</span>`;
}

const stateCopy: Record<ModAAdminLocale, Record<Exclude<ModAAdminState, "ready">, readonly [string, string, string]>> = {
  en: {
    loading: ["Loading the workspace", "Current versions and pending writes are being reconciled.", "Loading"],
    empty: ["No records match this view", "Change the filters or create the first controlled record.", "Clear filters"],
    error: ["The workspace could not refresh", "Confirmed values remain visible. Retry without repeating completed writes.", "Retry refresh"],
    denied: ["Permission required", "Your role cannot open this control surface. Request the narrow permission shown in the audit trail.", "Request access"],
    conflict: ["A version conflict needs review", "Another operator saved a newer version. Compare both versions before replacing anything.", "Compare versions"],
    offline: ["Offline review mode", "Read-only confirmed data is available. Publishing and imports resume after synchronisation.", "View sync queue"],
  },
  bn: {
    loading: ["ওয়ার্কস্পেস লোড হচ্ছে", "বর্তমান সংস্করণ ও অপেক্ষমাণ লেখা মিলিয়ে দেখা হচ্ছে।", "লোড হচ্ছে"],
    empty: ["এই ভিউতে কোনো রেকর্ড নেই", "ফিল্টার বদলান অথবা প্রথম নিয়ন্ত্রিত রেকর্ড তৈরি করুন।", "ফিল্টার পরিষ্কার"],
    error: ["ওয়ার্কস্পেস রিফ্রেশ করা যায়নি", "সর্বশেষ নিশ্চিত তথ্য দৃশ্যমান আছে; সম্পন্ন লেখা পুনরায় না করে চেষ্টা করুন।", "আবার রিফ্রেশ"],
    denied: ["অনুমতি প্রয়োজন", "আপনার ভূমিকা এই নিয়ন্ত্রণ ভিউ খুলতে পারে না; অডিট ট্রেইলে দেখানো নির্দিষ্ট অনুমতি চান।", "অনুমতি চান"],
    conflict: ["সংস্করণ দ্বন্দ্ব পর্যালোচনা প্রয়োজন", "অন্য অপারেটর নতুন সংস্করণ সংরক্ষণ করেছেন; কিছু বদলানোর আগে তুলনা করুন।", "সংস্করণ তুলনা"],
    offline: ["অফলাইন পর্যালোচনা মোড", "সর্বশেষ নিশ্চিত তথ্য শুধু পড়া যাবে; সিঙ্কের পরে প্রকাশ ও ইমপোর্ট চালু হবে।", "সিঙ্ক কিউ দেখুন"],
  },
  ar: {
    loading: ["جارٍ تحميل مساحة العمل", "تتم مطابقة الإصدارات الحالية وعمليات الكتابة المعلّقة.", "جارٍ التحميل"],
    empty: ["لا توجد سجلات مطابقة", "غيّر عوامل التصفية أو أنشئ أول سجل مضبوط.", "مسح عوامل التصفية"],
    error: ["تعذر تحديث مساحة العمل", "تظل القيم المؤكدة ظاهرة. أعد المحاولة دون تكرار عمليات مكتملة.", "إعادة المحاولة"],
    denied: ["يلزم الحصول على إذن", "لا يسمح دورك بفتح سطح التحكم هذا. اطلب الإذن المحدد الظاهر في سجل التدقيق.", "طلب الوصول"],
    conflict: ["تعارض إصدار يحتاج إلى مراجعة", "حفظ مشغّل آخر إصداراً أحدث. قارن الإصدارين قبل الاستبدال.", "مقارنة الإصدارات"],
    offline: ["وضع مراجعة دون اتصال", "تتوفر البيانات المؤكدة للقراءة فقط. يستأنف النشر والاستيراد بعد المزامنة.", "عرض قائمة المزامنة"],
  },
  ja: {
    loading: ["ワークスペースを読み込み中", "現在の版と保留中の書き込みを照合しています。", "読み込み中"],
    empty: ["一致するレコードがありません", "絞り込みを変更するか、最初の管理対象レコードを作成してください。", "絞り込みを解除"],
    error: ["ワークスペースを更新できません", "確認済みの値は表示されています。完了した書き込みを繰り返さず再試行してください。", "再試行"],
    denied: ["権限が必要です", "現在の役割ではこの画面を開けません。監査履歴に示された最小権限を申請してください。", "アクセス申請"],
    conflict: ["版の競合を確認してください", "別の担当者が新しい版を保存しました。上書きする前に比較してください。", "版を比較"],
    offline: ["オフライン確認モード", "確認済みデータを読み取り専用で表示しています。同期後に公開と取込を再開します。", "同期キュー"],
  },
};

export function renderAdminState(state: ModAAdminState, locale: ModAAdminLocale): string {
  if (state === "ready") return "";
  const [title, detail, action] = stateCopy[locale][state];
  const role = state === "error" || state === "denied" || state === "conflict" ? "alert" : "status";
  return `<section class="moda-state moda-state--${state}" role="${role}" aria-live="polite"${state === "loading" ? ' aria-busy="true"' : ""}>
    <div class="moda-state__copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>${state === "loading" ? '<span class="moda-state__progress" aria-hidden="true"></span>' : ""}</div>
    <button class="moda-button moda-button--secondary" type="button"${state === "loading" ? " disabled" : ""}>${escapeHtml(action)}</button>
  </section>`;
}

export const MOD_A_ADMIN_STYLES = `
.moda-shell{--moda-ink:var(--ink,#17231e);--moda-muted:var(--muted,#59675f);--moda-paper:var(--paper,#f5f3ec);--moda-panel:var(--surface,#fffefa);--moda-line:var(--line,#d7ddd8);--moda-deep:var(--rail,#14251e);--moda-accent:var(--accent,#1f6a51);--moda-warn:var(--attention,#8a5a00);--moda-danger:var(--danger,#9b2c2c);--moda-info:var(--accent,#1f6a51);--moda-radius:var(--radius,14px);color:var(--moda-ink);background:var(--moda-paper);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.45;min-height:100%;padding:24px}
.moda-shell *{box-sizing:border-box}.moda-shell button,.moda-shell input,.moda-shell select,.moda-shell textarea{font:inherit}.moda-shell button,.moda-shell a{touch-action:manipulation}.moda-shell :focus-visible{outline:3px solid #276e8f;outline-offset:2px}
.moda-topline{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-block-end:20px}.moda-topline h1{font-size:clamp(1.8rem,3vw,2.8rem);line-height:1.05;letter-spacing:-.03em;margin:0 0 8px}.moda-topline p{max-width:72ch;color:var(--moda-muted);margin:0}.moda-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap}
.moda-button{border:0;border-radius:10px;min-height:42px;padding:10px 15px;font-weight:700;cursor:pointer}.moda-button:disabled{cursor:not-allowed;opacity:.55}.moda-button--primary{background:var(--moda-deep);color:#fff}.moda-button--primary:hover{background:#0f3227}.moda-button--secondary{background:var(--moda-panel);color:var(--moda-ink);box-shadow:0 2px 8px rgba(23,33,29,.12)}.moda-button--secondary:hover{box-shadow:0 4px 12px rgba(23,33,29,.17)}.moda-button--danger{background:#fff1f0;color:var(--moda-danger)}
.moda-command{display:grid;grid-template-columns:minmax(220px,1fr) repeat(3,minmax(130px,auto));gap:10px;align-items:end;background:#e9e4d8;padding:12px;border-radius:var(--moda-radius);margin-block-end:16px}.moda-field{display:grid;gap:6px}.moda-field label{font-size:.78rem;font-weight:800;color:#405049}.moda-field input,.moda-field select,.moda-field textarea{width:100%;min-height:42px;border:1px solid #aaa394;border-radius:9px;background:var(--moda-panel);color:var(--moda-ink);padding:9px 11px}.moda-field textarea{min-height:88px;resize:vertical}.moda-search{position:relative}.moda-search input{padding-inline-start:38px}.moda-search__mark{position:absolute;inset-inline-start:12px;inset-block-end:11px;color:var(--moda-muted);font-weight:800}
.moda-state{display:flex;align-items:center;justify-content:space-between;gap:18px;border-radius:var(--moda-radius);background:var(--moda-panel);box-shadow:0 3px 12px rgba(23,33,29,.13);padding:15px 17px;margin-block-end:16px}.moda-state__copy{display:grid;gap:3px}.moda-state__copy span{color:var(--moda-muted)}.moda-state--error,.moda-state--conflict{background:#fff3f1}.moda-state--denied{background:#fff8e8}.moda-state--offline{background:#edf5f7}.moda-state__progress{display:block;height:3px;width:min(280px,60vw);background:linear-gradient(90deg,var(--moda-deep) 45%,#d2cdc1 45%);background-size:220% 100%;animation:moda-progress 1.2s ease-out infinite;margin-block-start:8px;border-radius:99px}@keyframes moda-progress{to{background-position:-120% 0}}@media(prefers-reduced-motion:reduce){.moda-state__progress{animation:none}}
.moda-workspace{display:grid;grid-template-columns:minmax(520px,1.55fr) minmax(310px,.85fr);gap:16px;align-items:start;min-width:0}.moda-workspace>*,.moda-lower>*{min-width:0}.moda-ledger,.moda-inspector,.moda-strip,.moda-simulator{min-width:0;background:var(--moda-panel);border-radius:var(--moda-radius);box-shadow:0 4px 16px rgba(23,33,29,.13)}.moda-ledger{overflow:hidden}.moda-ledger__head,.moda-inspector__head,.moda-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:17px 18px;border-bottom:1px solid var(--moda-line)}.moda-ledger__head>div,.moda-inspector__head>div,.moda-section-head>div{min-width:0}.moda-ledger__head h2,.moda-inspector__head h2,.moda-section-head h2{font-size:1.1rem;margin:0;overflow-wrap:anywhere}.moda-ledger__head p,.moda-inspector__head p,.moda-section-head p{font-size:.86rem;color:var(--moda-muted);margin:4px 0 0;overflow-wrap:anywhere}.moda-table-wrap{width:100%;max-width:100%;min-width:0;overflow:auto;overscroll-behavior-inline:contain}.moda-table{width:100%;border-collapse:collapse;min-width:720px}.moda-table th{background:#ece7dc;color:#43514b;text-align:start;font-size:.74rem;text-transform:uppercase;letter-spacing:.04em;padding:10px 13px;position:sticky;top:0}.moda-table td{padding:12px 13px;border-bottom:1px solid #e5e0d5;vertical-align:middle}.moda-table tr[aria-selected="true"]{background:#edf4ef}.moda-table tbody tr:hover{background:#f1eee6}.moda-cell{display:grid;gap:2px}.moda-cell strong{font-size:.91rem}.moda-cell span{font-size:.78rem;color:var(--moda-muted)}.moda-number{text-align:end;font-variant-numeric:tabular-nums}.moda-row-action{border:0;background:transparent;color:var(--moda-deep);font-weight:800;cursor:pointer;padding:7px}
.moda-chip{display:inline-flex;align-items:center;gap:7px;max-width:100%;border-radius:99px;padding:5px 9px;font-size:.75rem;font-weight:800;white-space:normal;overflow-wrap:anywhere;background:#ece9e1;color:#445149}.moda-chip__dot{width:7px;height:7px;border-radius:50%;background:currentColor}.moda-chip--success{background:#e6f2e9;color:#27633e}.moda-chip--warning{background:#fff1cf;color:var(--moda-warn)}.moda-chip--danger{background:#fde5e4;color:var(--moda-danger)}.moda-chip--info{background:#e4f0f5;color:var(--moda-info)}
.moda-inspector{position:sticky;top:16px}.moda-inspector__body{padding:17px 18px}.moda-tabs{display:flex;gap:4px;overflow:auto;border-bottom:1px solid var(--moda-line);padding-inline:12px}.moda-tab{border:0;background:transparent;padding:11px 9px;color:var(--moda-muted);font-weight:750;white-space:nowrap;cursor:pointer}.moda-tab[aria-selected="true"]{color:var(--moda-deep);box-shadow:inset 0 -3px 0 var(--moda-accent)}.moda-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.moda-detail-grid div{display:grid;gap:3px;padding-block-end:9px;border-bottom:1px solid #e7e2d7}.moda-detail-grid dt{font-size:.73rem;color:var(--moda-muted);font-weight:750}.moda-detail-grid dd{margin:0;font-weight:700;overflow-wrap:anywhere}.moda-timeline{list-style:none;margin:16px 0 0;padding:0;display:grid;gap:0}.moda-timeline li{display:grid;grid-template-columns:14px 1fr;gap:10px;padding-block-end:15px}.moda-timeline li:before{content:"";width:9px;height:9px;border-radius:50%;background:var(--moda-deep);margin-block-start:5px;box-shadow:0 0 0 4px #dce9e1}.moda-timeline li:not(:last-child) div{border-bottom:1px solid var(--moda-line);padding-block-end:13px}.moda-timeline strong,.moda-timeline span{display:block}.moda-timeline span{font-size:.78rem;color:var(--moda-muted);margin-block-start:3px}
.moda-lower{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-block-start:16px;min-width:0}.moda-strip__body,.moda-simulator__body{min-width:0;padding:16px 18px}.moda-kv{display:flex;align-items:baseline;justify-content:space-between;gap:16px;min-width:0;padding:9px 0;border-bottom:1px solid #e7e2d7}.moda-kv:last-child{border-bottom:0}.moda-kv span{min-width:0;color:var(--moda-muted);overflow-wrap:anywhere}.moda-kv strong{min-width:0;text-align:end;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.moda-total{font-size:1.15rem;color:var(--moda-deep)}.moda-note{font-size:.8rem;color:var(--moda-muted);margin:12px 0 0}.moda-divider-title{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--moda-muted);margin:17px 0 8px}.moda-inline-form{display:grid;grid-template-columns:1fr auto;gap:8px}.moda-inline-form input{min-width:0}.moda-empty-inline{display:flex;align-items:flex-start;gap:9px;background:#f0ede5;border-radius:10px;padding:12px;color:var(--moda-muted);font-size:.84rem}
.moda-route-note{margin-block-start:16px;padding:12px 14px;background:#e9e4d8;border-radius:12px;color:#43514b;font-size:.82rem}.moda-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
[dir="rtl"] .moda-table th,[dir="rtl"] .moda-table td{text-align:right}[dir="rtl"] .moda-number{text-align:left}
@media(max-width:1180px){.moda-workspace{grid-template-columns:1fr}.moda-inspector{position:static}.moda-command{grid-template-columns:1fr 1fr}.moda-lower{grid-template-columns:1fr}}
@media(max-width:620px){.moda-shell{padding:14px}.moda-topline{display:grid}.moda-actions{justify-content:flex-start}.moda-command{grid-template-columns:1fr}.moda-state{align-items:flex-start;display:grid}.moda-detail-grid{grid-template-columns:1fr}.moda-table{min-width:650px}}
`;
