import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import {
  renderStorefrontAdminPage,
} from "../../build/apps/admin-web/src/app-shell/index.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(
  root,
  "docs",
  "architecture",
  "storefront",
  "admin-design-evidence",
);
const chromePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axePath = path.join(root, "node_modules", "axe-core", "axe.min.js");
const permissions = new Set([
  "storefront.storefront.read",
  "storefront.storefront.manage",
  "storefront.publication.manage",
  "storefront.content.manage",
  "storefront.domain.manage",
]);
const scenarios = [
  {
    id: "storefront-admin-desktop",
    state: "ready",
    locale: "en-GB",
    direction: "ltr",
    width: 1440,
    height: 1000,
    screenshot: true,
  },
  {
    id: "storefront-admin-rtl-tablet",
    state: "ready",
    locale: "ar",
    direction: "rtl",
    width: 1024,
    height: 900,
    screenshot: true,
  },
  {
    id: "storefront-admin-empty-mobile",
    state: "empty",
    locale: "en-GB",
    direction: "ltr",
    width: 390,
    height: 844,
    screenshot: true,
  },
  {
    id: "storefront-admin-denied-mobile",
    state: "denied",
    locale: "en-GB",
    direction: "ltr",
    width: 390,
    height: 844,
    screenshot: false,
  },
];

function shell(scenario) {
  return {
    displayName: "Synthetic Operator",
    tenantName:
      scenario.direction === "rtl" ? "متجر تجريبي" : "Synthetic Store",
    permissions: scenario.state === "denied" ? new Set() : permissions,
    direction: scenario.direction,
    locale: scenario.locale,
    location: scenario.direction === "rtl" ? "جميع المواقع" : "All locations",
    businessDate: "Business date · 30 Jul 2026",
  };
}

function fixture(scenario) {
  const ready = scenario.state === "ready";
  return {
    state: scenario.state,
    tenantName:
      scenario.direction === "rtl" ? "متجر تجريبي" : "Synthetic Store",
    observedAtLabel: "07:15 Asia/Dhaka",
    summary: {
      storefrontCount: ready ? 2 : 0,
      activeChannelCount: ready ? 3 : 0,
      publishedItemCount: ready ? 42 : 0,
      scheduledItemCount: ready ? 4 : 0,
      domainAttentionCount: ready ? 1 : 0,
    },
    storefronts: ready
      ? [
          {
            storefrontId: "storefront-main",
            displayName:
              scenario.direction === "rtl" ? "المتجر الرئيسي" : "Main store",
            status: "active",
            channelCount: 2,
            primaryDomain: "shop.example.test",
            domainStatus: "active",
            locale: scenario.locale,
            currency: "BDT",
            updatedAtLabel: "2 minutes ago",
          },
          {
            storefrontId: "storefront-wholesale",
            displayName:
              scenario.direction === "rtl" ? "متجر الجملة" : "Wholesale",
            status: "draft",
            channelCount: 1,
            primaryDomain: "wholesale.example.test",
            domainStatus: "verification_pending",
            locale: scenario.locale,
            currency: "BDT",
            updatedAtLabel: "18 minutes ago",
          },
        ]
      : [],
    publicationQueue: ready
      ? [
          {
            id: "publication-1",
            kind: "variant",
            label:
              scenario.direction === "rtl"
                ? "قميص كتان · أزرق كبير"
                : "Linen shirt · blue large",
            state: "published",
            scopeLabel: "Main storefront · Online",
            revisionLabel: "Version 8",
            updatedAtLabel: "3 minutes ago",
          },
          {
            id: "content-1",
            kind: "content_page",
            label:
              scenario.direction === "rtl" ? "سياسة الشحن" : "Shipping policy",
            state: "scheduled",
            scopeLabel: "Main storefront",
            revisionLabel: "Revision 3",
            scheduledForLabel: "1 Aug 2026 · 10:00",
            updatedAtLabel: "9 minutes ago",
          },
        ]
      : [],
    canManageStorefront: scenario.state !== "denied",
    canManagePublication: scenario.state !== "denied",
    canManageContent: scenario.state !== "denied",
    canManageDomains: scenario.state !== "denied",
  };
}

await mkdir(outputDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--font-render-hinting=none",
  ],
});
const axeSource = await readFile(axePath, "utf8");
const results = [];

