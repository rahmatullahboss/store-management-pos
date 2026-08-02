import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createStorefrontWorker } from "../../build/apps/storefront-web/src/index.js";
import { parseStorefrontBootstrapV1 } from "../../build/packages/storefront-contracts/src/index.js";
import { parseStorefrontPublicContentBundleV1 } from "../../build/packages/storefront-contracts/src/public-content.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(
  root,
  "docs",
  "architecture",
  "storefront",
  "design-evidence",
  "public-content",
);
const chromePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axeSource = await readFile(
  path.join(root, "node_modules", "axe-core", "axe.min.js"),
  "utf8",
);

const scenarios = [
  {
    id: "public-home-en-desktop",
    locale: "en-GB",
    direction: "ltr",
    path: "/",
    width: 1440,
    height: 1000,
    screenshot: true,
  },
  {
    id: "public-page-en-mobile",
    locale: "en-GB",
    direction: "ltr",
    path: "/pages/shipping",
    width: 390,
    height: 844,
    screenshot: true,
  },
  {
    id: "public-home-ar-rtl-tablet",
    locale: "ar",
    direction: "rtl",
    path: "/",
    width: 1024,
    height: 900,
    screenshot: true,
  },
];

function contracts(scenario) {
  const arabic = scenario.direction === "rtl";
  const context = {
    tenantId: "synthetic-tenant",
    storefrontId: "synthetic-storefront",
    salesChannelId: "synthetic-channel",
    requestHostname: "shop.example.test",
    canonicalHostname: "shop.example.test",
    locale: scenario.locale,
    currency: "BDT",
    priceListRevision: "price-list:synthetic:v4",
    publicationGeneration: "publication:12",
  };
  const bootstrap = parseStorefrontBootstrapV1({
    contractVersion: "storefront-bootstrap.v1",
    context,
    themeRevision: "theme:3",
    layoutRevision: "layout:7",
    capabilities: ["catalog.read", "content.read"],
  });
  const page = scenario.path.startsWith("/pages/")
    ? {
        slug: "shipping",
        title: arabic ? "الشحن والتسليم" : "Shipping and delivery",
        revision: "content:2",
        content: {
          blocks: [
            {
              type: "text",
              heading: arabic ? "خيارات التسليم" : "Delivery options",
              value: arabic
                ? "تظهر هنا معلومات الشحن المنشورة فقط."
                : "Only published shipping information appears here.",
            },
          ],
        },
        seo: {
          title: arabic ? "معلومات الشحن" : "Shipping information",
          description: arabic
            ? "معلومات الشحن المنشورة."
            : "Published shipping information.",
        },
      }
    : null;
  const content = parseStorefrontPublicContentBundleV1({
    contractVersion: "storefront-public-content.v1",
    context,
    themeRevision: "theme:3",
    layoutRevision: "layout:7",
    theme: { version: "storefront-theme.v1" },
    navigation: {
      header: {
        items: [
          { label: arabic ? "الرئيسية" : "Home", href: "/" },
          {
            label: arabic ? "الشحن" : "Shipping",
            href: "/pages/shipping",
          },
        ],
      },
      footer: {
        items: [
          {
            label: arabic ? "الدعم" : "Support",
            href: "https://support.example.test/",
          },
        ],
      },
    },
    homepage: {
      blocks: [
        {
          type: "hero",
          eyebrow: arabic ? "متجر منشور" : "Published storefront",
          title: arabic ? "تسوق بثقة" : "Shop with confidence",
          body: arabic
            ? "يتم عرض المحتوى المنشور ضمن نطاق المتجر فقط."
            : "Only published, storefront-scoped content is rendered.",
        },
        { type: "future-block", data: { ignored: true } },
      ],
    },
    homepageSeo: {
      title: arabic ? "المتجر المنشور" : "Published Store",
      description: arabic
        ? "واجهة متجر آمنة ومتاحة للجمهور."
        : "A safe published storefront experience.",
    },
    page,
  });
  return { bootstrap, content };
}

