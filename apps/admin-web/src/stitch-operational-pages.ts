import {
  renderLedgerEvidenceRail,
  renderLedgerSignalBand,
  renderLedgerState,
  renderLedgerStatus,
  type LedgerEvidenceItem,
  type LedgerSurfaceState,
} from "../../../packages/ui/src/operations-ledger.js";
import { renderCatalogAdmin } from "./modules/catalog/workspace.js";
import type { ModAAdminLocale, ModAAdminRenderOptions } from "./modules/catalog/surface.js";
import { renderPricingTaxAdmin, type PricingTaxAdminRenderOptions } from "./modules/pricing/workspace.js";

export type CatalogStitchView = "catalog" | "product-record" | "catalog-imports";
export type PricingStitchView = "pricing" | "promotions" | "discount-approvals" | "tax";

const focusStyles = `<style data-stitch-route-focus>
.moda-stitch-view .moda-route-note{display:none!important}
.moda-stitch-view--product-record .moda-command,
.moda-stitch-view--product-record .moda-ledger,
.moda-stitch-view--product-record .moda-lower{display:none!important}
.moda-stitch-view--product-record .moda-workspace{grid-template-columns:minmax(0,1fr)}
.moda-stitch-view--product-record .moda-inspector{inline-size:100%;max-inline-size:none}
.moda-stitch-view--catalog-imports .moda-command,
.moda-stitch-view--catalog-imports .moda-workspace{display:none!important}
.moda-stitch-view--catalog-imports .moda-lower{grid-template-columns:minmax(0,1fr)}
.moda-stitch-view--catalog-imports .moda-lower>article:nth-child(2){display:none!important}
.moda-stitch-view--pricing .moda-workspace~.moda-lower{display:none!important}
.moda-stitch-view--promotions .moda-workspace,
.moda-stitch-view--discount-approvals .moda-workspace,
.moda-stitch-view--tax .moda-workspace{display:none!important}
.moda-stitch-view--promotions .moda-workspace+.moda-lower>article:nth-child(2){display:none!important}
.moda-stitch-view--promotions .moda-workspace+.moda-lower+.moda-lower{display:none!important}
.moda-stitch-view--discount-approvals .moda-workspace+.moda-lower>article:nth-child(1){display:none!important}
.moda-stitch-view--discount-approvals .moda-workspace+.moda-lower+.moda-lower{display:none!important}
.moda-stitch-view--tax .moda-workspace+.moda-lower{display:none!important}
.moda-stitch-view--promotions .moda-lower,
.moda-stitch-view--discount-approvals .moda-lower,
.moda-stitch-view--tax .moda-lower{grid-template-columns:minmax(0,1fr)}
</style>`;

const catalogTitles: Record<ModAAdminLocale, Record<CatalogStitchView, readonly [string, string]>> = {
  en: {
    catalog: ["Catalog", "Operate products, variants, units and identifiers from a dense versioned ledger."],
    "product-record": ["Product Record", "Inspect one product, its variants, identifiers and immutable version trail."],
    "catalog-imports": ["Catalog Imports", "Validate source files, row issues and hashes before controlled catalog writes."],
  },
  bn: {
    catalog: ["ক্যাটালগ", "ভার্সনযুক্ত লেজার থেকে পণ্য, ভ্যারিয়েন্ট, ইউনিট ও পরিচিতি পরিচালনা করুন।"],
    "product-record": ["পণ্য রেকর্ড", "একটি পণ্যের ভ্যারিয়েন্ট, পরিচিতি ও অপরিবর্তনীয় ভার্সন ট্রেইল পর্যালোচনা করুন।"],
    "catalog-imports": ["ক্যাটালগ ইমপোর্ট", "ক্যাটালগে লেখার আগে সোর্স ফাইল, সারি-সমস্যা ও হ্যাশ যাচাই করুন।"],
  },
  ar: {
    catalog: ["الكتالوج", "إدارة المنتجات والمتغيرات والوحدات والمعرّفات من سجل كثيف ذي إصدارات."],
    "product-record": ["سجل المنتج", "راجع منتجاً واحداً ومتغيراته ومعرّفاته ومسار إصداراته غير القابل للتغيير."],
    "catalog-imports": ["استيراد الكتالوج", "تحقق من الملفات المصدرية ومشكلات الصفوف والبصمات قبل الكتابة المضبوطة."],
  },
  ja: {
    catalog: ["カタログ", "版管理された高密度台帳から商品、バリエーション、単位、識別子を運用します。"],
    "product-record": ["商品レコード", "単一商品のバリエーション、識別子、不変の版履歴を確認します。"],
    "catalog-imports": ["カタログ取込", "管理された書き込み前にソース、行エラー、ハッシュを検証します。"],
  },
};

