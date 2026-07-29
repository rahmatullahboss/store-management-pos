import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { renderIntegrationsAdminPage, renderReportingAdminPage, renderSaasOperationsAdminPage } from "../../build/apps/admin-web/src/app-shell/index.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "docs", "architecture", "mod-g", "design-evidence");
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");
const permissions = new Set(["reporting.metric.read", "reporting.export.request", "integration.connector.read", "integration.connector.manage", "integration.webhook.read", "integration.webhook.manage", "saas.subscription.read", "saas.subscription.manage", "saas.lifecycle.manage", "saas.support.impersonate"]);
const scenarios = [
  { id: "reporting-owner-desktop", app: "reporting", state: "ready", audience: "owner", locale: "en-GB", direction: "ltr", width: 1440, height: 1000, screenshot: true },
  { id: "reporting-inventory-rtl", app: "reporting", state: "ready", audience: "inventory", locale: "ar", direction: "rtl", width: 1024, height: 900, screenshot: true },
  { id: "reporting-error-mobile", app: "reporting", state: "error", audience: "finance", locale: "en-GB", direction: "ltr", width: 390, height: 844, screenshot: false },
  { id: "integrations-desktop", app: "integrations", state: "ready", locale: "en-GB", direction: "ltr", width: 1366, height: 900, screenshot: true },
  { id: "integrations-denied-mobile", app: "integrations", state: "denied", locale: "en-GB", direction: "ltr", width: 390, height: 844, screenshot: false },
  { id: "saas-desktop", app: "saas", state: "ready", locale: "en-GB", direction: "ltr", width: 1440, height: 1100, screenshot: true },
  { id: "saas-empty-rtl-mobile", app: "saas", state: "empty", locale: "ar", direction: "rtl", width: 390, height: 844, screenshot: true },
];

function shell(scenario) {
  return { displayName: "Synthetic Operator", tenantName: scenario.direction === "rtl" ? "متجر تجريبي" : "Synthetic Store", permissions, direction: scenario.direction, locale: scenario.locale, location: scenario.direction === "rtl" ? "جميع المواقع" : "All locations", businessDate: "Business date · 30 Jul 2026" };
}

function reporting(scenario) {
  const ready = scenario.state === "ready";
  return { state: scenario.state, audience: scenario.audience, tenantName: "Synthetic Store", scopeLabel: "All locations", businessDateLabel: "30 Jul 2026", generatedAtLabel: "01:30 Asia/Dhaka", timeZone: "Asia/Dhaka", currency: "BDT", canRequestExport: true,
    metrics: ready ? [
      { metricId: "sales.net", label: "Net sales", value: "125000", unit: "minor", currency: "BDT", periodLabel: "30 Jul 2026", version: "sales.net@1", freshnessLabel: "42 seconds", health: "fresh", reconciled: true, controlTotal: "125000 BDT", drillThroughHref: "/reporting" },
      { metricId: "stock.available", label: "Available stock", value: "18342", unit: "units", periodLabel: "Current", version: "stock.available@1", freshnessLabel: "3 minutes", health: "fresh", reconciled: true, controlTotal: "18342 units", drillThroughHref: "/inventory" },
      { metricId: "payment.exceptions", label: "Payment exceptions", value: "4", unit: "count", periodLabel: "Current", version: "payment.exceptions@1", freshnessLabel: "5 minutes", health: "stale", reconciled: false, controlTotal: "6 records" },
      { metricId: "margin.net", label: "Net margin", value: "18.4", unit: "percent", periodLabel: "30 Jul 2026", version: "margin.net@1", freshnessLabel: "2 minutes", health: "fresh", reconciled: true, controlTotal: "18.4 percent" },
    ] : [],
    exceptions: ready ? [{ exceptionId: "ex-1", severity: "high", title: "Settlement mismatch", owner: "Finance", ageLabel: "18 minutes", href: "/finance/readiness" }] : [],
    exports: ready ? [{ exportId: "export-1", reportName: "Daily control", format: "xlsx", status: "running", requestedAtLabel: "01:20", expiresAtLabel: "6 Aug 2026" }] : [],
    ...(scenario.state === "error" ? { message: "Reporting projections are temporarily unavailable." } : {}) };
}

