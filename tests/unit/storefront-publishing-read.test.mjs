import assert from "node:assert/strict";
import test from "node:test";
import {
  StorefrontPublishingReadService,
} from "../../build/modules/storefront/src/publishing-read.js";
import {
  handleStorefrontPublishingReadRequest,
} from "../../build/apps/api/src/modules/storefront/publishing-read-handler.js";

const ids = {
  tenant: "018f0000-0000-4000-8000-000000000001",
  actor: "018f0000-0000-4000-8000-000000000002",
  storefront: "018f0000-0000-4000-8000-000000000003",
  channel: "018f0000-0000-4000-8000-000000000004",
  variantPublication: "018f0000-0000-4000-8000-000000000005",
  product: "018f0000-0000-4000-8000-000000000006",
  variant: "018f0000-0000-4000-8000-000000000007",
  categoryPublication: "018f0000-0000-4000-8000-000000000008",
  category: "018f0000-0000-4000-8000-000000000009",
  collection: "018f0000-0000-4000-8000-000000000010",
  member: "018f0000-0000-4000-8000-000000000011",
  navigation: "018f0000-0000-4000-8000-000000000012",
  content: "018f0000-0000-4000-8000-000000000013",
  homepage: "018f0000-0000-4000-8000-000000000014",
};

function context(permissions = ["storefront.storefront.read"]) {
  return {
    requestId: "018f0000-0000-7000-8000-000000000015",
    traceId: "trace-storefront-publishing-read",
    tenantId: ids.tenant,
    actorId: ids.actor,
    locale: "en-GB",
    timeZone: "Europe/London",
    businessDate: "2026-07-30",
    region: "test",
    permissions: new Set(permissions),
  };
}

function repository() {
  const calls = [];
  const repository = {
    async listVariantPublications(receivedContext, salesChannelId, filter) {
      calls.push({ method: "listVariantPublications", receivedContext, salesChannelId, filter });
      return [];
    },
    async listCategoryPublications(receivedContext, salesChannelId, filter) {
      calls.push({ method: "listCategoryPublications", receivedContext, salesChannelId, filter });
      return [];
    },
    async listCollections(receivedContext, salesChannelId, filter) {
      calls.push({ method: "listCollections", receivedContext, salesChannelId, filter });
      return [];
    },
    async listCollectionMembers(receivedContext, collectionId, page) {
      calls.push({ method: "listCollectionMembers", receivedContext, collectionId, page });
      return [];
    },
    async listNavigationRevisions(receivedContext, storefrontId, page) {
      calls.push({ method: "listNavigationRevisions", receivedContext, storefrontId, page });
      return [];
    },
    async listContentPageRevisions(receivedContext, storefrontId, page) {
      calls.push({ method: "listContentPageRevisions", receivedContext, storefrontId, page });
      return [];
    },
    async listHomepageRevisions(receivedContext, storefrontId, page) {
      calls.push({ method: "listHomepageRevisions", receivedContext, storefrontId, page });
      return [];
    },
  };
  return { calls, repository };
}

test("publishing read service checks permission before repository access", async () => {
  const fake = repository();
  const service = new StorefrontPublishingReadService(fake.repository);
  await assert.rejects(
    () => service.listCollections(context([]), ids.channel, { limit: 20 }),
    /Permission denied/u,
  );
  assert.equal(fake.calls.length, 0);
});

test("publishing read service normalizes UUID cursors and validates limits", async () => {
  const fake = repository();
  const service = new StorefrontPublishingReadService(fake.repository);
  await service.listCategoryPublications(
    context(),
    ids.channel.toUpperCase(),
    {
      limit: 25,
      afterId: ids.categoryPublication.toUpperCase(),
      state: "scheduled",
    },
  );
  assert.deepEqual(fake.calls[0], {
    method: "listCategoryPublications",
    receivedContext: context(),
    salesChannelId: ids.channel,
    filter: {
      limit: 25,
      afterId: ids.categoryPublication,
      state: "scheduled",
    },
  });
  await assert.rejects(
    () => service.listHomepageRevisions(context(), ids.storefront, { limit: 101 }),
    /between 1 and 100/u,
  );
});

