import {
  renderAccountingAdminPage,
  renderAdminShell,
  renderBankingAdminPage,
  renderComplianceAdminPage,
  renderFinanceReadinessAdminPage,
  renderFulfillmentAdminPage,
  renderIntegrationsAdminPage,
  renderLocalizationAdminPage,
  renderPaymentsAdminPage,
  renderPosReconciliationAdminPage,
  renderReportingAdminPage,
  renderSaasOperationsAdminPage,
  type AdminShellInput,
} from "../../admin-web/src/app-shell/index.js";
import { renderCatalogAdmin } from "../../admin-web/src/modules/catalog/workspace.js";
import { renderPricingTaxAdmin } from "../../admin-web/src/modules/pricing/workspace.js";
import type { AccountingControlPage } from "../../admin-web/src/modules/accounting/page.js";
import type { BankReconciliationPage } from "../../admin-web/src/modules/banking/page.js";
import type { FulfillmentWorkspaceInput } from "../../admin-web/src/modules/fulfillment/surface.js";
import type { IntegrationConsolePage } from "../../admin-web/src/modules/integrations/page.js";
import type { LocalizationControlPage } from "../../admin-web/src/modules/localization/page.js";
import type { PaymentOperationsPage, PaymentOperationsRow } from "../../admin-web/src/modules/payments/page.js";
import type { PosReconciliationPage } from "../../admin-web/src/modules/pos/reconciliation-page.js";
import type { FinanceMoney } from "../../admin-web/src/modules/reporting/finance-ui.js";
import type { FinanceReadinessPage } from "../../admin-web/src/modules/reporting/finance-readiness-page.js";
import type { ReportingOperationsPage } from "../../admin-web/src/modules/reporting/operations-page.js";
import type { SaasAdminPage } from "../../admin-web/src/modules/saas-admin/page.js";
import type { StagingOperationalData } from "./staging-operational-data.js";

export const CONNECTED_ADMIN_PATHS = Object.freeze([
  "/catalog/products/:productId",
  "/catalog/imports",
  "/catalog/units",
  "/pricing",
  "/pricing/promotions",
  "/pricing/discount-approvals",
  "/tax",
  "/tax/exemptions",
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
] as const);

const OBSERVED_AT = "30 Jul 2026 · live staging query";
const BUSINESS_DATE = "30 Jul 2026";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hasPermission(data: StagingOperationalData, permission: string): boolean {
  return data.context.permissions.includes(permission);
}

function money(amountMinor = "0"): FinanceMoney {
  return { amountMinor, currency: "BDT", scale: 2 };
}

const BENGALI_DIGITS: Readonly<Record<string, string>> = Object.freeze({
  "০": "0",
  "১": "1",
  "২": "2",
  "৩": "3",
  "৪": "4",
  "৫": "5",
  "৬": "6",
  "৭": "7",
  "৮": "8",
  "৯": "9",
});

function displayMoneyToMinor(display: string): string {
  const normalized = [...display]
    .map((character) => BENGALI_DIGITS[character] ?? character)
    .join("")
    .replaceAll(",", "")
    .replaceAll("−", "-");
  const negative = normalized.includes("-");
  const numeric = normalized.replace(/[^0-9.]/gu, "");
  if (!numeric) return "0";
  const [whole = "0", fraction = ""] = numeric.split(".");
  const minor = BigInt(whole || "0") * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2) || "0");
  return (negative ? -minor : minor).toString();
}

function paymentStatus(value: string): PaymentOperationsRow["status"] {
  const normalized = value.toLowerCase().replaceAll(" ", "_");
  if (normalized === "paid" || normalized === "captured" || normalized === "settled") return "captured";
  if (normalized === "authorized") return "authorized";
  if (normalized === "refunded") return "refunded";
  if (normalized === "partially_refunded") return "partially_refunded";
  if (normalized === "failed" || normalized === "declined") return "failed";
  return "unknown";
}

