import assert from "node:assert/strict";
import test from "node:test";
import {
  parseStorefrontPublicProductDetailV1,
} from "../../build/packages/storefront-contracts/src/public-catalog.js";
import {
  parseStorefrontPublicSeoBundleV1,
} from "../../build/packages/storefront-contracts/src/public-seo.js";
import {
  isStorefrontDiscoveryPath,
  normalizeStorefrontCanonicalPath,
  renderStorefrontProductStructuredData,
  renderStorefrontRobotsTxt,
  renderStorefrontSitemapXml,
} from "../../build/apps/storefront-web/src/seo.js";

const context = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  storefrontId: "10000000-0000-4000-8000-000000000100",
  salesChannelId: "10000000-0000-4000-8000-000000000110",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v1",
  publicationGeneration: "publication:14",
};

function seoPayload(overrides = {}) {
  return {
    contractVersion: "storefront-public-seo.v1",
    context,
    indexable: true,
    sitemapPath: "/sitemap.xml",
    disallow: ["/checkout", "/account"],
    entries: [
      {
        kind: "home",
        path: "/",
        lastModified: "2026-07-30T10:00:00.000Z",
        changeFrequency: "daily",
      },
      {
        kind: "product",
        path: "/products/linen-shirt&summer",
        lastModified: "2026-07-29T10:00:00.000Z",
        changeFrequency: "weekly",
      },
      {
        kind: "content",
        path: "/pages/delivery",
        lastModified: null,
        changeFrequency: "monthly",
      },
    ],
    ...overrides,
  };
}

test("public SEO contract accepts one root and rejects unsafe or duplicate paths", () => {
  const seo = parseStorefrontPublicSeoBundleV1(seoPayload());
  assert.equal(seo.entries.length, 3);
  assert.equal(seo.entries[0].lastModified, "2026-07-30T10:00:00.000Z");

  assert.throws(
    () => parseStorefrontPublicSeoBundleV1(seoPayload({
      entries: [
        seoPayload().entries[0],
        { ...seoPayload().entries[1], path: "/../private" },
      ],
    })),
    /path is invalid/u,
  );
  assert.throws(
    () => parseStorefrontPublicSeoBundleV1(seoPayload({
      entries: [seoPayload().entries[0], { ...seoPayload().entries[1], path: "/" }],
    })),
    /duplicate paths/u,
  );
  assert.throws(
    () => parseStorefrontPublicSeoBundleV1(seoPayload({ entries: [seoPayload().entries[1]] })),
    /exactly one home/u,
  );
});

test("canonical path normalization removes duplicate and trailing separators but denies traversal", () => {
  assert.equal(normalizeStorefrontCanonicalPath("/products//linen-shirt/"), "/products/linen-shirt");
  assert.equal(isStorefrontDiscoveryPath("/products/linen-shirt"), true);
  assert.equal(isStorefrontDiscoveryPath("/checkout"), false);
  assert.equal(isStorefrontDiscoveryPath("/api/catalog"), false);
  assert.throws(() => normalizeStorefrontCanonicalPath("/%2e%2e/private"), /invalid/u);
  assert.throws(() => normalizeStorefrontCanonicalPath("//other.example/path"), /invalid/u);
});

test("robots and sitemap rendering use canonical HTTPS URLs and escaped XML", () => {
  const seo = parseStorefrontPublicSeoBundleV1(seoPayload());
  const robots = renderStorefrontRobotsTxt(seo);
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/u);
  assert.match(robots, /Disallow: \/account\nDisallow: \/checkout/u);
  assert.match(robots, /Sitemap: https:\/\/shop\.example\.com\/sitemap\.xml/u);

  const sitemap = renderStorefrontSitemapXml(seo);
  assert.match(sitemap, /<loc>https:\/\/shop\.example\.com\/products\/linen-shirt&amp;summer<\/loc>/u);
  assert.match(sitemap, /<lastmod>2026-07-29<\/lastmod>/u);
  assert.doesNotMatch(sitemap, /\/checkout/u);

  const blocked = parseStorefrontPublicSeoBundleV1(seoPayload({ indexable: false }));
  assert.match(renderStorefrontRobotsTxt(blocked), /Disallow: \/\n/u);
  assert.doesNotMatch(renderStorefrontSitemapXml(blocked), /<url>/u);
});

test("product structured data preserves exact price strings and escapes script termination", () => {
  const detail = parseStorefrontPublicProductDetailV1({
    contractVersion: "storefront-public-product.v1",
    context,
    product: {
      summary: {
        contractVersion: "storefront-product-card.v1",
        productId: "20000000-0000-4000-8000-000000000001",
        variantId: "20000000-0000-4000-8000-000000000011",
        slug: "linen-shirt",
        name: "Linen </script><script>alert(1)</script> Shirt",
        publicationState: "published",
        availability: "limited",
        pricePrefix: "none",
        price: { currency: "GBP", minor: "12345", scale: 2 },
        compareAtPrice: null,
        media: {
          src: "/media/linen-shirt.webp",
          alt: "Linen shirt",
          width: 1200,
          height: 1500,
        },
        badge: null,
      },
      code: "LINEN-SHIRT",
      description: "Breathable linen shirt.",
      kind: "stock",
      pricingNotice: "tax_calculated_at_checkout",
      variants: [
        {
          variantId: "20000000-0000-4000-8000-000000000011",
          sku: "LINEN-NATURAL-M",
          title: "Natural / M",
          unitCode: "EA",
          availability: "limited",
          price: { currency: "GBP", minor: "12345", scale: 2 },
          compareAtPrice: null,
          quantity: {
            amount: "3",
            unit: "EA",
            scale: 0,
            asOf: "2026-07-30T10:00:00.000Z",
            version: "7",
          },
        },
      ],
    },
  });

  const script = renderStorefrontProductStructuredData(detail);
  assert.match(script, /"price":"123\.45"/u);
  assert.match(script, /"priceCurrency":"GBP"/u);
  assert.match(script, /https:\/\/schema\.org\/LimitedAvailability/u);
  assert.match(script, /https:\/\/shop\.example\.com\/media\/linen-shirt\.webp/u);
  assert.doesNotMatch(script, /<\/script><script>/u);
  assert.match(script, /\\u003c\/script\\u003e/u);
});
