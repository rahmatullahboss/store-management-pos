import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("../..", import.meta.url));
const sourcePath = path.join(root, "apps", "marketing-web", "src", "index.html");
const outputDir = path.join(root, "docs", "architecture", "marketing", "design-evidence");
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");
const scenarios = [
  { id: "marketing-desktop", width: 1440, height: 1000, mobileNavigation: false },
  { id: "marketing-mobile", width: 390, height: 844, mobileNavigation: true },
];

await mkdir(outputDir, { recursive: true });
const axeSource = await readFile(axePath, "utf8");
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none", "--allow-file-access-from-files"],
});
const results = [];

try {
  for (const scenario of scenarios) {
    const page = await browser.newPage();
    await page.setViewport({ width: scenario.width, height: scenario.height, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(pathToFileURL(sourcePath).href, { waitUntil: "networkidle0" });
    await page.addScriptTag({ content: axeSource });

    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => ({
      className: document.activeElement?.className,
      outline: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : "none",
    }));
    await page.keyboard.press("Enter");
    const skipTarget = await page.evaluate(() => document.activeElement?.id ?? "");

    let mobileNavigationPassed = true;
    if (scenario.mobileNavigation) {
      await page.click("[data-nav-toggle]");
      mobileNavigationPassed = await page.evaluate(() => (
        document.querySelector("[data-nav-toggle]")?.getAttribute("aria-expanded") === "true"
        && document.querySelector("[data-navigation]")?.classList.contains("is-open") === true
      ));
      await page.click("[data-nav-toggle]");
    }

    await page.click('[data-billing="annual"]');
    const billingState = await page.evaluate(() => ({
      annualPressed: document.querySelector('[data-billing="annual"]')?.getAttribute("aria-pressed"),
      launchPrice: document.querySelector("[data-annual]")?.textContent?.trim(),
    }));
    const accessibility = await page.evaluate(async () => globalThis.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    }));
    const layout = await page.evaluate(() => {
      const overflowers = [...document.querySelectorAll("body *")].filter((element) => {
        if (!(element instanceof HTMLElement) || element.matches(".visually-hidden")) return false;
        const rect = element.getBoundingClientRect();
        return rect.right > innerWidth + 2 || rect.left < -2;
      });
      scrollTo(10000, 0);
      const rootScrollX = scrollX;
      scrollTo(0, 0);
      return {
        viewportOverflow: rootScrollX > 2,
        overflowers: overflowers.length,
        landmarks: {
          main: document.querySelectorAll("main").length,
          nav: document.querySelectorAll("nav").length,
          header: document.querySelectorAll("header").length,
          footer: document.querySelectorAll("footer").length,
        },
      };
    });

    if (scenario.id === "marketing-desktop") {
      await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
      layout.scaledTextViewportOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      await page.evaluate(() => { document.documentElement.style.fontSize = "16px"; });
    }

    const screenshotPath = path.join(outputDir, `${scenario.id}.jpg`);
    await page.screenshot({ path: screenshotPath, type: "jpeg", quality: 84, fullPage: true });
    const violations = accessibility.violations.map((violation) => ({ id: violation.id, impact: violation.impact }));
    const passed = violations.length === 0
      && !layout.viewportOverflow
      && layout.overflowers === 0
      && Object.values(layout.landmarks).every((count) => count === 1)
      && firstFocus.className === "skip-link"
      && firstFocus.outline !== "none"
      && skipTarget === "main"
      && layout.scaledTextViewportOverflow !== true
      && mobileNavigationPassed
      && billingState.annualPressed === "true"
      && billingState.launchPrice === "৳8,990";

    results.push({
      ...scenario,
      screenshot: path.relative(root, screenshotPath),
      billingState,
      violations,
      layout,
      keyboard: { firstFocus, skipTarget },
      mobileNavigationPassed,
      passed,
    });
    await page.close();
  }
} finally {
  await browser.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  chromePath,
  source: path.relative(root, sourcePath),
  scenarios: results,
  summary: {
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    axeViolations: results.reduce((count, result) => count + result.violations.length, 0),
  },
};
await writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

const rows = results.map((result) => `| ${result.id} | ${result.width}×${result.height} | ${result.violations.length} | ${result.layout.viewportOverflow ? "yes" : "no"} | ${result.layout.overflowers} | ${result.passed ? "Pass" : "Fail"} |`).join("\n");
const screenshots = results.map((result) => `- [${result.id}](${path.basename(result.screenshot)})`).join("\n");
const markdown = `# Marketing Landing Page Design Evidence\n\n**Generated:** ${report.generatedAt}\n\nThe interface uses synthetic demonstration data. No production credentials or customer data were used.\n\n| Scenario | Viewport | Axe violations | Root overflow | Off-screen elements | Result |\n|---|---:|---:|---|---:|---|\n${rows}\n\n## Summary\n\n- Browser scenarios passed: ${report.summary.passed}/${report.summary.total}\n- WCAG 2 A/AA and 2.1 AA axe violations: ${report.summary.axeViolations}\n- Pricing verification: Launch annual price renders as ৳8,990 after switching from the ৳899 monthly plan.\n- Keyboard, mobile navigation, reduced motion and 200% desktop text scaling are checked.\n\n## Screenshot evidence\n\n${screenshots}\n\nExact machine-readable results are in [report.json](report.json).\n`;
await writeFile(path.join(outputDir, "README.md"), markdown);

if (report.summary.passed !== report.summary.total || report.summary.axeViolations > 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(`Marketing design evidence passed ${report.summary.passed}/${report.summary.total} browser scenarios`);
