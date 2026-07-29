import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontManagementReadService } from "../../build/modules/storefront/src/read.js";
import { handleStorefrontReadRequest } from "../../build/apps/api/src/modules/storefront/read-handler.js";

const context = {
  requestId: "018f0000-0000-7000-8000-000000000001",
  traceId: "trace-storefront-read",
  tenantId: "018f0000-0000-4000-8000-000000000002",
  actorId: "018f0000-0000-4000-8000-000000000003",
  legalEntityId: "018f0000-0000-4000-8000-000000000004",
  storeId: "018f0000-0000-4000-8000-000000000005",
  locale: "en-GB",
  timeZone: "Europe/London",
  businessDate: "2026-07-30",
  region: "test",
  permissions: new Set(["storefront.storefront.read"]),
};

const storefrontA = {
  id: "018f0000-0000-4000-8000-000000000010",
  legalEntityId: "018f0000-0000-4000-8000-000000000004",
  primaryStoreId: null,
  code: "online-a",
  displayName: "Online A",
  status: "active",
  defaultLocale: "en-GB",
  defaultCurrency: "GBP",
  timeZone: "Europe/London",
  platformSubdomain: "online-a",
  version: 2n,
  updatedAt: "2026-07-30T00:00:00.000Z",
};
const storefrontB = {
  ...storefrontA,
  id: "018f0000-0000-4000-8000-000000000011",
  code: "online-b",
  displayName: "Online B",
};

function fakeRepository() {
  const calls = [];
  return {
    calls,
    repository: {
      async listStorefronts(receivedContext, filter) {
        calls.push({ method: "listStorefronts", receivedContext, filter });
        return [storefrontA, storefrontB].slice(0, filter.limit);
      },
      async getStorefront(receivedContext, storefrontId) {
        calls.push({ method: "getStorefront", receivedContext, storefrontId });
        return storefrontId === storefrontA.id ? storefrontA : null;
      },
      async listSalesChannels(receivedContext, storefrontId, page) {
        calls.push({ method: "listSalesChannels", receivedContext, storefrontId, page });
        return [];
      },
      async listDomains(receivedContext, storefrontId, page) {
        calls.push({ method: "listDomains", receivedContext, storefrontId, page });
        return [];
      },
      async listProductPublications(receivedContext, salesChannelId, filter) {
        calls.push({ method: "listProductPublications", receivedContext, salesChannelId, filter });
        return [];
      },
      async listThemeRevisions(receivedContext, storefrontId, page) {
        calls.push({ method: "listThemeRevisions", receivedContext, storefrontId, page });
        return [];
      },
    },
  };
}

function request(path, method = "GET") {
  return new Request(`https://api.example.test${path}`, { method });
}

test("read permission is checked before repository access", async () => {
  const fake = fakeRepository();
  const service = new StorefrontManagementReadService(fake.repository);
  await assert.rejects(
    () => service.listStorefronts({ ...context, permissions: new Set() }, { limit: 25 }),
    /Permission denied/,
  );
  assert.equal(fake.calls.length, 0);
});

test("storefront list route applies filters and emits a deterministic cursor", async () => {
  const fake = fakeRepository();
  const incoming = request("/v1/storefront/storefronts?limit=2&status=active");
  const response = await handleStorefrontReadRequest(
    incoming,
    new URL(incoming.url),
    context,
    {},
    fake.repository,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(fake.calls[0].filter, { limit: 2, status: "active" });
  assert.deepEqual(await response.json(), {
    data: {
      items: [
        { ...storefrontA, version: "2" },
        { ...storefrontB, version: "2" },
      ],
      nextAfterId: storefrontB.id,
    },
  });
});

test("detail route returns one tenant-scoped storefront", async () => {
  const fake = fakeRepository();
  const incoming = request(`/v1/storefront/storefronts/${storefrontA.id}`);
  const response = await handleStorefrontReadRequest(
    incoming,
    new URL(incoming.url),
    context,
    {},
    fake.repository,
  );
  assert.equal(response.status, 200);
  assert.equal(fake.calls[0].storefrontId, storefrontA.id);
  assert.equal((await response.json()).data.version, "2");
});

test("missing storefront throws a safe not-found error", async () => {
  const fake = fakeRepository();
  const missing = "018f0000-0000-4000-8000-000000000099";
  const incoming = request(`/v1/storefront/storefronts/${missing}`);
  await assert.rejects(
    () => handleStorefrontReadRequest(incoming, new URL(incoming.url), context, {}, fake.repository),
    /Storefront not found/,
  );
});

test("publication list route carries state and cursor filters", async () => {
  const fake = fakeRepository();
  const channelId = "018f0000-0000-4000-8000-000000000020";
  const after = "018f0000-0000-4000-8000-000000000030";
  const incoming = request(
    `/v1/storefront/sales-channels/${channelId}/product-publications?state=published&limit=25&afterId=${after}`,
  );
  const response = await handleStorefrontReadRequest(
    incoming,
    new URL(incoming.url),
    context,
    {},
    fake.repository,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(fake.calls[0].filter, {
    limit: 25,
    afterId: after,
    state: "published",
  });
});

test("invalid query limits and states fail before read execution", async () => {
  for (const path of [
    "/v1/storefront/storefronts?limit=0",
    "/v1/storefront/storefronts?limit=101",
    "/v1/storefront/sales-channels/018f0000-0000-4000-8000-000000000020/product-publications?state=public",
  ]) {
    const fake = fakeRepository();
    const incoming = request(path);
    await assert.rejects(
      () => handleStorefrontReadRequest(incoming, new URL(incoming.url), context, {}, fake.repository),
      /invalid|between/,
    );
    assert.equal(fake.calls.length, 0);
  }
});

test("non-GET and unmatched routes return null", async () => {
  const fake = fakeRepository();
  const post = request("/v1/storefront/storefronts", "POST");
  assert.equal(
    await handleStorefrontReadRequest(post, new URL(post.url), context, {}, fake.repository),
    null,
  );
  const unknown = request("/v1/storefront/unknown");
  assert.equal(
    await handleStorefrontReadRequest(unknown, new URL(unknown.url), context, {}, fake.repository),
    null,
  );
  assert.equal(fake.calls.length, 0);
});
