import test from "node:test";
import assert from "node:assert/strict";
import { NeonDatabase } from "../../build/packages/foundation/src/db.js";
import { createFakeNeonLoader } from "../../build/packages/testing/src/neon-fake.js";
import { SqlStorefrontPublicRepository } from "../../build/modules/storefront/src/public.js";
import { handlePublicStorefrontRequest } from "../../build/apps/api/src/modules/storefront/public-handler.js";

const row = {
  tenantId: "018f0000-0000-4000-8000-000000000001",
  storefrontId: "018f0000-0000-4000-8000-000000000002",
  salesChannelId: "018f0000-0000-4000-8000-000000000003",
  requestHostname: "shop.example.com",
  canonicalHostname: "www.example.com",
  locale: "en-GB",
  currency: "GBP",
  priceListRevision: "price-list:018f0000-0000-4000-8000-000000000004:v3",
  publicationGeneration: "publication:8",
  themeRevision: "theme:2",
  layoutRevision: "layout:4",
  capabilities: ["catalog.read", "checkout.quote", "checkout.guest"],
};

function database(rows = [row]) {
  const calls = [];
  return {
    calls,
    value: new NeonDatabase({
      connectionString: "postgresql://example.invalid/db",
      loader: createFakeNeonLoader(calls, rows),
    }),
  };
}

test("public repository resolves only the narrow database function", async () => {
  const fake = database();
  const bootstrap = await new SqlStorefrontPublicRepository(fake.value).resolveBootstrap(
    "SHOP.EXAMPLE.COM.",
  );
  assert.equal(bootstrap?.context.requestHostname, "shop.example.com");
  assert.equal(bootstrap?.context.canonicalHostname, "www.example.com");
  assert.equal(bootstrap?.context.priceListRevision, row.priceListRevision);
  assert.deepEqual(bootstrap?.capabilities, row.capabilities);
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].text, /storefront\.resolve_public_host/);
  assert.doesNotMatch(fake.calls[0].text, /storefront\.domains/);
  assert.deepEqual(fake.calls[0].values, ["shop.example.com"]);
});

test("public repository returns null for unknown hosts", async () => {
  const fake = database([]);
  assert.equal(
    await new SqlStorefrontPublicRepository(fake.value).resolveBootstrap(
      "missing.example.com",
    ),
    null,
  );
});

test("public repository rejects a mismatched hostname result", async () => {
  const fake = database([{ ...row, requestHostname: "other.example.com" }]);
  await assert.rejects(
    () =>
      new SqlStorefrontPublicRepository(fake.value).resolveBootstrap(
        "shop.example.com",
      ),
    /mismatched hostname/,
  );
});

test("bootstrap handler returns the raw versioned contract", async () => {
  const fake = database();
  const response = await handlePublicStorefrontRequest(
    new Request("https://api.example.test/v1/storefront/bootstrap?hostname=shop.example.com"),
    new URL("https://api.example.test/v1/storefront/bootstrap?hostname=shop.example.com"),
    fake.value,
  );
  assert.equal(response?.status, 200);
  assert.match(response?.headers.get("cache-control") ?? "", /s-maxage=30/);
  assert.equal(response?.headers.get("x-frame-options"), "DENY");
  const payload = await response?.json();
  assert.equal(payload.contractVersion, "storefront-bootstrap.v1");
  assert.equal(payload.context.storefrontId, row.storefrontId);
  assert.equal(payload.data, undefined);
});

test("bootstrap handler supports HEAD without exposing a body", async () => {
  const fake = database();
  const url = new URL(
    "https://api.example.test/v1/storefront/bootstrap?hostname=shop.example.com",
  );
  const response = await handlePublicStorefrontRequest(
    new Request(url, { method: "HEAD" }),
    url,
    fake.value,
  );
  assert.equal(response?.status, 200);
  assert.equal(await response?.text(), "");
});

test("unknown host and unsupported methods fail closed", async () => {
  const missing = database([]);
  const url = new URL(
    "https://api.example.test/v1/storefront/bootstrap?hostname=missing.example.com",
  );
  const notFound = await handlePublicStorefrontRequest(
    new Request(url),
    url,
    missing.value,
  );
  assert.equal(notFound?.status, 404);
  assert.match(notFound?.headers.get("cache-control") ?? "", /no-store/);

  const method = await handlePublicStorefrontRequest(
    new Request(url, { method: "POST" }),
    url,
    missing.value,
  );
  assert.equal(method?.status, 405);
  assert.equal(method?.headers.get("allow"), "GET, HEAD");
  assert.equal(missing.calls.length, 1);
});

test("unrelated routes are ignored and hostname is required", async () => {
  const fake = database();
  const unrelated = new URL("https://api.example.test/v1/other");
  assert.equal(
    await handlePublicStorefrontRequest(
      new Request(unrelated),
      unrelated,
      fake.value,
    ),
    null,
  );
  const missingHostname = new URL(
    "https://api.example.test/v1/storefront/bootstrap",
  );
  await assert.rejects(
    () =>
      handlePublicStorefrontRequest(
        new Request(missingHostname),
        missingHostname,
        fake.value,
      ),
    /hostname is required/,
  );
});
