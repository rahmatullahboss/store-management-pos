import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { handlePublicStorefrontMediaRequest } from "../../build/apps/api/src/modules/storefront/public-media-handler.js";
import { SqlStorefrontPublicMediaRepository } from "../../build/modules/storefront/src/public-media.js";
import { requestStorefrontPublicMedia } from "../../build/packages/storefront-client/src/public-media.js";
import { parseStorefrontPublicMediaManifestV1 } from "../../build/packages/storefront-contracts/src/public-media.js";

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

const payload = {
  contractVersion: "storefront-public-media.v1",
  context,
  productId: "018f0000-0000-4000-8000-000000000010",
  slug: "linen-shirt",
  revision: "0123456789abcdef0123456789abcdef",
  items: [
    {
      mediaId: "018f0000-0000-4000-8000-000000000101",
      variantId: null,
      src: "/media/linen-front.webp",
      alt: "Linen shirt front",
      sortOrder: 0,
      createdAt: "2026-07-30T10:00:00.000Z",
    },
    {
      mediaId: "018f0000-0000-4000-8000-000000000102",
      variantId: "018f0000-0000-4000-8000-000000000011",
      src: "https://cdn.example.com/linen-side.webp?version=2",
      alt: "Linen shirt side",
      sortOrder: 1,
      createdAt: "2026-07-30T10:01:00.000Z",
    },
  ],
};

function row(overrides = {}) {
  return {
    tenantId: context.tenantId,
    storefrontId: context.storefrontId,
    salesChannelId: context.salesChannelId,
    requestHostname: context.requestHostname,
    canonicalHostname: context.canonicalHostname,
    locale: context.locale,
    currency: context.currency,
    priceListRevision: context.priceListRevision,
    publicationGeneration: context.publicationGeneration,
    productId: payload.productId,
    publicSlug: payload.slug,
    mediaRevision: payload.revision,
    mediaDocuments: payload.items,
    ...overrides,
  };
}

test("public media contract accepts bounded deterministic safe media and delivery hints", () => {
  const parsed = parseStorefrontPublicMediaManifestV1(payload);
  assert.equal(parsed.items.length, 2);
  assert.deepEqual(parsed.delivery.widths, [320, 480, 640, 960, 1280]);
  assert.deepEqual(parsed.delivery.formats, ["avif", "webp", "auto"]);
  assert.equal(parsed.delivery.lowBandwidthWidth, 320);
  assert.equal(parsed.delivery.fallback, "original");
});