const pricingTitles: Record<ModAAdminLocale, Record<PricingStitchView, readonly [string, string]>> = {
  en: {
    pricing: ["Pricing / Price Lists", "Resolve effective price versions by scope, precedence and exact arithmetic."],
    promotions: ["Promotions / Coupons", "Review targeting, coupon state, stacking decisions and exact allocation."],
    "discount-approvals": ["Discount Approvals", "Process threshold exceptions with reason, margin evidence and auditable approval."],
    tax: ["Tax Configuration", "Inspect jurisdiction, treatment, rate versions, rounding and exact tax snapshots."],
  },
  bn: {
    pricing: ["প্রাইসিং / প্রাইস লিস্ট", "স্কোপ, অগ্রাধিকার ও নির্ভুল হিসাব অনুযায়ী কার্যকর মূল্য নির্ধারণ করুন।"],
    promotions: ["প্রোমোশন / কুপন", "টার্গেটিং, কুপন স্টেট, স্ট্যাকিং সিদ্ধান্ত ও নির্ভুল বরাদ্দ পর্যালোচনা করুন।"],
    "discount-approvals": ["ডিসকাউন্ট অনুমোদন", "কারণ, মার্জিন এভিডেন্স ও অডিটযোগ্য অনুমোদনসহ থ্রেশহোল্ড ব্যতিক্রম পরিচালনা করুন।"],
    tax: ["ট্যাক্স কনফিগারেশন", "জুরিসডিকশন, ট্রিটমেন্ট, রেট ভার্সন, রাউন্ডিং ও ট্যাক্স স্ন্যাপশট পর্যালোচনা করুন।"],
  },
  ar: {
    pricing: ["التسعير / قوائم الأسعار", "حل الإصدارات الفعالة حسب النطاق والأولوية والحساب الدقيق."],
    promotions: ["العروض / القسائم", "راجع الاستهداف وحالة القسيمة وقرارات التكديس والتخصيص الدقيق."],
    "discount-approvals": ["موافقات الخصم", "عالج الاستثناءات مع السبب ودليل الهامش والموافقة القابلة للتدقيق."],
    tax: ["إعداد الضريبة", "راجع الولاية والمعالجة وإصدارات المعدلات والتقريب ولقطات الضريبة الدقيقة."],
  },
  ja: {
    pricing: ["価格 / 価格表", "適用範囲、優先順位、正確な算術で有効な価格版を解決します。"],
    promotions: ["販促 / クーポン", "対象、クーポン状態、併用判断、正確な配賦を確認します。"],
    "discount-approvals": ["値引き承認", "理由、マージン証跡、監査可能な承認で閾値例外を処理します。"],
    tax: ["税設定", "管轄、処理、税率版、丸め、正確な税スナップショットを確認します。"],
  },
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function focusModAWorkspace(rendered: string, view: string, title: string, intro: string): string {
  const classed = rendered.replace('<section class="moda-shell"', `<section class="moda-shell moda-stitch-view moda-stitch-view--${view}"`);
  const topLine = /<header class="moda-topline"><div><h1>[\s\S]*?<\/h1><p>[\s\S]*?<\/p><\/div>/;
  return `${focusStyles}${classed.replace(topLine, `<header class="moda-topline"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(intro)}</p></div>`)}`;
}