function fakeReads() {
  const calls = [];
  return {
    calls,
    service: {
      async listVariantPublications(receivedContext, salesChannelId, filter) {
        calls.push({ method: "listVariantPublications", receivedContext, salesChannelId, filter });
        return [
          {
            id: ids.variantPublication,
            storefrontId: ids.storefront,
            salesChannelId,
            productId: ids.product,
            variantId: ids.variant,
            state: "published",
            publicSlugSuffix: "blue-large",
            metadata: { featured: true },
            version: 8n,
            updatedAt: "2026-07-30T00:00:00.000Z",
          },
        ];
      },
      async listCategoryPublications(receivedContext, salesChannelId, filter) {
        calls.push({ method: "listCategoryPublications", receivedContext, salesChannelId, filter });
        return [];
      },
      async listCollections(receivedContext, salesChannelId, filter) {
        calls.push({ method: "listCollections", receivedContext, salesChannelId, filter });
        return [];
      },
      async listCollectionMembers(receivedContext, collectionId, page) {
        calls.push({ method: "listCollectionMembers", receivedContext, collectionId, page });
        return [];
      },
      async listNavigationRevisions(receivedContext, storefrontId, page) {
        calls.push({ method: "listNavigationRevisions", receivedContext, storefrontId, page });
        return [];
      },
      async listContentPageRevisions(receivedContext, storefrontId, page) {
        calls.push({ method: "listContentPageRevisions", receivedContext, storefrontId, page });
        return [
          {
            id: ids.content,
            storefrontId,
            publicSlug: "shipping",
            revision: 3n,
            title: "Shipping",
            status: "published",
            contentDocument: {
              blocks: [{ type: "text", value: "Delivery details" }],
            },
            seoDocument: { title: "Shipping" },
            documentHash: "a".repeat(64),
            scheduledFor: null,
            createdAt: "2026-07-30T00:00:00.000Z",
            publishedAt: "2026-07-30T00:01:00.000Z",
          },
        ];
      },
      async listHomepageRevisions(receivedContext, storefrontId, page) {
        calls.push({ method: "listHomepageRevisions", receivedContext, storefrontId, page });
        return [];
      },
    },
  };
}

async function handle(path, fake = fakeReads(), method = "GET") {
  const request = new Request(`https://api.example.test${path}`, { method });
  const response = await handleStorefrontPublishingReadRequest(
    request,
    new URL(request.url),
    context(),
    {},
    fake.service,
  );
  return { ...fake, response };
}

test("variant publication read route validates state and serializes bigint", async () => {
  const { calls, response } = await handle(
    `/v1/storefront/sales-channels/${ids.channel}/variant-publications?limit=1&state=published`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].filter, { limit: 1, state: "published" });
  assert.deepEqual(await response.json(), {
    data: {
      items: [
        {
          id: ids.variantPublication,
          storefrontId: ids.storefront,
          salesChannelId: ids.channel,
          productId: ids.product,
          variantId: ids.variant,
          state: "published",
          publicSlugSuffix: "blue-large",
          metadata: { featured: true },
          version: "8",
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
      ],
      nextAfterId: ids.variantPublication,
    },
  });
});

test("content revision route preserves documents and exact revisions", async () => {
  const { calls, response } = await handle(
    `/v1/storefront/storefronts/${ids.storefront}/content-page-revisions?limit=10`,
  );
  assert.equal(response.status, 200);
  assert.equal(calls[0].method, "listContentPageRevisions");
  assert.deepEqual((await response.json()).data.items[0], {
    id: ids.content,
    storefrontId: ids.storefront,
    publicSlug: "shipping",
    revision: "3",
    title: "Shipping",
    status: "published",
    contentDocument: {
      blocks: [{ type: "text", value: "Delivery details" }],
    },
    seoDocument: { title: "Shipping" },
    documentHash: "a".repeat(64),
    scheduledFor: null,
    createdAt: "2026-07-30T00:00:00.000Z",
    publishedAt: "2026-07-30T00:01:00.000Z",
  });
});

test("publishing read handler rejects invalid state and ignores non-GET routes", async () => {
  await assert.rejects(
    () => handle(
      `/v1/storefront/sales-channels/${ids.channel}/variant-publications?state=draft`,
    ),
    /state is invalid/u,
  );
  const unmatched = await handle(
    `/v1/storefront/sales-channels/${ids.channel}/variant-publications`,
    fakeReads(),
    "POST",
  );
  assert.equal(unmatched.response, null);
  assert.equal(unmatched.calls.length, 0);
});
