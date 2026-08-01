import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

import { hardenAdminDocumentAccessibility } from "../../build/apps/api/src/staging-admin-accessibility.js";
import { renderConnectedAdminPage } from "../../build/apps/api/src/staging-connected-admin-pages.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "docs", "architecture", "foundation", "design-evidence");
const reportPath = path.join(outputDir, "main-web-e2e-report.json");
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");

const permissions = [
  "catalog.product.read",
  "catalog.import.execute",
  "catalog.unit.manage",
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
  "localization.pack.read",
  "localization.document.read",
  "reporting.metric.read",
  "integration.connector.read",
  "saas.subscription.read",
];

const base = {
  displayName: "Synthetic Main Web Operator",
  tenantName: "Synthetic Main Web Tenant",
  permissions: new Set(permissions),
  currentPath: "/",
  content: "",
  direction: "ltr",
  location: "Synthetic Dhaka Store",
  businessDate: "Release candidate · 30 Jul 2026",
  locale: "en-GB",
  offline: false,
};

const data = {
  context: {
    user: {
      id: "018f0000-0000-7000-8000-000000009001",
      email: "main-web@example.invalid",
      name: "Synthetic Main Web Operator",
    },
    tenant: {
      id: "018f0000-0000-7000-8000-000000000002",
      name: "Synthetic Main Web Tenant",
    },
    role: "staging-read-only",
    permissions,
    scope: {
      legalEntityId: "018f0000-0000-7000-8000-000000000003",
      storeId: "018f0000-0000-7000-8000-000000000004",
      warehouseId: "018f0000-0000-7000-8000-000000000005",
      registerId: "018f0000-0000-7000-8000-000000000006",
    },
  },
  dashboard: {
    productCount: 5,
    availableUnits: "২৩৪",
    reservedUnits: "৪",
    inventoryValue: "৳১১৪,৪৮০.০০",
    openPurchaseOrders: 3,
    openPurchaseValue: "৳৩৫,৫০০.০০",
    activeCustomers: 4,
    activeSalesOrders: 3,
    salesOrderValue: "৳৫,১০০.০০",
    lowStockCount: 1,
    recentOrders: [],
  },
  catalog: [
    {
      productId: "018f0000-0000-7000-8000-000000000101",
      product: "Synthetic Linen Shirt",
      variant: "Blue / M",
      sku: "SYN-SHIRT-BLUE-M",
      category: "Apparel",
      price: "৳১,২০০.০০",
      available: "১২",
      inventoryValue: "৳১৪,৪০০.০০",
      status: "attention",
    },
  ],
  inventory: {
    reconciledAt: "Current",
    availableUnits: "২৩৪",
    reservedUnits: "৪",
    exceptionCount: 1,
    balances: [],
    tasks: [],
    trace: [],
  },
  procurement: {
    approvedOpenValue: "৳৩৫,৫০০.০০",
    receiptsDue: 2,
    matchExceptions: 0,
    purchaseOrders: [
      {
        order: "PO-STG-001",
        supplier: "Synthetic Supplier",
        destination: "Synthetic Dhaka Warehouse",
        promised: "2026-07-31",
        ordered: "10 EA",
        received: "0 EA",
        value: "৳১০,০০০.০০",
        state: "approved",
      },
    ],
    suppliers: [],
  },
  customers: {
    locale: "en-GB",
    direction: "ltr",
    state: "ready",
    customers: [],
    pendingApprovals: 0,
  },
  sales: {
    locale: "en-GB",
    direction: "ltr",
    state: "ready",
    orders: [
      {
        id: "018f0000-0000-7000-8000-000000000201",
        documentNumber: "SO-STG-001",
        customer: "Synthetic Customer",
        total: "৳১,২০০.০০",
        orderStatus: "confirmed",
        paymentStatus: "pending",
        fulfillmentStatus: "allocated",
        invoiceStatus: "not_invoiced",
      },
    ],
    approvalCount: 0,
  },
  pos: {
    locale: "en-GB",
    currency: "BDT",
    scale: 2,
    online: true,
    pendingOperations: 0,
    registerLabel: "Synthetic Dhaka Register",
    shiftStatus: "open",
    cashierName: "Synthetic Main Web Operator",
    cartReference: "WEB-E2E-001",
    lines: [],
    subtotalMinor: 0n,
    discountMinor: 0n,
    taxMinor: 0n,
    payableMinor: 0n,
    tenders: [],
    canCheckout: false,
    checkoutBlockReason: "Synthetic test",
  },
};

const scenarios = [
  { id: "catalog-import-desktop", path: "/catalog/imports", marker: "Catalog operations", width: 1440, height: 1000, scaleText: true },
  { id: "pricing-promotions-desktop", path: "/pricing/promotions", marker: "Pricing and tax control", width: 1280, height: 960 },
  { id: "fulfillment-mobile", path: "/fulfillment", marker: "Fulfilment floor", width: 390, height: 844 },
  { id: "finance-readiness-tablet", path: "/finance/readiness", marker: "Finance readiness", width: 1024, height: 900 },
  { id: "pos-reconciliation-mobile", path: "/pos/reconciliation", marker: "POS reconciliation", width: 390, height: 844 },
  { id: "localization-desktop", path: "/localization", marker: "Localization & compliance", width: 1366, height: 960 },
  { id: "reporting-desktop", path: "/reporting", marker: "Owner reporting", width: 1440, height: 1000 },
  { id: "integrations-tablet", path: "/integrations", marker: "Integration health", width: 1024, height: 900 },
  { id: "saas-mobile", path: "/platform/saas", marker: "SaaS administration", width: 390, height: 844 },
];

