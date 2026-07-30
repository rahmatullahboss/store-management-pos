import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handlePublicStorefrontRequest } from "../../build/apps/api/src/modules/storefront/public-handler.js";
import {
  createStorefrontWorker,
} from "../../build/apps/storefront-web/src/index.js";
import { createStorefrontClient } from "../../build/packages/storefront-client/src/index.js";
import { parseStorefrontBootstrapV1 } from "../../build/packages/storefront-contracts/src/index.js";
import {
  parseStorefrontPublicContentBundleV1,
} from "../../build/packages/storefront-contracts/src/public-content.js";

const context = {
  tenantId: "tenant-1",
  storefrontId: "storefront-1",
  salesChannelId: "channel-1",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v1",
  publicationGeneration: "publication:9",
};

const bootstrap = parseStorefrontBootstrapV1({
  contractVersion: "storefront-bootstrap.v1",
  context,
  themeRevision: "theme:1",
  layoutRevision: "layout:1",
  capabilities: ["catalog.read"],
});

const contentPayload = {
  contractVersion: "storefront-public-content.v1",
  context,
  themeRevision: "theme:1",
  layoutRevision: "layout:1",
  theme: { version: "storefront-theme.v1" },
  navigation: {
    header: {
      items: [
        { label: "Home", href: "/" },
        { label: "Shipping", href: "/pages/shipping" },
      ],
    },
    footer: { items: [{ label: "Support", href: "https://support.example.com/" }] },
  },
  homepage: {
    blocks: [
      { type: "hero", eyebrow: "New season", title: "Published home", body: "Tenant-safe public content." },
      { type: "future-block", data: { ignored: true } },
    ],
  },
  homepageSeo: { title: "Published Store", description: "Published homepage description." },
  page: {
    slug: "shipping",
    title: "Shipping",
    revision: "content:1",
    content: { blocks: [{ type: "text", heading: "Delivery", value: "Delivery details" }] },
    seo: { title: "Shipping information" },
  },
};

const content = parseStorefrontPublicContentBundleV1(contentPayload);
const homepageContent = parseStorefrontPublicContentBundleV1({
  ...contentPayload,
  page: null,
});

const environment = {
  STOREFRONT_STAGE: "production",
  STOREFRONT_API_BASE_URL: "https://api.example.com",
  STOREFRONT_PLATFORM_BASE_DOMAIN: "shops.example.com",
  STOREFRONT_BUILD_ID: "build-content-1",
};

function databaseRows(overrides = {}) {
  return [{
    ...context,
    themeRevision: "theme:1",
    layoutRevision: "layout:1",
    themeDocument: contentPayload.theme,
    navigationDocument: contentPayload.navigation,
    homepageDocument: contentPayload.homepage,
    homepageSeoDocument: contentPayload.homepageSeo,
    contentPageSlug: "shipping",
    contentPageTitle: "Shipping",
    contentPageRevision: "content:1",
    contentPageDocument: contentPayload.page.content,
    contentPageSeoDocument: contentPayload.page.seo,
    ...overrides,
  }];
}

test("public content contract accepts bounded future-safe documents and safe navigation", () => {
  assert.equal(content.navigation.header.items[1].href, "/pages/shipping");
  assert.equal(content.navigation.footer.items[0].href, "https://support.example.com/");
  assert.equal(content.page.title, "Shipping");
  assert.throws(
    () => parseStorefrontPublicContentBundleV1({
      ...contentPayload,
      navigation: { header: { items: [{ label: "Unsafe", href: "javascript:alert(1)" }] } },
    }),
    /href is invalid/u,
  );
  assert.throws(
    () => parseStorefrontPublicContentBundleV1({
      ...contentPayload,
      homepage: { blocks: [{ type: "text", value: "x".repeat(8_001) }] },
    }),
    /invalid text/u,
  );
});

test("typed client requests normalized host and CMS slug", async () => {
  let observed = "";
  const client = createStorefrontClient({
    baseUrl: "https://api.example.com",
    transport: {
      async fetch(input) {
        observed = String(input);
        return Response.json(contentPayload);
      },
    },
  });
  const result = await client.getContent("SHOP.EXAMPLE.COM.", { slug: " Shipping " });
  assert.equal(result.page.slug, "shipping");
  assert.equal(
    observed,
    "https://api.example.com/v1/storefront/content?hostname=shop.example.com&slug=shipping",
  );
});

test("public API returns host-scoped content and published-page 404", async () => {
  const database = {
    async httpQuery(_sql, values) {
      assert.deepEqual(values, ["shop.example.com", "shipping"]);
      return databaseRows();
    },
  };
  const request = new Request(
    "https://api.example.com/v1/storefront/content?hostname=shop.example.com&slug=shipping",
  );
  const response = await handlePublicStorefrontRequest(request, new URL(request.url), database);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=60/u);
  assert.equal((await response.json()).page.title, "Shipping");

  const missingDatabase = {
    async httpQuery() {
      return databaseRows({
        contentPageSlug: null,
        contentPageTitle: null,
        contentPageRevision: null,
        contentPageDocument: null,
        contentPageSeoDocument: null,
      });
    },
  };
  const missing = await handlePublicStorefrontRequest(request, new URL(request.url), missingDatabase);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "CONTENT_NOT_FOUND");
});