test("public media contract rejects unsafe, duplicate, unordered and oversized manifests", () => {
  for (const src of [
    "http://cdn.example.com/media.webp",
    "//cdn.example.com/media.webp",
    "https://user:secret@cdn.example.com/media.webp",
    "https://cdn.example.com/media.webp#fragment",
    "/media\\unsafe.webp",
  ]) {
    assert.throws(
      () => parseStorefrontPublicMediaManifestV1({
        ...payload,
        items: [{ ...payload.items[0], src }],
      }),
      /media\.src is invalid/u,
    );
  }
  assert.throws(
    () => parseStorefrontPublicMediaManifestV1({
      ...payload,
      items: [payload.items[0], payload.items[0]],
    }),
    /duplicate media ID/u,
  );
  assert.throws(
    () => parseStorefrontPublicMediaManifestV1({
      ...payload,
      items: [payload.items[1], payload.items[0]],
    }),
    /not deterministically ordered/u,
  );
  assert.throws(
    () => parseStorefrontPublicMediaManifestV1({
      ...payload,
      items: Array.from({ length: 25 }, (_, index) => ({
        ...payload.items[0],
        mediaId: `018f0000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        sortOrder: index,
      })),
    }),
    /media\.items are invalid/u,
  );
});

test("public media repository binds normalized scope and validates returned manifest", async () => {
  let observedSql = "";
  let observedValues = null;
  const repository = new SqlStorefrontPublicMediaRepository({
    async httpQuery(sql, values) {
      observedSql = sql;
      observedValues = values;
      return [row()];
    },
  });
  const manifest = await repository.resolveProductMedia(
    "SHOP.EXAMPLE.COM.",
    " Linen-Shirt ",
  );
  assert.equal(manifest.slug, "linen-shirt");
  assert.match(observedSql, /resolve_public_product_media\(\$1::text, \$2::text\)/u);
  assert.deepEqual(observedValues, ["shop.example.com", "linen-shirt"]);

  const mismatched = new SqlStorefrontPublicMediaRepository({
    async httpQuery() { return [row({ requestHostname: "other.example.com" })]; },
  });
  await assert.rejects(
    () => mismatched.resolveProductMedia("shop.example.com", "linen-shirt"),
    /mismatched storefront scope/u,
  );
});

test("public media API preserves GET HEAD 404 and method boundaries", async () => {
  const database = { async httpQuery() { return [row()]; } };
  const getRequest = new Request(
    "https://api.example.com/v1/storefront/products/linen-shirt/media?hostname=shop.example.com",
  );
  const getResponse = await handlePublicStorefrontMediaRequest(
    getRequest,
    new URL(getRequest.url),
    database,
  );
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).items.length, 2);
  assert.match(getResponse.headers.get("cache-control") ?? "", /s-maxage=300/u);

  const headRequest = new Request(getRequest.url, { method: "HEAD" });
  const headResponse = await handlePublicStorefrontMediaRequest(
    headRequest,
    new URL(headRequest.url),
    database,
  );
  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), "");

  const missingResponse = await handlePublicStorefrontMediaRequest(
    getRequest,
    new URL(getRequest.url),
    { async httpQuery() { return []; } },
  );
  assert.equal(missingResponse.status, 404);
  assert.equal((await missingResponse.json()).error.code, "PRODUCT_MEDIA_NOT_FOUND");

  const postRequest = new Request(getRequest.url, { method: "POST" });
  const postResponse = await handlePublicStorefrontMediaRequest(
    postRequest,
    new URL(postRequest.url),
    database,
  );
  assert.equal(postResponse.status, 405);
  assert.equal(postResponse.headers.get("allow"), "GET, HEAD");
});

test("typed media client preserves API base path and rejects scope mismatch", async () => {
  let observed = "";
  const manifest = await requestStorefrontPublicMedia(
    {
      baseUrl: "https://api.example.com/platform/",
      transport: {
        async fetch(input) {
          observed = String(input);
          return Response.json(payload);
        },
      },
    },
    "SHOP.EXAMPLE.COM.",
    " Linen-Shirt ",
  );
  assert.equal(manifest.slug, "linen-shirt");
  assert.equal(
    observed,
    "https://api.example.com/platform/v1/storefront/products/linen-shirt/media?hostname=shop.example.com",
  );

  await assert.rejects(
    () => requestStorefrontPublicMedia(
      {
        baseUrl: "https://api.example.com",
        transport: {
          async fetch() {
            return Response.json({
              ...payload,
              context: { ...context, requestHostname: "other.example.com" },
            });
          },
        },
      },
      "shop.example.com",
      "linen-shirt",
    ),
    /scope mismatch/u,
  );
});

test("STF-0015 is checksum registered and keeps product media read-only", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../database/modules/storefront/manifest.json", import.meta.url), "utf8"),
  );
  assert.ok(manifest.migrations.some(({ id }) => id === "STF-0015"));
  const sql = await readFile(
    new URL("../../database/modules/storefront/migrations/STF-0015-public-media-resolution.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /FROM catalog\.product_media media/u);
  assert.match(sql, /publication\.publication_state = 'published'/u);
  assert.match(sql, /COALESCE\(variant_publication\.publication_state, 'published'\) = 'published'/u);
  assert.match(sql, /LIMIT 24/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION storefront\.resolve_public_product_media\(text,text\) FROM PUBLIC/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION storefront\.resolve_public_product_media\(text,text\) TO store_app_runtime/u);
  assert.doesNotMatch(sql, /INSERT INTO catalog\.product_media|UPDATE catalog\.product_media|DELETE FROM catalog\.product_media/u);
});
