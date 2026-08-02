import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createStorefrontWorker } from "../../build/apps/storefront-web/src/index.js";
import { formatStorefrontMoneyV1 } from "../../build/apps/storefront-web/src/money.js";
import { parseStorefrontBootstrapV1 } from "../../build/packages/storefront-contracts/src/index.js";
import {
  parseStorefrontPublicCategoryPageV1,
  parseStorefrontPublicCollectionPageV1,
  parseStorefrontPublicSearchPageV1,
} from "../../build/packages/storefront-contracts/src/public-discovery.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(
  root,
  "docs",
  "architecture",
  "storefront",
  "design-evidence",
  "public-discovery",
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
    id: "public-category-en-desktop",
    kind: "category",
    locale: "en-GB",
    direction: "ltr",
    path: "/categories/shirts",
    width: 1440,
    height: 1000,
    scaleText: false,
  },
  {
    id: "public-collection-en-mobile",
    kind: "collection",
    locale: "en-GB",
    direction: "ltr",
    path: "/collections/summer-edit",
    width: 390,
    height: 844,
    scaleText: false,
  },
  {
    id: "public-search-ar-rtl-200-percent",
    kind: "search",
    locale: "ar",
    direction: "rtl",
    path: "/search?q=منتج%20غير%20موجود",
    width: 1024,
    height: 900,
    scaleText: true,
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
    priceListRevision: "price-list:synthetic:v9",
    publicationGeneration: "publication:31",
  };
  const bootstrap = parseStorefrontBootstrapV1({
    contractVersion: "storefront-bootstrap.v1",
    context,
    themeRevision: "theme:4",
    layoutRevision: "layout:8",
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
      compareAtPrice: null,
      media: null,
      badge: arabic ? "جديد" : "New",
    },
    code: "LINEN-SHIRT",
    description: arabic ? "قميص كتان خفيف." : "A breathable linen shirt.",
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
        compareAtPrice: null,
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
  const category = parseStorefrontPublicCategoryPageV1({
    contractVersion: "storefront-public-category.v1",
    context,
    category: {
      categoryId: "018f0000-0000-4000-8000-000000000011",
      slug: "shirts",
      title: arabic ? "قمصان" : "Shirts",
      description: arabic ? "قمصان منشورة." : "Published shirts.",
      parentCategoryId: "018f0000-0000-4000-8000-000000000010",
      parentSlug: "clothing",
      breadcrumbs: [
        {
          categoryId: "018f0000-0000-4000-8000-000000000010",
          slug: "clothing",
          title: arabic ? "ملابس" : "Clothing",
        },
        {
          categoryId: "018f0000-0000-4000-8000-000000000011",
          slug: "shirts",
          title: arabic ? "قمصان" : "Shirts",
        },
      ],
      children: [],
    },
    items: [product],
    nextCursor: null,
    hasMore: false,
  });
  const collection = parseStorefrontPublicCollectionPageV1({
    contractVersion: "storefront-public-collection.v1",
    context,
    collection: {
      collectionId: "018f0000-0000-4000-8000-000000000020",
      code: "summer-edit",
      slug: "summer-edit",
      title: arabic ? "مختارات الصيف" : "Summer Edit",
      description: arabic ? "مجموعة منشورة." : "A published seasonal collection.",
      version: "2",
    },
    items: [product],
    nextCursor: null,
    hasMore: false,
  });
  const search = parseStorefrontPublicSearchPageV1({
    contractVersion: "storefront-public-search.v1",
    context,
    query: arabic ? "منتج غير موجود" : "missing product",
    items: [],
    facets: { categories: [], availability: [] },
    nextCursor: null,
    hasMore: false,
  });
  return {
    bootstrap,
    category,
    collection,
    search,
    expectedTitle:
      scenario.kind === "category"
        ? category.category.title
        : scenario.kind === "collection"
          ? collection.collection.title
          : "No published products matched",
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
          return null;
        },
        async resolveProduct() {
          return null;
        },
        async resolveCategory() {
          return values.category;
        },
        async resolveCollection() {
          return values.collection;
        },
        async resolveSearch() {
          return values.search;
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
        STOREFRONT_BUILD_ID: "h3-discovery-evidence",
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
    if (scenario.scaleText) {
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
      });
    }
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
      ({ direction, locale, kind, expectedTitle, expectedPrice }) => {
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
          hasExpectedTitle: bodyText.includes(expectedTitle),
          hasExpectedPrice:
            kind === "search" || bodyText.includes(expectedPrice),
          hasSearchForm:
            kind !== "search" ||
            document.querySelector('form[role="search"] input[name="q"]') !== null,
          hasProductLink:
            kind === "search" ||
            document.querySelector('a[href="/products/linen-shirt"]') !== null,
          leakedScope:
            bodyText.includes("synthetic-tenant") ||
            bodyText.includes("synthetic-storefront") ||
            bodyText.includes("synthetic-channel"),
          leakedAuthorityClaim:
            bodyText.includes("guaranteed stock") ||
            bodyText.includes("final tax"),
        };
      },
      {
        direction: scenario.direction,
        locale: scenario.locale,
        kind: scenario.kind,
        expectedTitle: values.expectedTitle,
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
      layout.hasExpectedTitle &&
      layout.hasExpectedPrice &&
      layout.hasSearchForm &&
      layout.hasProductLink &&
      !layout.leakedScope &&
      !layout.leakedAuthorityClaim &&
      firstFocus.className === "skip-link" &&
      firstFocus.outline !== "none" &&
      skipTarget === "main-content";
    results.push({
      ...scenario,
      responseStatus: response.status,
      screenshot: path.relative(root, screenshotPath),
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
const rows = results.map((item) =>
  `| ${item.id} | ${item.width}×${item.height} | ${item.locale}/${item.direction} | ${item.responseStatus} | ${item.violations.length} | ${item.passed ? "pass" : "fail"} |`,
).join("\n");
await writeFile(
  path.join(outputDir, "README.md"),
  `# H3 public discovery design evidence\n\n| Scenario | Viewport | Locale/direction | HTTP | Axe violations | Result |\n|---|---:|---|---:|---:|---|\n${rows}\n`,
);

if (report.summary.passed !== report.summary.total) {
  throw new Error(
    `Public discovery evidence failed: ${report.summary.passed}/${report.summary.total}`,
  );
}
console.log(
  `Public discovery evidence passed ${report.summary.passed}/${report.summary.total} with ${report.summary.axeViolations} Axe violations.`,
);