function workerFor(scenario) {
  const { bootstrap, content } = contracts(scenario);
  return createStorefrontWorker({
    resolverFactory: () => ({ async resolve() { return bootstrap; } }),
    contentResolverFactory: () => ({ async resolve() { return content; } }),
  });
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
const results = [];

try {
  for (const scenario of scenarios) {
    const response = await workerFor(scenario).fetch(
      new Request(`https://shop.example.test${scenario.path}`),
      {
        STOREFRONT_STAGE: "production",
        STOREFRONT_API_BASE_URL: "https://api.example.test",
        STOREFRONT_PLATFORM_BASE_DOMAIN: "shops.example.test",
        STOREFRONT_BUILD_ID: "h3-content-evidence",
      },
    );
    const html = await response.text();
    const page = await browser.newPage();
    await page.setViewport({
      width: scenario.width,
      height: scenario.height,
      deviceScaleFactor: 1,
    });
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    await page.setContent(html, { waitUntil: "load" });
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
      const allowed = ".nav,.nav ul";
      const clipped = [...document.querySelectorAll("body *")]
        .filter((element) => {
          if (
            !(element instanceof HTMLElement) ||
            element.innerText.trim().length === 0 ||
            element.closest(allowed)
          ) {
            return false;
          }
          const style = getComputedStyle(element);
          if (
            style.overflowX === "auto" ||
            style.overflowX === "scroll" ||
            style.textOverflow === "ellipsis"
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
        h1Count: document.querySelectorAll("h1").length,
        language: document.documentElement.lang,
        direction: document.documentElement.dir,
        hasPublishedNavigation:
          document.querySelector('a[href="/pages/shipping"]') !== null,
        leakedScope:
          document.body.textContent?.includes("synthetic-tenant") === true ||
          document.body.textContent?.includes("synthetic-storefront") === true ||
          document.body.textContent?.includes("synthetic-channel") === true,
        renderedFutureBlock:
          document.body.textContent?.includes("future-block") === true,
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
    if (scenario.id === "public-home-en-desktop") {
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
      scaledOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      );
    }
    const screenshotPath = path.join(outputDir, `${scenario.id}.jpg`);
    await page.screenshot({
      path: screenshotPath,
      type: "jpeg",
      quality: 82,
      fullPage: true,
    });
    const violations = accessibility.violations.map((item) => ({
      id: item.id,
      impact: item.impact,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        failureSummary: node.failureSummary,
      })),
    }));
    const passed =
      response.status === 200 &&
      violations.length === 0 &&
      !layout.viewportOverflow &&
      layout.clipped.length === 0 &&
      layout.overflowers.length === 0 &&
      layout.mainLandmarks === 1 &&
      layout.h1Count === 1 &&
      layout.language === scenario.locale &&
      layout.direction === scenario.direction &&
      layout.hasPublishedNavigation &&
      !layout.leakedScope &&
      !layout.renderedFutureBlock &&
      firstFocus.className === "skip-link" &&
      firstFocus.outline !== "none" &&
      skipTarget === "main-content" &&
      !scaledOverflow;
    results.push({
      ...scenario,
      responseStatus: response.status,
      screenshot: path.relative(root, screenshotPath),
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
      `| ${item.id} | ${item.width}×${item.height} | ${item.locale}/${item.direction} | ${item.responseStatus} | ${item.violations.length} | ${item.layout.viewportOverflow ? "yes" : "no"} | ${item.layout.clipped.length} | ${item.passed ? "Pass" : "Fail"} |`,
  )
  .join("\n");
const screenshots = results
  .map((item) => `- [${item.id}](${path.basename(item.screenshot)})`)
  .join("\n");
await writeFile(
  path.join(outputDir, "README.md"),
  `# H3 Public Content Browser Evidence\n\n**Generated:** ${report.generatedAt}\n\nSynthetic published contracts only. No production credentials or customer data were used.\n\n| Scenario | Viewport | Locale | HTTP | Axe violations | Overflow | Clipping | Result |\n|---|---:|---|---:|---:|---|---:|---|\n${rows}\n\n- Browser scenarios passed: ${report.summary.passed}/${report.summary.total}\n- WCAG axe violations: ${report.summary.axeViolations}\n- Unexpected clipped elements: ${report.summary.clipped}\n- First Tab focuses the skip link and Enter moves focus to the single main landmark.\n- English desktop is rechecked at 200% text size.\n- Public navigation is present, unsupported future blocks are ignored, and tenant/storefront/channel identifiers are absent.\n\n## Screenshots\n\n${screenshots}\n`,
);
if (
  report.summary.passed !== report.summary.total ||
  report.summary.axeViolations > 0
) {
  process.exit(1);
}
console.log(
  `H3 public content evidence passed ${report.summary.passed}/${report.summary.total} scenarios`,
);