export function renderCatalogStitchPage(view: CatalogStitchView, options: ModAAdminRenderOptions = {}): string {
  const locale = options.locale ?? "en";
  const [title, intro] = catalogTitles[locale][view];
  return focusModAWorkspace(renderCatalogAdmin(options), view, title, intro);
}

export function renderPricingStitchPage(view: PricingStitchView, options: PricingTaxAdminRenderOptions = {}): string {
  const locale = options.locale ?? "en";
  const [title, intro] = pricingTitles[locale][view];
  return focusModAWorkspace(renderPricingTaxAdmin(options), view, title, intro);
}

export interface OperationsDashboardQueueRow {
  readonly domain: string;
  readonly task: string;
  readonly source: string;
  readonly state: "healthy" | "attention" | "blocked";
  readonly age: string;
  readonly owner: string;
}

export interface OperationsDashboardInput {
  readonly state: LedgerSurfaceState;
  readonly reconciledAt: string;
  readonly locationsOnline: string;
  readonly registersOpen: string;
  readonly openExceptions: number;
  readonly closeReadiness: string;
  readonly queue: readonly OperationsDashboardQueueRow[];
  readonly evidence: readonly LedgerEvidenceItem[];
  readonly message?: string;
}

export function operationsDashboardFixture(): OperationsDashboardInput {
  return {
    state: "ready",
    reconciledAt: "03 Aug 2026 · 14:20",
    locationsOnline: "12 / 12",
    registersOpen: "18",
    openExceptions: 7,
    closeReadiness: "4 controls pending",
    queue: [
      { domain: "Inventory", task: "Negative availability override", source: "RSV-10482 · Dhaka Central", state: "blocked", age: "12 min", owner: "Stock control" },
      { domain: "Payments", task: "Settlement variance requires evidence", source: "SET-20260803-14", state: "attention", age: "31 min", owner: "Finance ops" },
      { domain: "Procurement", task: "Receiving discrepancy pending", source: "GRN-000184", state: "attention", age: "44 min", owner: "Receiving" },
      { domain: "Catalog", task: "Import warnings awaiting decision", source: "IMP-20260803-07", state: "healthy", age: "1 h", owner: "Catalog ops" },
    ],
    evidence: [
      { label: "Operational cursor", value: "OPS-20260803-1420", detail: "Cross-domain projection cursor" },
      { label: "Inventory reconciliation", value: "REC-INV-8841", detail: "No unexplained balance drift" },
      { label: "Settlement batch", value: "SET-20260803-14", detail: "One variance requires review" },
      { label: "Close control set", value: "CLOSE-20260803", detail: "Four controls remain open" },
    ],
  };
}

function dashboardState(data: OperationsDashboardInput): string {
  if (data.state === "ready") return "";
  const copy: Record<Exclude<LedgerSurfaceState, "ready">, readonly [string, string, string]> = {
    loading: ["Restoring operational state", "Current projections and evidence are being loaded. No control action has been repeated.", "Refresh"],
    empty: ["No operating activity in scope", "Change location or business-date scope to inspect another operating period.", "Change scope"],
    error: ["Operational state unavailable", "Confirmed evidence remains authoritative. Retry without repeating a financial or stock write.", "Retry safely"],
    denied: ["Permission required", "Your role cannot view the cross-domain operating dashboard.", "Review access"],
    offline: ["Offline review mode", "Only locally available confirmed evidence is shown; server-dependent controls remain visibly unavailable.", "Open sync state"],
    conflict: ["Projection conflict requires review", "Two sources disagree. Resolve the evidence conflict before treating the dashboard as reconciled.", "Review conflict"],
  };
  const [title, detail, actionLabel] = copy[data.state];
  return renderLedgerState({ state: data.state, title, detail: data.message ?? detail, actionLabel });
}

function dashboardTone(state: OperationsDashboardQueueRow["state"]): "success" | "warning" | "danger" {
  if (state === "blocked") return "danger";
  if (state === "attention") return "warning";
  return "success";
}

