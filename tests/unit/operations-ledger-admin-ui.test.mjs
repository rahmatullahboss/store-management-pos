import test from "node:test";
import assert from "node:assert/strict";
import {
  renderAdminDashboardPage,
  renderCatalogAdminPage,
  renderCatalogImportsAdminPage,
  renderDiscountApprovalsAdminPage,
  renderPricingAdminPage,
  renderProductRecordAdminPage,
  renderPromotionsAdminPage,
  renderTaxConfigurationAdminPage,
  renderTaxExemptionsAdminPage,
} from "../../build/apps/admin-web/src/app-shell/index.js";
import {
  OPERATIONS_LEDGER_ADMIN_SCREENS,
  canonicalOperationsLedgerAdminPath,
  resolveOperationsLedgerAdminScreen,
} from "../../build/packages/ui/src/operations-ledger-screens.js";

const permissions = new Set([
  "catalog.product.read",
  "catalog.import.execute",
  "pricing.price.read",
  "pricing.promotion.manage",
  "pricing.discount.approve",
  "tax.calculation.read",
  "tax.exemption.manage",
  "inventory.stock.read",
  "procurement.purchase_order.read",
  "customer.profile.read",
  "sales.order.read",
  "fulfillment.plan.read",
  "payment.read",
  "accounting.read",
  "banking.read",
  "platform.audit.read",
  "pos.sync.read",
  "localization.country_pack.read",
  "compliance.evidence.read",
  "reporting.read",
  "integration.read",
  "platform.saas.read",
]);

const shell = {
  displayName: "Operations Admin",
  tenantName: "Ozzyl Retail Group",
  permissions,
  location: "Dhaka Flagship",
  businessDate: "Business date · 03 Aug 2026",
  locale: "en",
};

test("Stitch authority registry covers every required admin/back-office surface", () => {
  assert.equal(Object.keys(OPERATIONS_LEDGER_ADMIN_SCREENS).length, 24);
  for (const path of [
    "/",
    "/catalog",
    "/catalog/products/:productId",
    "/catalog/imports",
    "/pricing",
    "/pricing/promotions",
    "/pricing/discount-approvals",
    "/tax",
    "/tax/exemptions",
    "/inventory",
    "/procurement",
    "/customers",
    "/sales",
    "/fulfillment",
    "/finance/payments",
    "/finance/accounting",
    "/finance/banking",
    "/finance/readiness",
    "/pos/reconciliation",
    "/localization",
    "/compliance",
    "/reporting",
    "/integrations",
    "/platform/saas",
  ]) {
    const authority = OPERATIONS_LEDGER_ADMIN_SCREENS[path];
    assert.ok(authority, `missing Stitch authority for ${path}`);
    assert.match(authority.screenId, /^[a-f0-9]{32}$/);
    assert.ok(authority.purpose.length > 20);
  }
});

test("dynamic Product Record paths resolve to the Product Record Stitch authority", () => {
  assert.equal(canonicalOperationsLedgerAdminPath("/catalog/products/oxford-shirt?tab=versions"), "/catalog/products/:productId");
  assert.equal(resolveOperationsLedgerAdminScreen("/catalog/products/oxford-shirt")?.title, "Product Record");
});

test("Dashboard is a dedicated evidence-first operational page rather than the foundation preview", () => {
  const html = renderAdminDashboardPage(shell);
  assert.match(html, /data-stitch-screen-id="8c48a56475564f1ab686ff038939f102"/);
  assert.match(html, /Operations Dashboard/);
  assert.match(html, /Risk-ordered operating queue/);
  assert.match(html, /Reconciliation evidence/);
  assert.match(html, /Close readiness control matrix/);
  assert.doesNotMatch(html, /chart|canvas/i);
});

test("Catalog, Product Record and Catalog Imports render as distinct Stitch-focused pages", () => {
  const catalog = renderCatalogAdminPage(shell);
  const product = renderProductRecordAdminPage(shell, "oxford-shirt");
  const imports = renderCatalogImportsAdminPage(shell);

  assert.match(catalog, /data-stitch-screen-id="0270cd1ba00d422e978b37edf1ecde4c"/);
  assert.match(catalog, /<h1>Catalog<\/h1>/);
  assert.match(catalog, /Product ledger/);

  assert.match(product, /data-stitch-screen-id="b8d92949aa4947fabd7bae161f12c7ce"/);
  assert.match(product, /<h1>Product Record<\/h1>/);
  assert.match(product, /moda-stitch-view--product-record/);
  assert.match(product, /Version trail/);

  assert.match(imports, /data-stitch-screen-id="a9278216d57b4ce4a9e0aabe3297e3f8"/);
  assert.match(imports, /<h1>Catalog Imports<\/h1>/);
  assert.match(imports, /Dry-run validation/);
  assert.match(imports, /Source hash and row-level issues/);
});

test("Pricing, promotions, approvals and tax use separate route compositions", () => {
  const pricing = renderPricingAdminPage(shell);
  const promotions = renderPromotionsAdminPage(shell);
  const approvals = renderDiscountApprovalsAdminPage(shell);
  const tax = renderTaxConfigurationAdminPage(shell);

  assert.match(pricing, /data-stitch-screen-id="ae3f726458a14e2b9035700edb785cdb"/);
  assert.match(pricing, /<h1>Pricing \/ Price Lists<\/h1>/);
  assert.match(pricing, /Effective price ledger/);

  assert.match(promotions, /data-stitch-screen-id="1e97a427975243678e1770ad1ae1d7d7"/);
  assert.match(promotions, /<h1>Promotions \/ Coupons<\/h1>/);
  assert.match(promotions, /Promotion simulator/);

  assert.match(approvals, /data-stitch-screen-id="e61c18c065414f7ba88fc1b4a9098944"/);
  assert.match(approvals, /<h1>Discount Approvals<\/h1>/);
  assert.match(approvals, /Manual discount control/);
  assert.match(approvals, /Approve with audit/);

  assert.match(tax, /data-stitch-screen-id="8db054f4c8df4fc5ba33265153d432ac"/);
  assert.match(tax, /<h1>Tax Configuration<\/h1>/);
  assert.match(tax, /Tax calculation snapshot/);
  assert.match(tax, /Trace tax components/);
});

test("Tax Exemptions has its own evidence registry and semantic state surface", () => {
  const html = renderTaxExemptionsAdminPage(shell);
  assert.match(html, /data-stitch-screen-id="211704307e584c4886cba0b1320866db"/);
  assert.match(html, /<h1>Tax Exemptions<\/h1>/);
  assert.match(html, /Exemption registry/);
  assert.match(html, /Certificate evidence/);
  assert.match(html, /Tax authority evidence/);
  assert.match(html, /font-variant-numeric:tabular-nums/);
});

test("Bengali and Arabic route-specific headings remain supported with RTL-safe shell composition", () => {
  const bn = renderCatalogImportsAdminPage({ ...shell, locale: "bn" }, { locale: "bn" });
  const ar = renderPromotionsAdminPage({ ...shell, locale: "ar", direction: "rtl" }, { locale: "ar" });
  assert.match(bn, /ক্যাটালগ ইমপোর্ট/u);
  assert.match(ar, /العروض \/ القسائم/u);
  assert.match(ar, /dir="rtl"/);
});
