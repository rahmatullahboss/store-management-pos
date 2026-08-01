import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

import { renderOperationalAdminHtml } from "../../build/apps/api/src/staging-operational-worker.js";
import { hardenPosWorkspaceAccessibility } from "../../build/apps/pos-web/src/accessibility.js";
import { renderRegisterWorkspace } from "../../build/apps/pos-web/src/modules/register/surface.js";
import { ADMIN_ROLE_MATRIX_ROUTES, E2E_PERSONAS } from "../fixtures/main-web-role-matrix.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "docs", "architecture", "foundation", "design-evidence");
const reportPath = path.join(outputDir, "main-web-role-e2e-report.json");
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");

const baseData = {
  context: {
    user: {
      id: "018f0000-0000-7000-8000-000000009001",
      email: "role-e2e@example.invalid",
      name: "Synthetic Role E2E Operator",
    },
    tenant: {
      id: "018f0000-0000-7000-8000-000000000002",
      name: "Synthetic Role E2E Tenant",
    },
    role: "role-e2e",
    permissions: [],
    scope: {
      legalEntityId: "018f0000-0000-7000-8000-000000000003",
      storeId: "018f0000-0000-7000-8000-000000000004",
      warehouseId: "018f0000-0000-7000-8000-000000000005",
      registerId: "018f0000-0000-7000-8000-000000000006",
    },
  },
  dashboard: {
    productCount: 5,
    availableUnits: "234",
    reservedUnits: "4",
    inventoryValue: "BDT 114,480.00",
    openPurchaseOrders: 3,
    openPurchaseValue: "BDT 35,500.00",
    activeCustomers: 4,
    activeSalesOrders: 3,
    salesOrderValue: "BDT 5,100.00",
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
      price: "BDT 1,200.00",
      available: "12",
      inventoryValue: "BDT 14,400.00",
      status: "attention",
    },
  ],
  inventory: {
    reconciledAt: "Current",
    availableUnits: "234",
    reservedUnits: "4",
    exceptionCount: 1,
    balances: [],
    tasks: [],
    trace: [],
  },
  procurement: {
    approvedOpenValue: "BDT 35,500.00",
    receiptsDue: 2,
    matchExceptions: 0,
    purchaseOrders: [
      {
        order: "PO-ROLE-001",
        supplier: "Synthetic Supplier",
        destination: "Synthetic Dhaka Warehouse",
        promised: "2026-08-02",
        ordered: "10 EA",
        received: "0 EA",
        value: "BDT 10,000.00",
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
        documentNumber: "SO-ROLE-001",
        customer: "Synthetic Customer",
        total: "BDT 1,200.00",
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
    cashierName: "Synthetic Cashier",
    cartReference: "ROLE-E2E-001",
    lines: [],
    subtotalMinor: 0n,
    discountMinor: 0n,
    taxMinor: 0n,
    payableMinor: 0n,
    tenders: [],
    canCheckout: false,
    checkoutBlockReason: "Synthetic role-matrix safety boundary",
  },
};

function scopedData(persona) {
  return {
    ...baseData,
    context: {
      ...baseData.context,
      user: { ...baseData.context.user, name: persona.displayName },
      role: persona.id,
      permissions: [...persona.permissions],
    },
    pos: { ...baseData.pos, cashierName: persona.displayName },
  };
}

function leakMarkers(html) {
  const lowered = html.toLowerCase();
  return [
    "postgresql://",
    "database_url",
    "private_key",
    "begin private key",
    "staging_auth_store",
    "authorization: bearer",
  ].filter((marker) => lowered.includes(marker));
}

function posDocument(data) {
  const workspace = hardenPosWorkspaceAccessibility(renderRegisterWorkspace(data.pos));
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Store POS role E2E</title><style>html,body{max-width:100%;overflow-x:hidden}body{margin:0}.modd-register,.modd-workspace,.modd-cart,.modd-checkout,.modd-table-wrap{min-width:0;max-width:100%}.modd-table-wrap{overflow-x:auto;overscroll-behavior-x:contain}</style></head><body>${workspace}</body></html>`;
}

async function analyzePage(page, axeSource, { runAxe = false } = {}) {
  let violations = [];
  if (runAxe) {
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(async () => globalThis.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    }));
    violations = result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
    }));
  }
  const layout = await page.evaluate(() => ({
    rootOverflow: document.documentElement.scrollWidth > innerWidth + 2,
    mainCount: document.querySelectorAll("main").length,
    h1Count: document.querySelectorAll("h1").length,
    navHrefs: [...document.querySelectorAll(".primary-nav a")].map((anchor) => anchor.getAttribute("href")),
    denied: document.querySelector("[data-permission-denied]") !== null,
    placeholder: document.body.innerText.includes("next connected workflow"),
  }));
  return { violations, layout };
}

await mkdir(outputDir, { recursive: true });
const axeSource = await readFile(axePath, "utf8");
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
});

const routeResults = [];
const personaResults = [];
const notFoundResults = [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

  for (const persona of E2E_PERSONAS) {
    const data = scopedData(persona);
    const permissions = new Set(persona.permissions);

    for (const route of ADMIN_ROLE_MATRIX_ROUTES) {
      const allowed = permissions.has(route.permission);
      const rendered = renderOperationalAdminHtml(`/admin${route.renderPath}`, data, "role-e2e");
      const leaks = leakMarkers(rendered.html);
      await page.setContent(rendered.html, { waitUntil: "load" });
      const { layout } = await analyzePage(page, axeSource);
      const expectedHref = `/admin${route.pattern}`;
      const navHasRoute = layout.navHrefs.includes(expectedHref);
      const passed = rendered.status === (allowed ? 200 : 403)
        && navHasRoute === allowed
        && layout.denied === !allowed
        && layout.mainCount === 1
        && layout.h1Count === 1
        && !layout.rootOverflow
        && !layout.placeholder
        && leaks.length === 0;
      routeResults.push({
        persona: persona.id,
        route: route.id,
        permission: route.permission,
        allowed,
        status: rendered.status,
        navHasRoute,
        denied: layout.denied,
        rootOverflow: layout.rootOverflow,
        leaks,
        passed,
      });
    }

    const missing = renderOperationalAdminHtml("/admin/__role-e2e-not-found__", data, "role-e2e");
    await page.setContent(missing.html, { waitUntil: "load" });
    const missingAnalysis = await analyzePage(page, axeSource);
    const missingPassed = missing.status === 404
      && !missingAnalysis.layout.denied
      && missingAnalysis.layout.mainCount === 1
      && missingAnalysis.layout.h1Count === 1;
    notFoundResults.push({ persona: persona.id, status: missing.status, passed: missingPassed });

    let primaryHtml;
    if (persona.primarySurface === "pos") {
      primaryHtml = posDocument(data);
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    } else {
      primaryHtml = renderOperationalAdminHtml(`/admin${persona.primaryPath}`, data, "role-e2e").html;
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    }
    await page.setContent(primaryHtml, { waitUntil: "load" });
    const primary = await analyzePage(page, axeSource, { runAxe: true });
    const posCheckoutSafe = persona.primarySurface !== "pos"
      || await page.evaluate(() => document.querySelector(".modd-complete")?.hasAttribute("disabled") === true);
    personaResults.push({
      persona: persona.id,
      primarySurface: persona.primarySurface,
      primaryPath: persona.primaryPath,
      axeViolations: primary.violations,
      rootOverflow: primary.layout.rootOverflow,
      mainCount: primary.layout.mainCount,
      h1Count: primary.layout.h1Count,
      posCheckoutSafe,
      passed: primary.violations.length === 0
        && !primary.layout.rootOverflow
        && primary.layout.mainCount === 1
        && primary.layout.h1Count === 1
        && posCheckoutSafe,
    });
  }

  await page.close();
} finally {
  await browser.close();
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  syntheticDataOnly: true,
  personaCount: E2E_PERSONAS.length,
  routeCount: ADMIN_ROLE_MATRIX_ROUTES.length,
  routeResults,
  personaResults,
  notFoundResults,
  summary: {
    routeAssertionsPassed: routeResults.filter((result) => result.passed).length,
    routeAssertionsTotal: routeResults.length,
    allowedAssertions: routeResults.filter((result) => result.allowed).length,
    deniedAssertions: routeResults.filter((result) => !result.allowed).length,
    personaChecksPassed: personaResults.filter((result) => result.passed).length,
    personaChecksTotal: personaResults.length,
    notFoundChecksPassed: notFoundResults.filter((result) => result.passed).length,
    notFoundChecksTotal: notFoundResults.length,
    axeViolations: personaResults.reduce((total, result) => total + result.axeViolations.length, 0),
  },
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const failedRoutes = routeResults.filter((result) => !result.passed);
const failedPersonas = personaResults.filter((result) => !result.passed);
const failedNotFound = notFoundResults.filter((result) => !result.passed);
if (failedRoutes.length > 0 || failedPersonas.length > 0 || failedNotFound.length > 0) {
  console.error(JSON.stringify(report.summary));
  for (const failure of [...failedRoutes, ...failedPersonas, ...failedNotFound].slice(0, 30)) {
    console.error(JSON.stringify(failure));
  }
  process.exit(1);
}

console.log(`Role E2E passed ${report.summary.routeAssertionsPassed}/${report.summary.routeAssertionsTotal} route assertions, ${report.summary.personaChecksPassed}/${report.summary.personaChecksTotal} persona checks, and ${report.summary.notFoundChecksPassed}/${report.summary.notFoundChecksTotal} fail-closed checks`);