function paymentPage(data: StagingOperationalData): PaymentOperationsPage {
  const rows = data.sales.orders.map((order) => ({
    paymentId: `sales-order:${order.id}`,
    customerReference: order.documentNumber,
    provider: "Sales order snapshot",
    amount: money(displayMoneyToMinor(order.total)),
    status: paymentStatus(order.paymentStatus),
    updatedAt: BUSINESS_DATE,
  }));
  const capturedTotal = rows
    .filter((row) => row.status === "captured")
    .reduce((total, row) => total + BigInt(row.amount.amountMinor), 0n);
  const refundTotal = rows
    .filter((row) => row.status === "refunded" || row.status === "partially_refunded")
    .reduce((total, row) => total + BigInt(row.amount.amountMinor), 0n);
  return {
    refreshedAt: OBSERVED_AT,
    capturedTotal: money(capturedTotal.toString()),
    refundTotal: money(refundTotal.toString()),
    unknownCount: rows.filter((row) => row.status === "unknown").length,
    rows,
  };
}

function accountingPage(data: StagingOperationalData): AccountingControlPage {
  return {
    refreshedAt: OBSERVED_AT,
    periodId: "staging-unposted-2026-07",
    periodCode: "STAGING · UNPOSTED",
    periodStatus: "open",
    totalDebit: money(),
    totalCredit: money(),
    rows: [],
    openReceivableCount: data.sales.orders.filter((order) => !["paid", "captured", "settled", "refunded"].includes(order.paymentStatus.toLowerCase())).length,
    openPayableCount: data.procurement.purchaseOrders.length,
  };
}

function bankingPage(): BankReconciliationPage {
  return {
    bankAccountId: "staging-not-connected",
    bankAccountName: "No production bank account connected",
    refreshedAt: OBSERVED_AT,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-30",
    statementTotal: money(),
    matchedTotal: money(),
    difference: money(),
    rows: [],
  };
}

function fulfillmentPage(data: StagingOperationalData): FulfillmentWorkspaceInput {
  const tasks = data.sales.orders
    .filter((order) => !["fulfilled", "cancelled", "returned"].includes(order.fulfillmentStatus.toLowerCase()))
    .map((order) => ({
      id: order.id,
      orderNumber: order.documentNumber,
      method: "pickup" as const,
      status: order.fulfillmentStatus,
      itemCount: 1,
      dueLabel: "Current business date",
    }));
  return {
    locale: "en-GB",
    direction: "ltr",
    state: tasks.length > 0 ? "ready" : "empty",
    tasks,
  };
}

function financeReadinessPage(data: StagingOperationalData): FinanceReadinessPage {
  return {
    overall: "degraded",
    generatedAt: OBSERVED_AT,
    checks: [
      {
        code: "FIN-DB-CONTEXT",
        label: "Tenant-scoped database context",
        status: "pass",
        observed: data.context.tenant.name,
        expected: "Database-resolved tenant and location scope",
        detail: "Operational reads use the authenticated PostgreSQL request context.",
      },
      {
        code: "FIN-EXACT-MONEY",
        label: "Exact money presentation",
        status: "pass",
        observed: data.dashboard.salesOrderValue,
        expected: "Integer minor-unit source values",
        detail: "Sales and procurement exposure is rendered without binary floating point.",
      },
      {
        code: "FIN-PRODUCTION-COMMANDS",
        label: "Production finance commands",
        status: "warning",
        observed: "Disabled in persistent staging",
        expected: "Independent provider, recovery and owner approval evidence",
        detail: "Payment, refund, posting, banking and fiscal mutations remain fail closed.",
      },
    ],
  };
}

function posReconciliationPage(data: StagingOperationalData): PosReconciliationPage {
  return {
    refreshedAt: OBSERVED_AT,
    locationLabel: "Synthetic Dhaka Store",
    rejectedCount: 0,
    reviewCount: 0,
    adjustedCount: 0,
    pendingDeviceCount: data.pos.pendingOperations > 0 ? 1 : 0,
    rows: [],
  };
}

