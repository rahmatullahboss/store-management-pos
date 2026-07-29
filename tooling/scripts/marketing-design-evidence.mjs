import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("../..", import.meta.url));
const sourcePath = path.join(root, "apps", "marketing-web", "src", "index.html");
const outputDir = path.join(root, "docs", "architecture", "marketing", "design-evidence");
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");
const sourceUrl = pathToFileURL(sourcePath).href;

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
    await page.goto(sourceUrl, { waitUntil: "networkidle0" });
    await page.addScriptTag({ content: axeSource });

    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      className: document.activeElement?.className,
      outline: document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : "none",
    }));
    await page.keyboard.press("Enter");
    const skipTarget = await page.evaluate(() => document.activeElement?.id ?? "");

    if (scenario.mobileNavigation) {
      await page.click("[data-nav-toggle]");
      const navigationState = await page.evaluate(() => ({
        expanded: document.querySelector("[data-nav-toggle]")?.getAttribute("aria-expanded"),
        visible: document.querySelector("[data-navigation]")?.classList.contains("is-open"),
      }));
      if (navigationState.expanded !== "true" || navigationState.visible !== true) throw new Error("Mobile navigation did not expose its expanded state");
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
      const ignored = (element) => element.matches(".visually-hidden") || element.closest(".primary-navigation");
      const clipped = [...document.querySelectorAll("body *")]
        .filter((element) => {
          if (!(element instanceof HTMLElement) || ignored(element) || element.innerText.trim().length === 0) return false;
          const style = getComputedStyle(element);
          const allowed = ["auto", "scroll", "hidden", "clip"].includes(style.overflowX) || style.textOverflow === "ellipsis";
          return element.scrollWidth > element.clientWidth + 2 && !allowed;
        })
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          text: element.innerText.trim().slice(0, 80),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));

      const overflowers = [...document.querySelectorAll("body *")]
        .filter((element) => {
          if (!(element instanceof HTMLElement) || ignored(element)) return false;
          const rect = element.getBoundingClientRect();
          return rect.right > innerWidth + 2 || rect.left < -2;
        })
        .slice(0, 12)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className: element.className,
            text: element.innerText.trim().slice(0, 80),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          };
        });

      scrollTo(10000, 0);
      const rootScrollX = scrollX;
      scrollTo(0, 0);

      return {
        viewportOverflow: rootScrollX > 2,
        rootScrollX,
        intrinsicScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        clipped,
        overflowers,
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

    const violations = accessibility.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      nodes: violation.nodes.map((node) => ({ target: node.target, html: node.html, failureSummary: node.failureSummary })),
    }));
    const passed = violations.length === 0
      && !layout.viewportOverflow
      && layout.clipped.length === 0
      && layout.overflowers.length === 0
      && layout.landmarks.main === 1
      && layout.landmarks.nav === 1
      && layout.landmarks.header === 1
      && layout.landmarks.footer === 1
      && firstFocus.className === "skip-link"
      && firstFocus.outline !== "none"
      && skipTarget === "main"
      && layout.scaledTextViewportOverflow !== true
      && billingState.annualPressed === "true"
      && billingState.launchPrice === "৳29,900";

    results.push({
      ...scenario,
      screenshot: path.relative(root, screenshotPath),
      billingState,
      violations,
      layout,
      keyboard: { firstFocus, skipTarget },
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
const rows = results.map((result) => `| ${result.id} | ${result.width}×${result.height} | ${result.violations.length} | ${result.layout.viewportOverflow ? "yes" : "no"} | ${result.layout.clipped.length} | ${result.layout.overflowers.length} | ${result.passed ? "Pass" : "Fail"} |`).join("\n");
const screenshots = results.map((result) => `- [${result.id}](${path.basename(result.screenshot)})`).join("\n");
const markdown = `# Marketing Landing Page Design Evidence\n\n**Generated:** ${report.generatedAt}\n\nThe interface uses synthetic demonstration data. No production credentials or customer data were used.\n\n| Scenario | Viewport | Axe violations | Root overflow | Clipped elements | Off-screen elements | Result |\n|---|---:|---:|---|---:|---:|---|\n${rows}\n\n## Summary\n\n- Browser scenarios passed: ${report.summary.passed}/${report.summary.total}\n- WCAG 2 A/AA and 2.1 AA axe violations: ${report.summary.axeViolations}\n- Keyboard contract: first Tab focuses the visible skip link; Enter moves focus to the main landmark.\n- Monthly/annual pricing control and mobile navigation were exercised.\n- Reduced-motion mode was enabled for both scenarios.\n- Desktop was rechecked at 200% root text size.\n\n## Screenshot evidence\n\n${screenshots}\n\nExact machine-readable results are in [report.json](report.json).\n`;
await writeFile(path.join(outputDir, "README.md"), markdown);

if (report.summary.passed !== report.summary.total || report.summary.axeViolations > 0) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(`Marketing design evidence passed ${report.summary.passed}/${report.summary.total} browser scenarios`);
