export interface OperationsLedgerScreenAuthority {
  readonly title: string;
  readonly screenId: string;
  readonly purpose: string;
}

export const OPERATIONS_LEDGER_ADMIN_SCREENS: Readonly<Record<string, OperationsLedgerScreenAuthority>> = Object.freeze({
  "/": { title: "Dashboard", screenId: "8c48a56475564f1ab686ff038939f102", purpose: "Cross-domain operating state, exceptions and close readiness" },
  "/catalog": { title: "Catalog", screenId: "0270cd1ba00d422e978b37edf1ecde4c", purpose: "Products, variants, identifiers and controlled versions" },
  "/catalog/products/:productId": { title: "Product Record", screenId: "b8d92949aa4947fabd7bae161f12c7ce", purpose: "One product record with version and provenance evidence" },
  "/catalog/imports": { title: "Catalog Imports", screenId: "a9278216d57b4ce4a9e0aabe3297e3f8", purpose: "Dry-run validation, row issues and import evidence" },
  "/pricing": { title: "Pricing / Price Lists", screenId: "ae3f726458a14e2b9035700edb785cdb", purpose: "Effective price versions, scope precedence and exact resolution" },
  "/pricing/promotions": { title: "Promotions / Coupons", screenId: "1e97a427975243678e1770ad1ae1d7d7", purpose: "Promotion targeting, coupon state, stacking and allocation" },
  "/pricing/discount-approvals": { title: "Discount Approvals", screenId: "e61c18c065414f7ba88fc1b4a9098944", purpose: "Risk-ordered manual discount approvals with immutable evidence" },
  "/tax": { title: "Tax Configuration", screenId: "8db054f4c8df4fc5ba33265153d432ac", purpose: "Jurisdiction, tax-code versions, rounding and effective rules" },
  "/tax/exemptions": { title: "Tax Exemptions", screenId: "211704307e584c4886cba0b1320866db", purpose: "Exemption scope, expiry, certificate evidence and review state" },
  "/inventory": { title: "Inventory", screenId: "407ec73fe40140298c2b699dfbe38320", purpose: "Derived balances, immutable stock postings and exceptions" },
  "/procurement": { title: "Procurement & Receiving", screenId: "eb91034dcf394937b3bc220a642a3ae6", purpose: "Purchase commitments, receipts, discrepancies and source evidence" },
  "/customers": { title: "Customers", screenId: "80a1ad1a42294324ba3266ce0840d62a", purpose: "Customer records, balances, consent and operational history" },
  "/sales": { title: "Sales Orders & Returns", screenId: "679523e661474af1aeb8211e010e6f6b", purpose: "Orders and returns with lifecycle and financial provenance" },
  "/fulfillment": { title: "Fulfillment", screenId: "290d1debeb654fb3af309a2f0591de3a", purpose: "Allocation, pick-pack-handover state and fulfillment exceptions" },
  "/finance/payments": { title: "Payments & Settlements", screenId: "afd68171244f4bee808e65f4ff03f05c", purpose: "Payment attempts, settlement state, reversals and evidence" },
  "/finance/accounting": { title: "Accounting Ledger", screenId: "ddbbc855416942328883f81d3512b33b", purpose: "Journal evidence, AR/AP effects and immutable accounting entries" },
  "/finance/banking": { title: "Banking & Reconciliation", screenId: "9008f52e9d35442093b6ad54ee88e81f", purpose: "Bank statement matching, unreconciled items and evidence" },
  "/finance/readiness": { title: "Financial Readiness & Close", screenId: "17dbbee401ea4218b38a5700e386ac51", purpose: "Close blockers, readiness controls and sign-off evidence" },
  "/pos/reconciliation": { title: "POS Reconciliation", screenId: "4adf3a5ee74f407fb3e4f5e738a4fa39", purpose: "Register sessions, tender variance and server-confirmed posting state" },
  "/localization": { title: "Localization & Country Packs", screenId: "777284aaba67414e9e7ea619591063c8", purpose: "Locale, currency, fiscal and country-pack effective versions" },
  "/compliance": { title: "Compliance & Evidence", screenId: "8775a0ecfdb043cb9aca69ae605ebec4", purpose: "Controls, evidence, retention and compliance exceptions" },
  "/reporting": { title: "Reporting & Exports", screenId: "a2b6972dac59431598d49a9a541474f7", purpose: "Operational reports, export lineage and freshness state" },
  "/integrations": { title: "Integrations & API", screenId: "20d00caeb29a4e468743e010115db8fd", purpose: "Integration health, API credentials, deliveries and diagnostics" },
  "/platform/saas": { title: "SaaS Platform Operations", screenId: "122b7374077b4c38991e8075dce09ae8", purpose: "Tenant lifecycle, entitlements, metering and platform exceptions" },
});

