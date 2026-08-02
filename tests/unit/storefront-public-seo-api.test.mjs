import assert from "node:assert/strict";
import test from "node:test";
import { handlePublicStorefrontRequest } from "../../build/apps/api/src/modules/storefront/public-handler.js";
import { resolveStorefrontPublicSeo } from "../../build/modules/storefront/src/public-seo.js";

const row = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  storefrontId: "10000000-0000-4000-8000-000000000100",
  salesChannelId: "10000000-0000-4000-8000-000000000110",
  requestHostname: "shop.example.com",
  canonicalHostname: "shop.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:1:v1",
  publicationGeneration: "publication:14",
  indexable: true,
  sitemapPath: "/sitemap.xml",
  disallowPaths: ["/account", "/checkout", "/api"],
  entryDocuments: [
    {
      kind: "home",
      path: "/",
      lastModified: "2026-07-30T10:00:00.000Z",
      changeFrequency: "daily",
    },
    {
      kind: "product",
      path: "/products/linen-shirt",
      lastModified: "2026-07-30T09:00:00.000Z",
      changeFrequency: "weekly",
    },
  ],
};

function database(rows = [row]) {
  return {
    async httpQuery(sql, values) {
      assert.match(sql, /storefront\.resolve_public_seo\(\$1::text\)/u);
      assert.deepEqual(values, ["shop.example.com"]);
      return rows;
    },
  };
}

test("public SEO repository normalizes hostname and validates the returned scope", async () => {
  const bundle = await resolveStorefrontPublicSeo(database(), "SHOP.EXAMPLE.COM.");
  assert.equal(bundle.context.requestHostname, "shop.example.com");
  assert.equal(bundle.entries[1].path, "/products/linen-shirt");

  await assert.rejects(
    () => resolveStorefrontPublicSeo(database([{ ...row, requestHostname: "other.example.com" }]), "shop.example.com"),
    /mismatched hostname/u,
  );
  assert.equal(await resolveStorefrontPublicSeo(database([]), "shop.example.com"), null);
});

test("public SEO API supports GET and HEAD, caches briefly and fails closed", async () => {
  const request = new Request(
    "https://api.example.com/v1/storefront/seo?hostname=shop.example.com",
  );
  const response = await handlePublicStorefrontRequest(
    request,
    new URL(request.url),
    database(),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=300/u);
  assert.equal((await response.json()).contractVersion, "storefront-public-seo.v1");

  const headRequest = new Request(request.url, { method: "HEAD" });
  const head = await handlePublicStorefrontRequest(
    headRequest,
    new URL(headRequest.url),
    database(),
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const unavailable = await handlePublicStorefrontRequest(
    request,
    new URL(request.url),
    database([]),
  );
  assert.equal(unavailable.status, 404);
  assert.equal((await unavailable.json()).error.code, "STOREFRONT_UNAVAILABLE");

  const postRequest = new Request(request.url, { method: "POST" });
  const post = await handlePublicStorefrontRequest(
    postRequest,
    new URL(postRequest.url),
    database(),
  );
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
});