export function renderOperationsDashboard(data: OperationsDashboardInput = operationsDashboardFixture()): string {
  const rows = data.queue.map((item) => `<tr><td>${renderLedgerStatus(item.state === "blocked" ? "Blocked" : item.state === "attention" ? "Attention" : "Controlled", dashboardTone(item.state))}</td><td><strong>${escapeHtml(item.task)}</strong><span class="cell-detail">${escapeHtml(item.source)}</span></td><td>${escapeHtml(item.domain)}</td><td data-numeric>${escapeHtml(item.age)}</td><td>${escapeHtml(item.owner)}</td><td><button class="row-action" type="button">Open evidence</button></td></tr>`).join("");
  return `<header class="page-heading"><div><h1>Operations Dashboard</h1><p>Run the store estate from exceptions, reconciled projections and evidence—not decorative charts.</p></div><div class="page-actions"><button class="button button--secondary" type="button">Export control state</button><button class="button button--primary" type="button">Review close blockers</button></div></header>
  ${renderLedgerSignalBand("Operating state reconciled", `Last cross-domain reconciliation ${data.reconciledAt}.`, [
    { label: "Locations online", value: data.locationsOnline },
    { label: "Registers open", value: data.registersOpen },
    { label: "Exceptions", value: String(data.openExceptions), detail: data.closeReadiness },
  ])}
  ${dashboardState(data)}
  <div class="operations-layout"><section class="work-queue"><div class="section-heading"><div><h2>Risk-ordered operating queue</h2><p>Blocked and attention items stay ahead of routine work, with source evidence beside every action.</p></div>${renderLedgerStatus(`${data.openExceptions} open`, data.openExceptions > 0 ? "warning" : "success")}</div><div class="table-wrap" tabindex="0" role="region" aria-label="Operational exceptions table"><table><thead><tr><th>State</th><th>Task and source</th><th>Domain</th><th>Age</th><th>Owner</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div></section>${renderLedgerEvidenceRail("Reconciliation evidence", data.evidence)}</div>
  <section class="work-queue" style="margin-block-start:1.2rem"><div class="section-heading"><div><h2>Close readiness control matrix</h2><p>Readiness is evidence-backed and remains separate from accounting completion.</p></div>${renderLedgerStatus(data.closeReadiness, data.openExceptions > 0 ? "warning" : "success")}</div><div class="table-wrap"><table><thead><tr><th>Control</th><th>Authority</th><th>Current state</th><th>Evidence</th><th>Next action</th></tr></thead><tbody><tr><td><strong>Stock reconciliation</strong></td><td>Inventory ledger</td><td>${renderLedgerStatus("Reconciled", "success")}</td><td>REC-INV-8841</td><td>None</td></tr><tr><td><strong>Payment settlement</strong></td><td>Settlement ledger</td><td>${renderLedgerStatus("Attention", "warning")}</td><td>SET-20260803-14</td><td>Resolve variance</td></tr><tr><td><strong>POS sessions</strong></td><td>Register ledger</td><td>${renderLedgerStatus("Controlled", "success")}</td><td>POS-REC-3381</td><td>Review late register</td></tr><tr><td><strong>Financial close</strong></td><td>Close control set</td><td>${renderLedgerStatus("Pending", "warning")}</td><td>CLOSE-20260803</td><td>Complete four controls</td></tr></tbody></table></div></section>`;
}

export interface TaxExemptionRecord {
  readonly customer: string;
  readonly reference: string;
  readonly jurisdiction: string;
  readonly scope: string;
  readonly expires: string;
  readonly state: "active" | "review" | "expired";
  readonly evidence: string;
}

export interface TaxExemptionsPageInput {
  readonly state: LedgerSurfaceState;
  readonly records: readonly TaxExemptionRecord[];
  readonly evidence: readonly LedgerEvidenceItem[];
  readonly message?: string;
}

