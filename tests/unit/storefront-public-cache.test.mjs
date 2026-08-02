import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { handlePublicStorefrontCacheRequest } from "../../build/apps/api/src/modules/storefront/public-cache-handler.js";
import { SqlStorefrontPublicCacheRepository } from "../../build/modules/storefront/src/public-cache.js";
import { requestStorefrontPublicCacheGenerations } from "../../build/packages/storefront-client/src/public-cache.js";
import {
  STOREFRONT_PUBLIC_CACHE_FAMILIES_V1,
  parseStorefrontPublicCacheGenerationBundleV1,
} from "../../build/packages/storefront-contracts/src/public-cache.js";

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

const generations = Object.fromEntries(
  STOREFRONT_PUBLIC_CACHE_FAMILIES_V1.map((family, index) => [
    family,
    String(index + 1),
  ]),
);

const payload = {
  contractVersion: "storefront-public-cache-generations.v1",
  context,
  generations,
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
    generationDocuments: generations,
    ...overrides,
  };
}

test("public cache contract requires every exact positive family generation", () => {
  const parsed = parseStorefrontPublicCacheGenerationBundleV1(payload);
  assert.deepEqual(Object.keys(parsed.generations).sort(), [
    ...STOREFRONT_PUBLIC_CACHE_FAMILIES_V1,
  ].sort());
  assert.equal(parsed.generations.media, "9");

  const { media: _media, ...missing } = generations;
  assert.throws(
    () => parseStorefrontPublicCacheGenerationBundleV1({
      ...payload,
      generations: missing,
    }),
    /incomplete or unsupported/u,
  );
  assert.throws(
    () => parseStorefrontPublicCacheGenerationBundleV1({
      ...payload,
      generations: { ...generations, unknown: "1" },
    }),
    /incomplete or unsupported/u,
  );
  assert.throws(
    () => parseStorefrontPublicCacheGenerationBundleV1({
      ...payload,
      generations: { ...generations, catalog: "0" },
    }),
    /catalog is invalid/u,
  );
});

test("public cache repository normalizes hostname and fails closed on scope mismatch", async () => {
  let observed = null;
  const repository = new SqlStorefrontPublicCacheRepository({
    async httpQuery(sql, values) {
      assert.match(sql, /resolve_public_cache_generations\(\$1::text\)/u);
      observed = values;
      return [row()];
    },
  });
  const bundle = await repository.resolveGenerations("SHOP.EXAMPLE.COM.");
  assert.equal(bundle.generations.catalog, "3");
  assert.deepEqual(observed, ["shop.example.com"]);

  const mismatch = new SqlStorefrontPublicCacheRepository({
    async httpQuery() { return [row({ requestHostname: "other.example.com" })]; },
  });
  await assert.rejects(
    () => mismatch.resolveGenerations("shop.example.com"),
    /mismatched hostname/u,
  );
});

test("public cache API is no-store and preserves GET HEAD 404 and method boundaries", async () => {
  const request = new Request(
    "https://api.example.com/v1/storefront/cache-generations?hostname=shop.example.com",
  );
  const database = { async httpQuery() { return [row()]; } };
  const response = await handlePublicStorefrontCacheRequest(
    request,
    new URL(request.url),
    database,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).generations.media, "9");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/u);

  const headRequest = new Request(request.url, { method: "HEAD" });
  const head = await handlePublicStorefrontCacheRequest(
    headRequest,
    new URL(headRequest.url),
    database,
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const missing = await handlePublicStorefrontCacheRequest(
    request,
    new URL(request.url),
    { async httpQuery() { return []; } },
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "CACHE_GENERATIONS_UNAVAILABLE");

  const postRequest = new Request(request.url, { method: "POST" });
  const post = await handlePublicStorefrontCacheRequest(
    postRequest,
    new URL(postRequest.url),
    database,
  );
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
});

test("typed cache client preserves base path and reconciles hostname", async () => {
  let observed = "";
  const bundle = await requestStorefrontPublicCacheGenerations(
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
  );
  assert.equal(bundle.generations.search, "7");
  assert.equal(
    observed,
    "https://api.example.com/platform/v1/storefront/cache-generations?hostname=shop.example.com",
  );

  await assert.rejects(
    () => requestStorefrontPublicCacheGenerations(
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
    ),
    /hostname mismatch/u,
  );
});

test("STF-0016 defines forced-RLS cache families, idempotent bumps and runtime-only reads", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../database/modules/storefront/manifest.json", import.meta.url), "utf8"),
  );
  assert.ok(manifest.migrations.some(({ id }) => id === "STF-0016"));
  assert.equal(manifest.migrations.at(-1).id, "STF-0017");
  const sql = await readFile(
    new URL("../../database/modules/storefront/migrations/STF-0016-cache-generation-families.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS storefront\.cache_generation_families/u);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/u);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/u);
  assert.match(sql, /CREATE POLICY tenant_isolation/u);
  assert.match(sql, /cache_families_for_reason/u);
  assert.match(sql, /advance_cache_generation_families_internal/u);
  assert.match(sql, /advance_cache_family_generation/u);
  assert.match(sql, /storefront\.command_replay/u);
  assert.match(sql, /storefront\.store_command_receipt/u);
  assert.match(sql, /pg_advisory_xact_lock/u);
  assert.match(sql, /storefront\.cache\.family_generation_advanced\.v1/u);
  assert.match(sql, /INSERT INTO platform\.audit_events/u);
  assert.match(sql, /INSERT INTO platform\.outbox_events/u);
  assert.match(sql, /HAVING count\(\*\) = 9/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION storefront\.resolve_public_cache_generations\(text\) FROM PUBLIC/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION storefront\.resolve_public_cache_generations\(text\)/u);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON storefront\.cache_generation_families/u);

  const initializationSql = await readFile(
    new URL("../../database/modules/storefront/migrations/STF-0017-cache-family-initialization.sql", import.meta.url),
    "utf8",
  );
  assert.match(initializationSql, /supported_family\.family_name/u);
  assert.match(initializationSql, /requested_family\.family_name/u);
  assert.match(initializationSql, /ON CONFLICT \([\s\S]*family[\s\S]*\) DO NOTHING/u);
  assert.match(initializationSql, /'bootstrap','content','catalog','product','category'/u);
  assert.match(initializationSql, /'collection','search','sitemap','media'/u);
});
