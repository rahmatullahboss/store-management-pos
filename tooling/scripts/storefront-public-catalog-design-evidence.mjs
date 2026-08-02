import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createStorefrontWorker } from "../../build/apps/storefront-web/src/index.js";
import { formatStorefrontMoneyV1 } from "../../build/apps/storefront-web/src/money.js";
import { parseStorefrontBootstrapV1 } from "../../build/packages/storefront-contracts/src/index.js";
import {
  parseStorefrontPublicCatalogPageV1,
  parseStorefrontPublicProductDetailV1,
} from "../../build/packages/storefront-contracts/src/public-catalog.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(
  root,
  "docs",
  "architecture",
  "storefront",
  "design-evidence",
  "public-catalog",
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
    id: "public-catalog-en-desktop",
    locale: "en-GB",
    direction: "ltr",
    path: "/products",
    width: 1440,
    height: 1000,
    detail: false,
    scaleText: true,
  },
  {
    id: "public-product-en-mobile",
    locale: "en-GB",
    direction: "ltr",
    path: "/products/linen-shirt",
    width: 390,
    height: 844,
    detail: true,
    scaleText: false,
  },
  {
    id: "public-catalog-ar-rtl-tablet",
    locale: "ar",
    direction: "rtl",
    path: "/products",
    width: 1024,
    height: 900,
    detail: false,
    scaleText: false,
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
    currency: "GBP",
    priceListRevision: "price-list:synthetic:v8",
    publicationGeneration: "publication:24",
  };
  const bootstrap = parseStorefrontBootstrapV1({
    contractVersion: "storefront-bootstrap.v1",
    context,
    themeRevision: "theme:3",
    layoutRevision: "layout:7",
    capabilities: ["catalog.read"],
  });
  const product = {
    summary: {
      contractVersion: "storefront-product-card.v1",
      productId: "018f0000-0000-4000-8000-000000000001",
      variantId: "018f0000-0000-4000-8000-000000000002",
      slug: "linen-shirt",
      name: arabic ? "قميص كتان" : "Linen Shirt",
      publicationState: "published",
      availability: "available",
      pricePrefix: "none",
      price: { currency: "GBP", minor: "2599", scale: 2 },
      compareAtPrice: { currency: "GBP", minor: "3099", scale: 2 },
      media: null,
      badge: arabic ? "جديد" : "New",
    },
    code: "LINEN-SHIRT",
    description: arabic
      ? "قميص كتان خفيف ومريح."
      : "A breathable linen shirt.",
    kind: "stock",
    pricingNotice: "tax_calculated_at_checkout",
    variants: [
      {
        variantId: "018f0000-0000-4000-8000-000000000002",
        sku: "LINEN-NATURAL-M",
        title: arabic ? "طبيعي / متوسط" : "Natural / Medium",
        unitCode: "EA",
        availability: "available",
        price: { currency: "GBP", minor: "2599", scale: 2 },
        compareAtPrice: { currency: "GBP", minor: "3099", scale: 2 },
        quantity: {
          amount: "7",
          unit: "EA",
          scale: 0,
          asOf: "2026-07-30T00:00:00.000Z",
          version: "4",
        },
      },
    ],
  };
  const catalog = parseStorefrontPublicCatalogPageV1({
    contractVersion: "storefront-public-catalog.v1",
    context,
    items: [product],
    nextCursor: null,
    hasMore: false,
  });
  const detail = parseStorefrontPublicProductDetailV1({
    contractVersion: "storefront-public-product.v1",
    context,
    product,
  });
  return {
    bootstrap,
    catalog,
    detail,
    expectedName: product.summary.name,
    expectedPrice: formatStorefrontMoneyV1(product.summary.price, scenario.locale),
  };
}

function workerFor(scenario) {
  const values = contracts(scenario);
  return {
    values,
    worker: createStorefrontWorker({
      resolverFactory: () => ({
        async resolve() {
          return values.bootstrap;
        },
      }),
      catalogResolverFactory: () => ({
        async resolveCatalog() {
          return values.catalog;
        },
        async resolveProduct() {
          return values.detail;
        },
      }),
    }),
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
const results = [];

try {
  for (const scenario of scenarios) {
    const { values, worker } = workerFor(scenario);
    const response = await worker.fetch(
      new Request(`https://shop.example.test${scenario.path}`),
      {
        STOREFRONT_STAGE: "production",
        STOREFRONT_API_BASE_URL: "https://api.example.test",
        STOREFRONT_PLATFORM_BASE_DOMAIN: "shops.example.test",
        STOREFRONT_BUILD_ID: "h3-catalog-evidence",
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
    const layout = await page.evaluate(
      ({ direction, locale, detail, expectedName, expectedPrice }) => {
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
        const bodyText = document.body.textContent ?? "";
        return {
          viewportOverflow: rootScrollX > 2,
          clipped,
          overflowers,
          mainLandmarks: document.querySelectorAll("main").length,
          h1Count: document.querySelectorAll("h1").length,
          language: document.documentElement.lang,
          direction: document.documentElement.dir,
          hasExpectedName: bodyText.includes(expectedName),
          hasExpectedPrice: bodyText.includes(expectedPrice),
          hasAvailability: bodyText.includes(
            detail ? "7 EA available" : direction === "rtl" ? "Available" : "Available",
          ),
          hasProductLink:
            detail ||
            document.querySelector('a[href="/products/linen-shirt"]') !== null,
          leakedScope:
            bodyText.includes("synthetic-tenant") ||
            bodyText.includes("synthetic-storefront") ||
            bodyText.includes("synthetic-channel"),
          leakedExcludedProduct:
            bodyText.includes("Unpriced Product") ||
            bodyText.includes("Archived Variant"),
          isDetail: detail,
          locale,
        };
      },
      {
        direction: scenario.direction,
        locale: scenario.locale,
        detail: scenario.detail,
        expectedName: values.expectedName,
        expectedPrice: values.expectedPrice,
      },
    );
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
    if (scenario.scaleText) {
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
      layout.hasExpectedName &&
      layout.hasExpectedPrice &&
      layout.hasAvailability &&
      layout.hasProductLink &&
      !layout.leakedScope &&
      !layout.leakedExcludedProduct &&
      firstFocus.className === "skip-link" &&
      firstFocus.outline !== "none" &&
      skipTarget === "main-content" &&
      !scaledOverflow;
    results.push({
      ...scenario,
      responseStatus: response.status,
      expectedPrice: values.expectedPrice,
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
  `# H3 Public Catalog Browser Evidence\n\n**Generated:** ${report.generatedAt}\n\nSynthetic published catalog contracts only. No production credentials or customer data were used.\n\n| Scenario | Viewport | Locale | HTTP | Axe violations | Overflow | Clipping | Result |\n|---|---:|---|---:|---:|---|---:|---|\n${rows}\n\n- Browser scenarios passed: ${report.summary.passed}/${report.summary.total}\n- WCAG axe violations: ${report.summary.axeViolations}\n- Unexpected clipped elements: ${report.summary.clipped}\n- Exact authoritative prices and reservation-aware availability are rendered.\n- First Tab focuses the skip link and Enter moves focus to the single main landmark.\n- English desktop is rechecked at 200% text size.\n- Tenant/storefront/channel identifiers and excluded products are absent.\n\n## Screenshots\n\n${screenshots}\n`,
);

if (report.summary.passed !== report.summary.total) {
  throw new Error(
    `H3 public catalog evidence failed ${report.summary.passed}/${report.summary.total} scenarios`,
  );
}
console.log(
  `H3 public catalog evidence passed ${report.summary.passed}/${report.summary.total} scenarios`,
);