const ADMIN_SCREEN_STYLES = `<style data-stitch-screen-authority>
.operations-ledger-screen{min-inline-size:0;max-inline-size:100%}
.operations-ledger-screen :is(.moda-shell,.modf-control,.modg-page,.modg-int,.modg-saas){background:transparent!important;padding:0!important;max-inline-size:100%;min-inline-size:0}
.operations-ledger-screen :is(.page-heading,.moda-topline,.modg-hero,.modg-int>header,.modg-saas>header){margin-block-end:1.25rem}
.operations-ledger-screen :is(.page-heading h1,.moda-topline h1){max-inline-size:none;font-size:clamp(1.65rem,2.4vw,2.25rem);line-height:1.08;letter-spacing:-.025em}
.operations-ledger-screen :is(.moda-ledger,.moda-inspector,.moda-strip,.moda-simulator,.modb-table-surface,.work-queue,.trace-panel){border:1px solid var(--line);box-shadow:none!important;background:var(--surface)}
.operations-ledger-screen .moda-command{background:#ece8dc;border:1px solid var(--line-strong);box-shadow:none}
.operations-ledger-screen .moda-route-note{display:none!important}
.operations-ledger-screen .moda-state{border:1px solid var(--line);box-shadow:none}
.operations-ledger-screen .moda-state__progress{position:relative;overflow:hidden;background:var(--accent-soft)!important;background-image:none!important}
.operations-ledger-screen .moda-state__progress::after{content:"";position:absolute;inset-block:0;inset-inline-start:0;inline-size:42%;background:var(--accent);animation:ledger-progress 1.2s ease-in-out infinite alternate}
.operations-ledger-screen :is(.moda-number,.modb-number,.modg-metric__value,td,dd,[data-numeric]){font-variant-numeric:tabular-nums}
.operations-ledger-screen :is(.moda-table-wrap,.table-wrap,.modf-table-wrap,.modg-table-wrap,.modg-int-table,.modg-saas-table){border-color:var(--line);scrollbar-gutter:stable;overscroll-behavior-inline:contain}
.operations-ledger-screen :is(.moda-table-wrap,.table-wrap,.modf-table-wrap,.modg-table-wrap,.modg-int-table,.modg-saas-table) thead th{position:sticky;inset-block-start:0;z-index:2}
.operations-ledger-screen :is(.moda-button,.button,button,a,input,select,textarea):focus-visible{outline:3px solid var(--focus);outline-offset:3px}
.operations-ledger-screen .fixture-notice{background:transparent;border-color:var(--line-strong);box-shadow:none}
@keyframes ledger-progress{from{transform:translateX(-25%)}to{transform:translateX(170%)}}
@media(prefers-reduced-motion:reduce){.operations-ledger-screen .moda-state__progress::after{animation:none;transform:none}}
@media(max-width:1100px){.operations-ledger-screen :is(.moda-workspace,.operations-layout){grid-template-columns:minmax(0,1fr)}}
</style>`;

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function canonicalOperationsLedgerAdminPath(path: string): string {
  const clean = path.split("?", 1)[0]?.split("#", 1)[0] ?? path;
  if (/^\/catalog\/products\/[^/]+\/?$/.test(clean)) return "/catalog/products/:productId";
  return clean.length > 1 && clean.endsWith("/") ? clean.slice(0, -1) : clean;
}

export function resolveOperationsLedgerAdminScreen(path: string): OperationsLedgerScreenAuthority | undefined {
  return OPERATIONS_LEDGER_ADMIN_SCREENS[canonicalOperationsLedgerAdminPath(path)];
}

export function renderOperationsLedgerAdminScreen(path: string, content: string): string {
  const canonicalPath = canonicalOperationsLedgerAdminPath(path);
  const authority = OPERATIONS_LEDGER_ADMIN_SCREENS[canonicalPath];
  if (authority === undefined) return `${ADMIN_SCREEN_STYLES}<section class="operations-ledger-screen" data-ledger-route="${escapeHtml(canonicalPath)}">${content}</section>`;
  return `${ADMIN_SCREEN_STYLES}<section class="operations-ledger-screen" data-ledger-route="${escapeHtml(canonicalPath)}" data-stitch-screen-id="${authority.screenId}" aria-label="${escapeHtml(authority.title)} operational workspace">${content}</section>`;
}