function localizationPage(data: StagingOperationalData): LocalizationControlPage {
  const activePack = {
    packId: "bd-primary",
    countryCode: "BD",
    version: "1.0.0",
    supportLevel: "limited" as const,
    lifecycleStatus: "active" as const,
    defaultLocale: "bn-BD",
    effectiveFrom: "2026-07-29",
    offlineLegalCapability: "cash_only" as const,
    fiscalSubmission: false,
    electronicInvoicing: false,
    limitations: [
      "Local legal, tax and accounting validation is not yet approved.",
      "Production fiscal and electronic-invoice providers are not connected.",
    ],
  };
  return {
    state: "ready",
    scopeLabel: `${data.context.tenant.name} · Synthetic Dhaka Store`,
    refreshedAt: OBSERVED_AT,
    activePack,
    packs: [activePack],
    queue: [],
    legalNumbersRemaining: "Not allocated for production",
    unknownFiscalCount: 0,
    pendingPrivacyCount: 0,
    immutableDocumentCount: data.sales.orders.length,
    dataResidencySummary: "Dedicated non-production Neon and Cloudflare resources; production residency approval pending.",
    canManagePacks: hasPermission(data, "localization.pack.manage"),
    canManageCompliance: hasPermission(data, "localization.compliance.manage"),
  };
}

function reportingPage(data: StagingOperationalData): ReportingOperationsPage {
  const exceptions = [];
  if (data.dashboard.lowStockCount > 0) {
    exceptions.push({
      exceptionId: "inventory-low-stock",
      severity: "medium" as const,
      title: `${data.dashboard.lowStockCount} catalog lines need stock attention`,
      owner: "Inventory",
      ageLabel: "Current",
      href: "/inventory",
    });
  }
  if (data.dashboard.openPurchaseOrders > 0) {
    exceptions.push({
      exceptionId: "procurement-open-orders",
      severity: "low" as const,
      title: `${data.dashboard.openPurchaseOrders} purchase orders remain open`,
      owner: "Procurement",
      ageLabel: "Current",
      href: "/procurement",
    });
  }
  return {
    state: "ready",
    audience: "owner",
    tenantName: data.context.tenant.name,
    scopeLabel: "Synthetic Dhaka Store",
    businessDateLabel: BUSINESS_DATE,
    generatedAtLabel: OBSERVED_AT,
    timeZone: "Asia/Dhaka",
    currency: "BDT",
    metrics: [
      {
        metricId: "catalog.active_products",
        label: "Active products",
        value: String(data.dashboard.productCount),
        unit: "products",
        periodLabel: "Current",
        version: "staging-v1",
        freshnessLabel: "Live query",
        health: "fresh",
        reconciled: true,
        controlTotal: String(data.catalog.length),
        drillThroughHref: "/catalog",
      },
      {
        metricId: "inventory.available_units",
        label: "Available units",
        value: data.dashboard.availableUnits,
        unit: "EA",
        periodLabel: "Current",
        version: "staging-v1",
        freshnessLabel: "Live query",
        health: "fresh",
        reconciled: true,
        controlTotal: data.dashboard.inventoryValue,
        drillThroughHref: "/inventory",
      },
      {
        metricId: "procurement.open_orders",
        label: "Open purchase orders",
        value: String(data.dashboard.openPurchaseOrders),
        unit: "orders",
        periodLabel: "Current",
        version: "staging-v1",
        freshnessLabel: "Live query",
        health: "fresh",
        reconciled: true,
        controlTotal: data.dashboard.openPurchaseValue,
        drillThroughHref: "/procurement",
      },
      {
        metricId: "sales.active_orders",
        label: "Active sales orders",
        value: String(data.dashboard.activeSalesOrders),
        unit: "orders",
        periodLabel: "Current",
        version: "staging-v1",
        freshnessLabel: "Live query",
        health: "fresh",
        reconciled: true,
        controlTotal: data.dashboard.salesOrderValue,
        drillThroughHref: "/sales",
      },
    ],
    exceptions,
    exports: [],
    canRequestExport: hasPermission(data, "reporting.export.request"),
  };
}

function integrationsPage(data: StagingOperationalData): IntegrationConsolePage {
  return {
    state: "ready",
    tenantName: data.context.tenant.name,
    observedAtLabel: OBSERVED_AT,
    connections: [],
    webhooks: [],
    canManage: hasPermission(data, "integration.connector.manage"),
    canReplay: hasPermission(data, "integration.webhook.replay"),
  };
}