test("worker renders published homepage, navigation and CMS without leaking scope identifiers", async () => {
  const worker = createStorefrontWorker({
    resolverFactory: () => ({ async resolve() { return bootstrap; } }),
    contentResolverFactory: () => ({
      async resolve(_hostname, options = {}) {
        return options.slug ? content : homepageContent;
      },
    }),
  });
  const homepage = await worker.fetch(new Request("https://shop.example.com/"), environment);
  const homepageHtml = await homepage.text();
  assert.equal(homepage.status, 200);
  assert.match(homepageHtml, /Published home/u);
  assert.match(homepageHtml, /Tenant-safe public content/u);
  assert.match(homepageHtml, /href="\/pages\/shipping"/u);
  assert.match(homepageHtml, /Published Store/u);
  assert.doesNotMatch(homepageHtml, /future-block/u);
  assert.doesNotMatch(homepageHtml, /tenant-1/u);

  const cms = await worker.fetch(
    new Request("https://shop.example.com/pages/shipping"),
    environment,
  );
  const cmsHtml = await cms.text();
  assert.equal(cms.status, 200);
  assert.match(cmsHtml, /Shipping information/u);
  assert.match(cmsHtml, /Delivery details/u);
});

test("worker fails closed on content scope mismatch and returns bounded CMS not-found", async () => {
  const mismatched = parseStorefrontPublicContentBundleV1({
    ...contentPayload,
    context: { ...context, tenantId: "tenant-2" },
  });
  const mismatchWorker = createStorefrontWorker({
    resolverFactory: () => ({ async resolve() { return bootstrap; } }),
    contentResolverFactory: () => ({ async resolve() { return mismatched; } }),
  });
  const mismatch = await mismatchWorker.fetch(
    new Request("https://shop.example.com/"),
    environment,
  );
  assert.equal(mismatch.status, 404);
  assert.doesNotMatch(await mismatch.text(), /tenant-2/u);

  const missingWorker = createStorefrontWorker({
    resolverFactory: () => ({ async resolve() { return bootstrap; } }),
    contentResolverFactory: () => ({ async resolve() { return null; } }),
  });
  const missing = await missingWorker.fetch(
    new Request("https://shop.example.com/pages/missing"),
    environment,
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "CONTENT_NOT_FOUND");
});

test("STF-0006 through STF-0016 preserve safe public execution boundaries", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../database/modules/storefront/manifest.json", import.meta.url), "utf8"),
  );
  assert.ok(manifest.migrations.some(({ id }) => id === "STF-0006"));
  assert.ok(manifest.migrations.some(({ id }) => id === "STF-0007"));
  assert.equal(manifest.migrations.at(-1).id, "STF-0016");
  const contentSql = await readFile(
    new URL("../../database/modules/storefront/migrations/STF-0006-public-content-resolution.sql", import.meta.url),
    "utf8",
  );
  assert.match(contentSql, /WHERE tr\.status = 'published'/u);
  assert.match(contentSql, /WHERE nd\.status = 'published'/u);
  assert.match(contentSql, /WHERE hr\.status = 'published'/u);
  assert.match(contentSql, /WHERE cp\.status = 'published'/u);
  assert.match(contentSql, /REVOKE ALL ON FUNCTION storefront\.resolve_public_content_bundle\(text,text\) FROM PUBLIC/u);
  assert.match(contentSql, /GRANT EXECUTE ON FUNCTION storefront\.resolve_public_content_bundle\(text,text\) TO store_app_runtime/u);
  const variantSql = await readFile(
    new URL("../../database/modules/storefront/migrations/STF-0007-qualified-product-publication-reference.sql", import.meta.url),
    "utf8",
  );
  assert.match(variantSql, /SELECT product_publication\.publication_state INTO v_product_state/u);
  assert.match(variantSql, /FROM storefront\.product_publications AS product_publication/u);
  assert.match(variantSql, /REVOKE ALL ON FUNCTION storefront\.set_variant_publication/u);
  assert.match(variantSql, /GRANT EXECUTE ON FUNCTION storefront\.set_variant_publication/u);
  const commandSql = await readFile(
    new URL("../../database/modules/storefront/migrations/STF-0008-qualified-publication-command-references.sql", import.meta.url),
    "utf8",
  );
  assert.match(commandSql, /parent_publication\.publication_state <> 'archived'/u);
  assert.match(commandSql, /collection_member\.collection_id = p_collection_id/u);
  assert.match(commandSql, /max\(navigation_row\.revision\)/u);
  assert.match(commandSql, /SELECT storefront_row\.status INTO v_storefront_status/u);
  assert.match(commandSql, /max\(content_page\.revision\)/u);
  assert.match(commandSql, /max\(homepage_row\.revision\)/u);
  for (const functionName of [
    "set_category_publication",
    "replace_collection_members",
    "publish_navigation_revision",
    "publish_content_page_revision",
    "publish_homepage_revision",
  ]) {
    assert.match(commandSql, new RegExp(`REVOKE ALL ON FUNCTION storefront\\.${functionName}`, "u"));
    assert.match(commandSql, new RegExp(`GRANT EXECUTE ON FUNCTION storefront\\.${functionName}`, "u"));
  }
  const seoSql = await readFile(
    new URL("../../database/modules/storefront/migrations/STF-0014-public-seo-resolution.sql", import.meta.url),
    "utf8",
  );
  assert.match(seoSql, /publication\.publication_state = 'published'/u);
  assert.match(seoSql, /category\.status = 'active'/u);
  assert.match(seoSql, /collection\.publication_state = 'published'/u);
  assert.match(seoSql, /content\.status = 'published'/u);
  assert.match(seoSql, /LIMIT 5000/u);
  assert.match(seoSql, /REVOKE ALL ON FUNCTION storefront\.resolve_public_seo\(text\) FROM PUBLIC/u);
  assert.match(seoSql, /GRANT EXECUTE ON FUNCTION storefront\.resolve_public_seo\(text\) TO store_app_runtime/u);
});