function integrations(scenario) {
  const ready = scenario.state === "ready";
  return { state: scenario.state, tenantName: "Synthetic Store", observedAtLabel: "01:30 Asia/Dhaka", canManage: true, canReplay: true,
    connections: ready ? [
      { connectionId: "connection-1", displayName: "Commerce products", connectorType: "commerce_graphql", provider: "Commerce provider", status: "active", credentialLabel: "external reference", resourceTypes: ["product"], cursorLabel: "cursor 31", lastHealthyLabel: "2 minutes ago", conflictCount: 0 },
      { connectionId: "connection-2", displayName: "Partner orders", connectorType: "generic_rest", provider: "Partner provider", status: "degraded", credentialLabel: "external reference", resourceTypes: ["order"], cursorLabel: "page 148", lastHealthyLabel: "23 minutes ago", conflictCount: 3 },
    ] : [],
    webhooks: ready ? [{ subscriptionId: "hook-1", endpointLabel: "Partner delivery endpoint", eventTypes: ["sales.order.completed.v1"], status: "active", queued: 2, retrying: 1, deadLetter: 1, lastDeliveryLabel: "4 minutes ago" }] : [] };
}

function saas(scenario) {
  const ready = scenario.state === "ready";
  return { state: scenario.state, observedAtLabel: "01:30 Asia/Dhaka", canManageSubscription: true, canManageLifecycle: true, canManageSupport: true,
    ...(ready ? { subscription: { tenantId: "tenant-1", tenantName: "Synthetic Store", planName: "Growth", planVersion: "2026-07", status: "active", periodLabel: "1 Jul – 1 Aug 2026", version: "4" } } : {}),
    usage: ready ? [{ meterCode: "catalog.products", label: "Products", quantity: "740", limit: "1000", enforcement: "hard", periodLabel: "Jul 2026" }, { meterCode: "reporting.exports", label: "Exports", quantity: "18", limit: "50", enforcement: "soft", periodLabel: "Jul 2026" }] : [],
    lifecycle: ready ? [{ jobId: "job-1", operation: "export", status: "review", requestedBy: "Platform admin", requestedAtLabel: "01:10", reason: "Evidence review" }] : [],
    rollouts: ready ? [{ featureCode: "reporting.new-dashboard", status: "enabled", percentage: 25, reason: "Controlled pilot", version: "2" }] : [],
    incidents: ready ? [{ incidentCode: "INC-2026-001", severity: "high", status: "investigating", summary: "Provider throttling", ageLabel: "22 minutes" }] : [],
    impersonation: ready ? [{ grantId: "grant-1", supportActor: "Synthetic support", approvedBy: "Synthetic manager", scopeLabel: "integration.connector.read", expiresAtLabel: "03:00", status: "active" }] : [] };
}

function render(scenario) {
  const input = shell(scenario);
  if (scenario.app === "reporting") return renderReportingAdminPage(input, reporting(scenario));
  if (scenario.app === "integrations") return renderIntegrationsAdminPage(input, integrations(scenario));
  return renderSaasOperationsAdminPage(input, saas(scenario));
}