function saasPage(data: StagingOperationalData): SaasAdminPage {
  return {
    state: "ready",
    observedAtLabel: OBSERVED_AT,
    subscription: {
      tenantId: data.context.tenant.id,
      tenantName: data.context.tenant.name,
      planName: "Release candidate",
      planVersion: "staging-v1",
      status: "trial",
      periodLabel: "Non-production staging",
      version: "1",
    },
    usage: [
      {
        meterCode: "catalog.active_products",
        label: "Active products",
        quantity: String(data.dashboard.productCount),
        enforcement: "observe",
        periodLabel: "Current",
      },
      {
        meterCode: "customer.active_profiles",
        label: "Active customers",
        quantity: String(data.dashboard.activeCustomers),
        enforcement: "observe",
        periodLabel: "Current",
      },
      {
        meterCode: "sales.active_orders",
        label: "Active sales orders",
        quantity: String(data.dashboard.activeSalesOrders),
        enforcement: "observe",
        periodLabel: "Current",
      },
    ],
    lifecycle: [],
    rollouts: [],
    incidents: [],
    impersonation: [],
    canManageSubscription: hasPermission(data, "saas.subscription.manage"),
    canManageLifecycle: hasPermission(data, "saas.lifecycle.manage"),
    canManageSupport: hasPermission(data, "saas.support.manage"),
  };
}

function catalogWorkspace(localPath: string, base: AdminShellInput): string {
  return renderAdminShell({
    ...base,
    currentPath: localPath,
    content: renderCatalogAdmin({ locale: "en", state: "ready" }),
  });
}

function pricingWorkspace(localPath: string, base: AdminShellInput): string {
  return renderAdminShell({
    ...base,
    currentPath: localPath,
    content: renderPricingTaxAdmin({ locale: "en", state: "ready" }),
  });
}

export function renderConnectedAdminPage(
  localPath: string,
  base: AdminShellInput,
  data: StagingOperationalData,
): string | null {
  if (localPath.startsWith("/catalog/products/") || localPath === "/catalog/imports" || localPath === "/catalog/units") {
    return catalogWorkspace(localPath, base);
  }
  if (["/pricing", "/pricing/promotions", "/pricing/discount-approvals", "/tax", "/tax/exemptions"].includes(localPath)) {
    return pricingWorkspace(localPath, base);
  }
  if (localPath === "/fulfillment") return renderFulfillmentAdminPage(base, fulfillmentPage(data));
  if (localPath === "/finance/payments") return renderPaymentsAdminPage(base, paymentPage(data));
  if (localPath === "/finance/accounting") return renderAccountingAdminPage(base, accountingPage(data));
  if (localPath === "/finance/banking") return renderBankingAdminPage(base, bankingPage());
  if (localPath === "/finance/readiness") return renderFinanceReadinessAdminPage(base, financeReadinessPage(data));
  if (localPath === "/pos/reconciliation") return renderPosReconciliationAdminPage(base, posReconciliationPage(data));
  if (localPath === "/localization") return renderLocalizationAdminPage(base, localizationPage(data));
  if (localPath === "/compliance") return renderComplianceAdminPage(base, localizationPage(data));
  if (localPath === "/reporting") return renderReportingAdminPage(base, reportingPage(data));
  if (localPath === "/integrations") return renderIntegrationsAdminPage(base, integrationsPage(data));
  if (localPath === "/platform/saas") return renderSaasOperationsAdminPage(base, saasPage(data));
  return null;
}

export function renderAdminNotFoundPage(base: AdminShellInput, localPath: string): string {
  const content = `<style>.web-not-found{display:grid;gap:1rem;padding:clamp(1rem,3vw,2.5rem);background:var(--surface,#fffefa);border-radius:14px}.web-not-found h1{margin:0;font-size:clamp(2rem,4vw,3.5rem);line-height:1}.web-not-found p{max-width:68ch;color:var(--ink-soft,#405049)}.web-not-found code{overflow-wrap:anywhere}.web-not-found a{display:inline-flex;align-items:center;min-height:44px;width:max-content;padding:.65rem .9rem;background:var(--accent,#1f6a51);color:#fff;border-radius:9px;font-weight:800;text-decoration:none}</style><section class="web-not-found" role="alert"><h1>Page not found</h1><p>The requested Admin route <code>${escapeHtml(localPath)}</code> is not registered for this release candidate. No command was executed.</p><a href="/">Return to operations dashboard</a></section>`;
  return renderAdminShell({ ...base, currentPath: localPath, content });
}
