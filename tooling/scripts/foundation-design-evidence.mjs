import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import puppeteer from "puppeteer-core";

import { renderAdminFoundationPreview } from "../../build/apps/admin-web/src/app-shell/index.js";
import { renderPosFoundationPreview } from "../../build/apps/pos-web/src/app-shell/index.js";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(root, "docs", "architecture", "foundation", "design-evidence");
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");
const permissions = new Set(["catalog.read", "inventory.read", "sales.read", "finance.read", "reporting.read", "pos.sell", "pos.returns", "pos.cash"]);

const scenarios = [
  { id: "admin-en-ready-desktop", app: "admin", locale: "en", direction: "ltr", state: "ready", width: 1440, height: 1000, screenshot: true },
  { id: "admin-ar-conflict-tablet", app: "admin", locale: "ar", direction: "rtl", state: "conflict", width: 1024, height: 900, screenshot: true },
  { id: "admin-ja-denied-mobile", app: "admin", locale: "ja", direction: "ltr", state: "denied", width: 390, height: 844, screenshot: true },
  { id: "admin-en-loading-mobile", app: "admin", locale: "en", direction: "ltr", state: "loading", width: 390, height: 844, screenshot: false },
  { id: "pos-bn-offline-desktop", app: "pos", locale: "bn", direction: "ltr", state: "offline", width: 1280, height: 900, screenshot: true },
  { id: "pos-ja-error-mobile", app: "pos", locale: "ja", direction: "ltr", state: "error", width: 390, height: 844, screenshot: true },
  { id: "pos-ar-empty-tablet", app: "pos", locale: "ar", direction: "rtl", state: "empty", width: 820, height: 1000, screenshot: false },
];

function renderScenario(scenario) {
  const tenantName = scenario.locale === "ar" ? "متجر تجريبي متعدد الفروع" : "Synthetic Multi-store Retail";
  const location = scenario.locale === "bn" ? "ঢাকা কেন্দ্রীয় শাখা" : scenario.locale === "ar" ? "الفرع المركزي في دكا" : "Dhaka Central";
  if (scenario.app === "admin") {
    return renderAdminFoundationPreview({
      displayName: "Synthetic Operations Manager",
      tenantName,
      permissions,
      direction: scenario.direction,
      locale: scenario.locale,
      location,
      businessDate: "Business date · 28 Jul 2026",
    }, { locale: scenario.locale, state: scenario.state });
  }
  return renderPosFoundationPreview({
    displayName: "Synthetic Cashier",
    tenantName,
    permissions,
    offlineState: { online: scenario.state !== "offline", pendingOperations: scenario.state === "offline" ? 3 : 0, lastSyncAt: "2026-07-28T08:00:00Z" },
    direction: scenario.direction,
    locale: scenario.locale,
    location,
    businessDate: "Business date · 28 Jul 2026",
  }, { locale: scenario.locale, state: scenario.state });
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
      const clipped = [...document.querySelectorAll("body *")].filter((element) => {
        if (!(element instanceof HTMLElement) || element.innerText.trim().length === 0) return false;
        const style = getComputedStyle(element);
        const allowed = style.overflowX === "auto" || style.overflowX === "scroll" || style.textOverflow === "ellipsis" || element.matches(".visually-hidden") || element.closest(".table-wrap, .primary-nav");
        return element.scrollWidth > element.clientWidth + 2 && !allowed;
      }).slice(0, 12).map((element) => ({ tag: element.tagName, className: element.className, text: element.innerText.trim().slice(0, 80), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      const overflowers = [...document.querySelectorAll("body *")].filter((element) => {
        if (!(element instanceof HTMLElement) || element.matches(".visually-hidden") || element.closest(".table-wrap, .primary-nav")) return false;
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

    if (scenario.id === "admin-en-ready-desktop") {
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
    const passed = violations.length === 0 && !layout.viewportOverflow && layout.clipped.length === 0 && firstFocus.className === "skip-link" && firstFocus.outline !== "none" && skipTarget === "main" && layout.language === scenario.locale && layout.direction === scenario.direction && layout.scaledTextViewportOverflow !== true;
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
  commands: ["npm run build", "node tooling/scripts/foundation-design-evidence.mjs", "node .agents/skills/impeccable/scripts/detect.mjs --json apps/admin-web apps/pos-web packages/ui"],
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
const rows = results.map((result) => `| ${result.id} | ${result.width}×${result.height} | ${result.locale}/${result.direction} | ${result.state} | ${result.violations.length} | ${result.layout.viewportOverflow ? "yes" : "no"} | ${result.layout.clipped.length} | ${result.passed ? "Pass" : "Fail"} |`).join("\n");
const screenshots = results.filter((result) => result.screenshot).map((result) => `- [${result.id}](${path.basename(result.screenshot)})`).join("\n");
const markdown = `# Foundation Design Evidence\n\n**Generated:** ${report.generatedAt}\n\nSynthetic fixtures only. No production credentials or customer data were used.\n\n| Scenario | Viewport | Locale | State | Axe violations | Viewport overflow | Unexpected clipping | Result |\n|---|---:|---|---|---:|---|---:|---|\n${rows}\n\n## Summary\n\n- Browser scenarios passed: ${report.summary.passed}/${report.summary.total}\n- WCAG 2 A/AA and 2.1 AA axe violations: ${report.summary.axeViolations}\n- Impeccable deterministic findings: ${report.summary.detectorFindings}\n- Keyboard contract: first Tab focuses the visible skip link; Enter moves focus to the main landmark.\n- Reduced-motion mode is enabled for every browser scenario.\n- The English desktop scenario is rechecked at 200% root text size.\n\n## Screenshot evidence\n\n${screenshots}\n\nExact machine-readable results are in [report.json](report.json).\n`;
await writeFile(path.join(outputDir, "README.md"), markdown);

if (report.summary.passed !== report.summary.total || report.summary.axeViolations > 0 || report.summary.detectorFindings > 0) {
  console.error(JSON.stringify(report.summary));
  process.exit(1);
}

console.log(`Foundation design evidence passed ${report.summary.passed}/${report.summary.total} browser scenarios`);
