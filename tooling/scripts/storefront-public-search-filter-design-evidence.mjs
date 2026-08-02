import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { createStorefrontWorker } from "../../build/apps/storefront-web/src/index.js";
import { parseStorefrontBootstrapV1 } from "../../build/packages/storefront-contracts/src/index.js";
import { parseStorefrontPublicSearchPageV1 } from "../../build/packages/storefront-contracts/src/public-discovery.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outputDir = path.join(
  root,
  "docs",
  "architecture",
  "storefront",
  "design-evidence",
  "public-search-filters",
);
const chromePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axeSource = await readFile(
  path.join(root, "node_modules", "axe-core", "axe.min.js"),
  "utf8",
);

const context = {
  tenantId: "synthetic-tenant",
  storefrontId: "synthetic-storefront",
  salesChannelId: "synthetic-channel",
  requestHostname: "shop.example.test",
  canonicalHostname: "shop.example.test",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:filter:v1",
  publicationGeneration: "publication:filter:1",
};
const bootstrap = parseStorefrontBootstrapV1({
  contractVersion: "storefront-bootstrap.v1",
  context,
  themeRevision: "theme:filter:1",
  layoutRevision: "layout:filter:1",
  capabilities: ["catalog.read"],
});
const searchPage = Object.freeze({
  ...parseStorefrontPublicSearchPageV1({
    contractVersion: "storefront-public-search.v1",
    context,
    query: "linen shirt",
    items: [
      {
        summary: {
          contractVersion: "storefront-product-card.v1",
          productId: "018f0000-0000-4000-8000-000000000001",
          variantId: "018f0000-0000-4000-8000-000000000002",
          slug: "linen-shirt",
          name: "Linen Shirt",
          publicationState: "published",
          availability: "available",
          pricePrefix: "none",
          price: { currency: "GBP", minor: "2599", scale: 2 },
          compareAtPrice: null,
          media: null,
          badge: "New",
        },
        code: "LINEN-SHIRT",
        description: "A breathable linen shirt.",
        kind: "stock",
        pricingNotice: "tax_calculated_at_checkout",
        variants: [
          {
            variantId: "018f0000-0000-4000-8000-000000000002",
            sku: "LINEN-NATURAL-M",
            title: "Natural / Medium",
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
      },
    ],
    facets: {
      categories: [
        {
          categoryId: "018f0000-0000-4000-8000-000000000011",
          slug: "shirts",
          title: "Shirts",
          count: 1,
        },
      ],
      availability: [{ value: "available", count: 1 }],
    },
    nextCursor: null,
    hasMore: false,
  }),
  selectedCategory: "shirts",
  selectedAvailability: "available",
});
let observedOptions;
const worker = createStorefrontWorker({
  resolverFactory: () => ({ async resolve() { return bootstrap; } }),
  catalogResolverFactory: () => ({
    async resolveCatalog() { return null; },
    async resolveProduct() { return null; },
    async resolveCategory() { return null; },
    async resolveCollection() { return null; },
    async resolveSearch(_hostname, _query, options) {
      observedOptions = options;
      return searchPage;
    },
  }),
});
const request = new Request(
  "https://shop.example.test/search?q=linen%20shirt&category=shirts&availability=available",
);
const response = await worker.fetch(request, {
  STOREFRONT_STAGE: "production",
  STOREFRONT_API_BASE_URL: "https://api.example.test",
  STOREFRONT_PLATFORM_BASE_DOMAIN: "shops.example.test",
  STOREFRONT_BUILD_ID: "h3-search-filter-evidence",
});
const html = await response.text();

await mkdir(outputDir, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
let result;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
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
    const bodyText = document.body.textContent ?? "";
    const active = [...document.querySelectorAll('a[aria-current="true"]')]
      .map((anchor) => ({ text: anchor.textContent?.trim(), href: anchor.getAttribute("href") }));
    const clear = document.querySelector("a.button-link");
    const category = document.querySelector('input[type="hidden"][name="category"]');
    const availability = document.querySelector('input[type="hidden"][name="availability"]');
    scrollTo(10000, 0);
    const overflow = scrollX > 2;
    scrollTo(0, 0);
    return {
      active,
      clearHref: clear?.getAttribute("href") ?? null,
      categoryValue: category?.getAttribute("value") ?? null,
      availabilityValue: availability?.getAttribute("value") ?? null,
      overflow,
      mainCount: document.querySelectorAll("main").length,
      h1Count: document.querySelectorAll("h1").length,
      hasPrice: bodyText.includes("£25.99"),
      hasClear: bodyText.includes("Clear filters"),
      hasTaxNotice: bodyText.includes("Tax calculated at checkout"),
      leakedScope:
        bodyText.includes("synthetic-tenant") ||
        bodyText.includes("synthetic-storefront") ||
        bodyText.includes("synthetic-channel"),
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
  const skipTarget = await page.evaluate(() => document.activeElement?.id ?? "");
  const screenshotPath = path.join(outputDir, "applied-filters-en-desktop.jpg");
  await page.screenshot({
    path: screenshotPath,
    type: "jpeg",
    quality: 82,
    fullPage: true,
  });
  result = {
    responseStatus: response.status,
    observedOptions,
    violations: accessibility.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
    })),
    layout,
    keyboard: { firstFocus, skipTarget },
    screenshot: path.relative(root, screenshotPath),
  };
} finally {
  await browser.close();
}

const passed =
  result.responseStatus === 200 &&
  result.observedOptions?.category === "shirts" &&
  result.observedOptions?.availability === "available" &&
  result.violations.length === 0 &&
  result.layout.active.length === 2 &&
  result.layout.clearHref === "/search?q=linen+shirt" &&
  result.layout.categoryValue === "shirts" &&
  result.layout.availabilityValue === "available" &&
  !result.layout.overflow &&
  result.layout.mainCount === 1 &&
  result.layout.h1Count === 1 &&
  result.layout.hasPrice &&
  result.layout.hasClear &&
  result.layout.hasTaxNotice &&
  !result.layout.leakedScope &&
  result.keyboard.firstFocus.className === "skip-link" &&
  result.keyboard.firstFocus.outline !== "none" &&
  result.keyboard.skipTarget === "main-content";

const report = {
  generatedAt: new Date().toISOString(),
  syntheticOnly: true,
  passed,
  ...result,
};
await writeFile(
  path.join(outputDir, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
await writeFile(
  path.join(outputDir, "README.md"),
  `# Applied public search filter evidence\n\n- Result: ${passed ? "pass" : "fail"}\n- HTTP: ${result.responseStatus}\n- Axe violations: ${result.violations.length}\n- Active facets: ${result.layout.active.length}\n- Screenshot: ${result.screenshot}\n`,
);
if (!passed) {
  throw new Error("Applied public search filter browser evidence failed.");
}
console.log("Applied public search filter browser evidence passed with zero Axe violations.");