export function taxExemptionsFixture(): TaxExemptionsPageInput {
  return {
    state: "ready",
    records: [
      { customer: "Dhaka Export Services", reference: "CUST-00418", jurisdiction: "BD", scope: "VAT · export service", expires: "31 Dec 2026", state: "active", evidence: "CERT-BD-99184" },
      { customer: "Northstar Relief", reference: "CUST-00807", jurisdiction: "GB", scope: "VAT · qualifying supply", expires: "15 Aug 2026", state: "review", evidence: "CERT-GB-22017" },
      { customer: "Legacy Trade Account", reference: "CUST-00192", jurisdiction: "GB", scope: "VAT · historic exemption", expires: "30 Jun 2026", state: "expired", evidence: "CERT-GB-10411" },
    ],
    evidence: [
      { label: "Certificate store", value: "TAX-EVIDENCE-2026", detail: "Versioned exemption certificates and hashes" },
      { label: "Policy version", value: "TAX-EXEMPT-v4", detail: "Effective 01 Jul 2026" },
      { label: "Review queue", value: "TAX-REVIEW-008", detail: "One certificate expires within review window" },
    ],
  };
}

export function renderTaxExemptionsPage(data: TaxExemptionsPageInput = taxExemptionsFixture()): string {
  const rows = data.state === "empty" ? "" : data.records.map((row) => {
    const tone = row.state === "active" ? "success" : row.state === "review" ? "warning" : "danger";
    return `<tr><td><strong>${escapeHtml(row.customer)}</strong><span class="cell-detail">${escapeHtml(row.reference)}</span></td><td>${escapeHtml(row.jurisdiction)}</td><td>${escapeHtml(row.scope)}</td><td data-numeric>${escapeHtml(row.expires)}</td><td>${renderLedgerStatus(row.state === "active" ? "Active" : row.state === "review" ? "Review" : "Expired", tone)}</td><td><strong>${escapeHtml(row.evidence)}</strong><span class="cell-detail">Certificate evidence</span></td><td><button type="button" class="row-action">Review</button></td></tr>`;
  }).join("");
  const nonReady = data.state === "ready" ? "" : renderLedgerState({
    state: data.state,
    title: data.state === "empty" ? "No tax exemptions in this scope" : data.state === "offline" ? "Offline exemption review" : data.state === "denied" ? "Permission required" : data.state === "conflict" ? "Exemption evidence conflict" : data.state === "loading" ? "Loading exemption evidence" : "Tax exemption data unavailable",
    detail: data.message ?? (data.state === "offline" ? "Confirmed certificates remain readable; creation and approval wait for server confirmation." : "Review the current evidence state before changing exemption authority."),
    actionLabel: data.state === "loading" ? "Loading" : "Review state",
    actionDisabled: data.state === "loading",
  });
  const attention = data.records.filter((record) => record.state !== "active").length;
  return `<header class="page-heading"><div><h1>Tax Exemptions</h1><p>Control exemption scope, certificate evidence, effective dates and expiry without silently bypassing tax authority.</p></div><div class="page-actions"><button class="button button--secondary" type="button">Export evidence</button><button class="button button--primary" type="button">Add exemption</button></div></header>${renderLedgerSignalBand("Exemption evidence controlled", "Only valid, scoped and evidenced exemptions may affect tax calculation.", [{ label: "Records", value: String(data.records.length) }, { label: "Attention", value: String(attention) }, { label: "Policy", value: "v4" }])}${nonReady}<div class="operations-layout"><section class="work-queue"><div class="section-heading"><div><h2>Exemption registry</h2><p>Expiry and evidence state remain visible in the operating table.</p></div>${renderLedgerStatus(`${attention} attention`, attention > 0 ? "warning" : "success")}</div><div class="table-wrap" tabindex="0" role="region" aria-label="Tax exemption registry"><table><thead><tr><th>Customer</th><th>Jurisdiction</th><th>Scope</th><th>Expires</th><th>State</th><th>Evidence</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div></section>${renderLedgerEvidenceRail("Tax authority evidence", data.evidence)}</div>`;
}