await mkdir(outputDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"] });
const axeSource = await readFile(axePath, "utf8");
const results = [];
try {
  for (const scenario of scenarios) {
    const page = await browser.newPage();
    await page.setViewport({ width: scenario.width, height: scenario.height, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.setContent(render(scenario), { waitUntil: "load" });
    await page.addScriptTag({ content: axeSource });
    const accessibility = await page.evaluate(async () => globalThis.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }));
    const layout = await page.evaluate(() => {
      const allowed = ".primary-nav,.modg-table-wrap,.modg-int-table,.modg-saas-table";
      const clipped = [...document.querySelectorAll("body *")].filter((element) => {
        if (!(element instanceof HTMLElement) || element.innerText.trim().length === 0) return false;
        const style = getComputedStyle(element);
        if (style.overflowX === "auto" || style.overflowX === "scroll" || style.textOverflow === "ellipsis" || element.closest(allowed)) return false;
        return element.scrollWidth > element.clientWidth + 2;
      }).slice(0, 12).map((element) => ({ tag: element.tagName, className: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      const overflowers = [...document.querySelectorAll("body *")].filter((element) => {
        if (!(element instanceof HTMLElement) || element.closest(allowed)) return false;
        const rect = element.getBoundingClientRect();
        return rect.right > innerWidth + 2 || rect.left < -2;
      }).slice(0, 12).map((element) => ({ tag: element.tagName, className: element.className }));
      scrollTo(10000, 0); const rootScrollX = scrollX; scrollTo(0, 0);
      return { viewportOverflow: rootScrollX > 2, clipped, overflowers, mainLandmarks: document.querySelectorAll("main").length, language: document.documentElement.lang, direction: document.documentElement.dir };
    });
    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => ({ className: document.activeElement?.className, outline: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : "none" }));
    await page.keyboard.press("Enter");
    const skipTarget = await page.evaluate(() => document.activeElement?.id ?? "");
    let scaledOverflow = false;
    if (scenario.id === "reporting-owner-desktop") {
      await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
      scaledOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    }
    let screenshotPath = null;
    if (scenario.screenshot) {
      screenshotPath = path.join(outputDir, `${scenario.id}.jpg`);
      await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 82, fullPage: true });
    }
    const violations = accessibility.violations.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.map((node) => ({ target: node.target, failureSummary: node.failureSummary })) }));
    const passed = violations.length === 0 && !layout.viewportOverflow && layout.clipped.length === 0 && layout.overflowers.length === 0 && layout.mainLandmarks === 1 && firstFocus.className === "skip-link" && firstFocus.outline !== "none" && skipTarget === "main" && layout.language === scenario.locale && layout.direction === scenario.direction && !scaledOverflow;
    results.push({ ...scenario, screenshot: screenshotPath ? path.relative(root, screenshotPath) : null, violations, layout, keyboard: { firstFocus, skipTarget }, scaledOverflow, passed });
    await page.close();
  }
} finally { await browser.close(); }

const report = { generatedAt: new Date().toISOString(), chromePath, scenarios: results, summary: { passed: results.filter((item) => item.passed).length, total: results.length, axeViolations: results.reduce((count, item) => count + item.violations.length, 0), clipped: results.reduce((count, item) => count + item.layout.clipped.length, 0) } };
await writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const rows = results.map((item) => `| ${item.id} | ${item.width}×${item.height} | ${item.locale}/${item.direction} | ${item.state} | ${item.violations.length} | ${item.layout.viewportOverflow ? "yes" : "no"} | ${item.layout.clipped.length} | ${item.layout.mainLandmarks} | ${item.passed ? "Pass" : "Fail"} |`).join("\n");
const screenshots = results.filter((item) => item.screenshot).map((item) => `- [${item.id}](${path.basename(item.screenshot)})`).join("\n");
await writeFile(path.join(outputDir, "README.md"), `# MOD-G Admin Design Evidence\n\n**Generated:** ${report.generatedAt}\n\nSynthetic fixtures only. No production credentials or customer data were used.\n\n| Scenario | Viewport | Locale | State | Axe violations | Overflow | Clipping | Main landmarks | Result |\n|---|---:|---|---|---:|---|---:|---:|---|\n${rows}\n\n- Browser scenarios passed: ${report.summary.passed}/${report.summary.total}\n- WCAG axe violations: ${report.summary.axeViolations}\n- Unexpected clipped elements: ${report.summary.clipped}\n- First Tab focuses the skip link and Enter moves focus to the single main landmark.\n- Reporting desktop is rechecked at 200% text size.\n\n## Screenshots\n\n${screenshots}\n`);
if (report.summary.passed !== report.summary.total || report.summary.axeViolations > 0) process.exit(1);
console.log(`MOD-G design evidence passed ${report.summary.passed}/${report.summary.total} scenarios`);
