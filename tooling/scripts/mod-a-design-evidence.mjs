import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";

import { renderAdminShell } from "../../build/apps/admin-web/src/app-shell/index.js";
import { renderCatalogAdmin } from "../../build/apps/admin-web/src/modules/catalog/workspace.js";
import { renderPricingTaxAdmin } from "../../build/apps/admin-web/src/modules/pricing/workspace.js";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "docs", "architecture", "mod-a", "design-evidence");
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");
const permissions = new Set([
  "catalog.product.read",
  "catalog.product.write",
  "catalog.product.publish",
  "catalog.import.execute",
  "catalog.unit.manage",
  "pricing.price.read",
  "pricing.price.manage",
  "pricing.price.publish",
  "pricing.promotion.manage",
  "pricing.discount.apply",
  "pricing.discount.approve",
  "tax.calculation.read",
  "tax.configuration.manage",
  "tax.configuration.publish",
  "tax.exemption.manage",
]);

const scenarios = [
  { id: "catalog-en-ready-desktop", surface: "catalog", locale: "en", direction: "ltr", state: "ready", width: 1440, height: 1000, screenshot: true },
  { id: "catalog-ar-conflict-tablet", surface: "catalog", locale: "ar", direction: "rtl", state: "conflict", width: 1024, height: 900, screenshot: true },
  { id: "catalog-bn-offline-mobile", surface: "catalog", locale: "bn", direction: "ltr", state: "offline", width: 390, height: 844, screenshot: true },
  { id: "pricing-en-ready-desktop", surface: "pricing", locale: "en", direction: "ltr", state: "ready", width: 1440, height: 1000, screenshot: true },
  { id: "pricing-ar-empty-tablet", surface: "pricing", locale: "ar", direction: "rtl", state: "empty", width: 1024, height: 900, screenshot: true },
  { id: "pricing-ja-denied-mobile", surface: "pricing", locale: "ja", direction: "ltr", state: "denied", width: 390, height: 844, screenshot: true },
];

function renderScenario(scenario) {
  const tenantName = scenario.locale === "ar" ? "متجر اصطناعي متعدد الفروع" : scenario.locale === "bn" ? "কৃত্রিম মাল্টি-স্টোর রিটেইল" : "Synthetic Multi-store Retail";
  const location = scenario.locale === "ar" ? "فرع دكا المركزي" : scenario.locale === "bn" ? "ঢাকা কেন্দ্রীয় শাখা" : "Dhaka Central";
  const content = scenario.surface === "catalog"
    ? renderCatalogAdmin({ locale: scenario.locale, state: scenario.state })
    : renderPricingTaxAdmin({ locale: scenario.locale, state: scenario.state });
  return renderAdminShell({
    displayName: "Synthetic Operations Manager",
    tenantName,
    permissions,
    currentPath: scenario.surface === "catalog" ? "/catalog" : "/pricing",
    content,
    direction: scenario.direction,
    locale: scenario.locale,
    location,
    businessDate: "Business date · 28 Jul 2026",
    offline: scenario.state === "offline",
  });
}