try {
  for (const scenario of scenarios) {
    const page = await browser.newPage();
    await page.setViewport({
      width: scenario.width,
      height: scenario.height,
      deviceScaleFactor: 1,
    });
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    await page.setContent(
      renderStorefrontAdminPage(shell(scenario), fixture(scenario)),
      { waitUntil: "load" },
    );
    await page.addScriptTag({ content: axeSource });
    const accessibility = await page.evaluate(async () =>
      globalThis.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21aa"],
        },
      }),
    );
    const layout = await page.evaluate(() => {
      const allowed = ".primary-nav,.modh-table";
      const clipped = [...document.querySelectorAll("body *")]
        .filter((element) => {
          if (
            !(element instanceof HTMLElement) ||
            element.innerText.trim().length === 0
          ) {
            return false;
          }
          const style = getComputedStyle(element);
          if (
            style.overflowX === "auto" ||
            style.overflowX === "scroll" ||
            style.textOverflow === "ellipsis" ||
            element.closest(allowed)
          ) {
            return false;
          }
          return element.scrollWidth > element.clientWidth + 2;
        })
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
      const overflowers = [...document.querySelectorAll("body *")]
        .filter((element) => {
          if (!(element instanceof HTMLElement) || element.closest(allowed)) {
            return false;
          }
          const rect = element.getBoundingClientRect();
          return rect.right > innerWidth + 2 || rect.left < -2;
        })
        .slice(0, 12)
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
        }));
      scrollTo(10000, 0);
      const rootScrollX = scrollX;
      scrollTo(0, 0);
      return {
        viewportOverflow: rootScrollX > 2,
        clipped,
        overflowers,
        mainLandmarks: document.querySelectorAll("main").length,
        language: document.documentElement.lang,
        direction: document.documentElement.dir,
        currentStorefrontLinks: document.querySelectorAll(
          'a[href="/storefront"][aria-current="page"]',
        ).length,
      };
    });
    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => ({
      className: document.activeElement?.className,
      outline: document.activeElement
        ? getComputedStyle(document.activeElement).outlineStyle
        : "none",
    }));
    await page.keyboard.press("Enter");
    const skipTarget = await page.evaluate(
      () => document.activeElement?.id ?? "",
    );
    let scaledOverflow = false;
    if (scenario.id === "storefront-admin-desktop") {
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      scaledOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      );
    }
    let screenshotPath = null;
    if (scenario.screenshot) {
      screenshotPath = path.join(outputDir, `${scenario.id}.jpg`);
      await page.screenshot({
        path: screenshotPath,
        type: "jpeg",
        quality: 82,
        fullPage: true,
      });
    }
    const violations = accessibility.violations.map((item) => ({
      id: item.id,
      impact: item.impact,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        failureSummary: node.failureSummary,
      })),
    }));
    const expectedCurrentLinks = scenario.state === "denied" ? 0 : 1;
    const passed =
      violations.length === 0 &&
      !layout.viewportOverflow &&
      layout.clipped.length === 0 &&
      layout.overflowers.length === 0 &&
      layout.mainLandmarks === 1 &&
      layout.currentStorefrontLinks === expectedCurrentLinks &&
      firstFocus.className === "skip-link" &&
      firstFocus.outline !== "none" &&
      skipTarget === "main" &&
      layout.language === scenario.locale &&
      layout.direction === scenario.direction &&
      !scaledOverflow;
    results.push({
      ...scenario,
      screenshot: screenshotPath ? path.relative(root, screenshotPath) : null,
      violations,
      layout,
      keyboard: { firstFocus, skipTarget },
      scaledOverflow,
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
  syntheticOnly: true,
  scenarios: results,
  summary: {
    passed: results.filter((item) => item.passed).length,
    total: results.length,
    axeViolations: results.reduce(
      (count, item) => count + item.violations.length,
      0,
    ),
    clipped: results.reduce(
      (count, item) => count + item.layout.clipped.length,
      0,
    ),
  },
};
await writeFile(
  path.join(outputDir, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
const rows = results
  .map(
    (item) =>
      `| ${item.id} | ${item.width}×${item.height} | ${item.locale}/${item.direction} | ${item.state} | ${item.violations.length} | ${item.layout.viewportOverflow ? "yes" : "no"} | ${item.layout.clipped.length} | ${item.passed ? "Pass" : "Fail"} |`,
  )
  .join("\n");
const screenshots = results
  .filter((item) => item.screenshot)
  .map((item) => `- [${item.id}](${path.basename(item.screenshot)})`)
  .join("\n");
await writeFile(
  path.join(outputDir, "README.md"),
  `# Storefront Admin Design Evidence\n\n**Generated:** ${report.generatedAt}\n\nSynthetic fixtures only. No production credentials or customer data were used.\n\n| Scenario | Viewport | Locale | State | Axe violations | Overflow | Clipping | Result |\n|---|---:|---|---|---:|---|---:|---|\n${rows}\n\n- Browser scenarios passed: ${report.summary.passed}/${report.summary.total}\n- WCAG axe violations: ${report.summary.axeViolations}\n- Unexpected clipped elements: ${report.summary.clipped}\n- First Tab focuses the skip link and Enter moves focus to the single main landmark.\n- Storefront desktop is rechecked at 200% text size.\n- Denied users receive no storefront navigation link.\n\n## Screenshots\n\n${screenshots}\n`,
);
if (
  report.summary.passed !== report.summary.total ||
  report.summary.axeViolations > 0
) {
  process.exit(1);
}
console.log(
  `Storefront admin design evidence passed ${report.summary.passed}/${report.summary.total} scenarios`,
);