function renderScenario(scenario) {
  const rendered = renderConnectedAdminPage(
    scenario.path,
    { ...base, currentPath: scenario.path },
    data,
  );
  if (typeof rendered !== "string") throw new Error(`No renderer for ${scenario.path}`);
  return hardenAdminDocumentAccessibility(rendered);
}

function leakMarkers(html) {
  const lowered = html.toLowerCase();
  return [
    "postgresql://",
    "database_url",
    "private_key",
    "begin private key",
    "staging_auth_store",
  ].filter((marker) => lowered.includes(marker));
}

await mkdir(outputDir, { recursive: true });
const axeSource = await readFile(axePath, "utf8");
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
});
const results = [];

try {
  for (const scenario of scenarios) {
    const page = await browser.newPage();
    await page.setViewport({ width: scenario.width, height: scenario.height, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    const html = renderScenario(scenario);
    await page.setContent(html, { waitUntil: "load" });
    await page.addScriptTag({ content: axeSource });

    const accessibility = await page.evaluate(async () => globalThis.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    }));

    const layout = await page.evaluate(() => {
      const allowedSelector = [
        ".table-wrap",
        ".primary-nav",
        ".moda-table-wrap",
        ".mod-c-table-wrap",
        ".mod-c-sales__queue",
        ".modg-table-wrap",
        ".modg-int-table",
        ".modg-saas-table",
        ".modf-table-wrap",
        ".pos-reconciliation__table-wrap",
      ].join(",");
      const clipped = [...document.querySelectorAll("body *")]
        .filter((element) => {
          if (!(element instanceof HTMLElement) || element.innerText.trim().length === 0) return false;
          if (element.matches(".visually-hidden,.sr-only") || element.closest(allowedSelector)) return false;
          const style = getComputedStyle(element);
          if (["auto", "scroll"].includes(style.overflowX) || style.textOverflow === "ellipsis") return false;
          return element.scrollWidth > element.clientWidth + 2;
        })
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          text: element.innerText.trim().slice(0, 80),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
      const root = document.documentElement;
      return {
        clipped,
        rootOverflow: root.scrollWidth > innerWidth + 2,
        rootScrollWidth: root.scrollWidth,
        viewportWidth: innerWidth,
        mainCount: document.querySelectorAll("main").length,
        h1Count: document.querySelectorAll("h1").length,
        language: root.lang,
        direction: root.dir,
        placeholderPresent: document.body.innerText.includes("next connected workflow"),
        bodyText: document.body.innerText,
      };
    });

    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => ({
      className: document.activeElement?.className ?? "",
      outline: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : "none",
    }));
    await page.keyboard.press("Enter");
    const skipTarget = await page.evaluate(() => document.activeElement?.id ?? "");

    let scaledTextOverflow = false;
    if (scenario.scaleText) {
      await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
      scaledTextOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
    }

    const violations = accessibility.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        failureSummary: node.failureSummary,
      })),
    }));
    const leaks = leakMarkers(html);
    const markerPresent = layout.bodyText.includes(scenario.marker);
    const passed = markerPresent
      && violations.length === 0
      && !layout.rootOverflow
      && layout.clipped.length === 0
      && layout.mainCount === 1
      && layout.h1Count === 1
      && layout.language === "en-GB"
      && layout.direction === "ltr"
      && !layout.placeholderPresent
      && firstFocus.className === "skip-link"
      && firstFocus.outline !== "none"
      && skipTarget === "main"
      && !scaledTextOverflow
      && leaks.length === 0;

    results.push({
      ...scenario,
      markerPresent,
      violations,
      layout: { ...layout, bodyText: undefined },
      keyboard: { firstFocus, skipTarget },
      scaledTextOverflow,
      leaks,
      passed,
    });
    await page.close();
  }
} finally {
  await browser.close();
}

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  chromePath,
  syntheticDataOnly: true,
  scenarios: results,
  summary: {
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    axeViolations: results.reduce((total, result) => total + result.violations.length, 0),
    rootOverflowFailures: results.filter((result) => result.layout.rootOverflow).length,
    clippingFailures: results.filter((result) => result.layout.clipped.length > 0).length,
    landmarkFailures: results.filter((result) => result.layout.mainCount !== 1 || result.layout.h1Count !== 1).length,
    keyboardFailures: results.filter((result) => result.keyboard.firstFocus.className !== "skip-link" || result.keyboard.skipTarget !== "main").length,
    leakFailures: results.filter((result) => result.leaks.length > 0).length,
  },
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (report.summary.passed !== report.summary.total) {
  console.error(JSON.stringify(report.summary));
  for (const result of results.filter((item) => !item.passed)) {
    console.error(JSON.stringify({
      id: result.id,
      markerPresent: result.markerPresent,
      violationIds: result.violations.map((item) => item.id),
      layout: result.layout,
      keyboard: result.keyboard,
      scaledTextOverflow: result.scaledTextOverflow,
      leaks: result.leaks,
    }));
  }
  process.exit(1);
}

console.log(`Main web E2E passed ${report.summary.passed}/${report.summary.total} Chromium scenarios`);