async function runDetector() {
  const { stdout } = await execFileAsync(process.execPath, [path.join(root, ".agents", "skills", "impeccable", "scripts", "detect.mjs"), "--json", "apps/admin-web", "apps/pos-web", "packages/ui"], { cwd: root });
  return JSON.parse(stdout || "[]");
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
    await page.setContent(renderScenario(scenario), { waitUntil: "load" });
    await page.addScriptTag({ content: axeSource });

    const accessibility = await page.evaluate(async () => globalThis.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }));
    const layout = await page.evaluate(() => {
      const rootElement = document.documentElement;
      const allowedSelector = ".moda-visually-hidden,.visually-hidden,.moda-table-wrap,.table-wrap,.primary-nav";
      const clipped = [...document.querySelectorAll("body *")].filter((element) => {
        if (!(element instanceof HTMLElement) || element.innerText.trim().length === 0) return false;
        const style = getComputedStyle(element);
        const allowed = style.overflowX === "auto" || style.overflowX === "scroll" || style.textOverflow === "ellipsis" || element.matches(allowedSelector) || element.closest(allowedSelector);
        return element.scrollWidth > element.clientWidth + 2 && !allowed;
      }).slice(0, 12).map((element) => ({ tag: element.tagName, className: element.className, text: element.innerText.trim().slice(0, 80), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      const overflowers = [...document.querySelectorAll("body *")].filter((element) => {
        if (!(element instanceof HTMLElement) || element.matches(allowedSelector) || element.closest(allowedSelector)) return false;
        const rect = element.getBoundingClientRect();
        return rect.right > innerWidth + 2 || rect.left < -2;
      }).slice(0, 12).map((element) => { const rect = element.getBoundingClientRect(); return { tag: element.tagName, className: element.className, text: element.innerText.trim().slice(0, 80), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }; });
      scrollTo(10000, 0);
      const rootScrollX = scrollX;
      scrollTo(0, 0);
      return {
        viewportOverflow: rootScrollX > 2,
        rootScrollX,
        intrinsicScrollWidth: rootElement.scrollWidth,
        viewportWidth: innerWidth,
        clipped,
        overflowers,
        landmarks: { main: document.querySelectorAll("main").length, nav: document.querySelectorAll("nav").length, header: document.querySelectorAll("header").length },
        language: rootElement.lang,
        direction: rootElement.dir,
      };
    });

    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, className: document.activeElement?.className, outline: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : "none" }));
    await page.keyboard.press("Enter");
    const skipTarget = await page.evaluate(() => document.activeElement?.id ?? "");

    if (scenario.id === "catalog-en-ready-desktop" || scenario.id === "pricing-en-ready-desktop") {
      await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
      layout.scaledTextViewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
    }

    let screenshotPath = null;
    if (scenario.screenshot) {
      screenshotPath = path.join(outputDir, `${scenario.id}.jpg`);
      await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 82, fullPage: true });
    }

    const violations = accessibility.violations.map((violation) => ({ id: violation.id, impact: violation.impact, description: violation.description, nodes: violation.nodes.map((node) => ({ target: node.target, html: node.html, failureSummary: node.failureSummary })) }));
    const passed = violations.length === 0
      && !layout.viewportOverflow
      && layout.clipped.length === 0
      && layout.overflowers.length === 0
      && layout.landmarks.main === 1
      && firstFocus.className === "skip-link"
      && firstFocus.outline !== "none"
      && skipTarget === "main"
      && layout.language === scenario.locale
      && layout.direction === scenario.direction
      && layout.scaledTextViewportOverflow !== true;
    results.push({ ...scenario, screenshot: screenshotPath ? path.relative(root, screenshotPath) : null, violations, layout, keyboard: { firstFocus, skipTarget }, passed });
    await page.close();
  }
} finally {
  await browser.close();
}

const detectorFindings = await runDetector();
const report = {
  generatedAt: new Date().toISOString(),
  chromePath,
  commands: ["npm run build", "node tooling/scripts/mod-a-design-evidence.mjs", "npm run design:detect"],
  detectorFindings,
  scenarios: results,
  summary: {
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    axeViolations: results.reduce((count, result) => count + result.violations.length, 0),
    detectorFindings: detectorFindings.length,
  },
};

await writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const rows = results.map((result) => `| ${result.id} | ${result.width}×${result.height} | ${result.locale}/${result.direction} | ${result.state} | ${result.violations.length} | ${result.layout.viewportOverflow ? "yes" : "no"} | ${result.layout.clipped.length} | ${result.layout.overflowers.length} | ${result.passed ? "Pass" : "Fail"} |`).join("\n");
const screenshots = results.map((result) => `- [${result.id}](${path.basename(result.screenshot)})`).join("\n");
const markdown = `# MOD-A Admin Design Evidence\n\n**Generated:** ${report.generatedAt}\n\nSynthetic fixtures only. No production credentials, prices or customer data were used.\n\n| Scenario | Viewport | Locale | State | Axe violations | Viewport overflow | Unexpected clipping | Off-viewport elements | Result |\n|---|---:|---|---|---:|---|---:|---:|---|\n${rows}\n\n## Summary\n\n- Browser scenarios passed: ${report.summary.passed}/${report.summary.total}\n- WCAG 2 A/AA and WCAG 2.1 AA axe violations: ${report.summary.axeViolations}\n- Impeccable deterministic findings: ${report.summary.detectorFindings}\n- Keyboard contract: first Tab focuses the visible skip link; Enter moves focus to the single main landmark.\n- Reduced-motion mode is enabled for every scenario.\n- Catalog and pricing English desktop scenarios are rechecked at 200% root text size.\n- Bengali, Arabic RTL and Japanese fixtures are included.\n\n## Screenshot evidence\n\n${screenshots}\n\nExact machine-readable results are in [report.json](report.json).\n`;
await writeFile(path.join(outputDir, "README.md"), markdown);

if (report.summary.passed !== report.summary.total || report.summary.axeViolations > 0 || report.summary.detectorFindings > 0) {
  console.error(JSON.stringify(report.summary));
  process.exit(1);
}

console.log(`MOD-A design evidence passed ${report.summary.passed}/${report.summary.total} browser scenarios`);
