import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontPublishingService } from "../../build/modules/storefront/src/publishing.js";
import { handleStorefrontPublishingRequest } from "../../build/apps/api/src/modules/storefront/publishing-handler.js";

const ids = {
  tenant: "018f0000-0000-4000-8000-000000000002",
  actor: "018f0000-0000-4000-8000-000000000003",
  storefront: "018f0000-0000-4000-8000-000000000010",
  channel: "018f0000-0000-4000-8000-000000000011",
  product: "018f0000-0000-4000-8000-000000000012",
  variant: "018f0000-0000-4000-8000-000000000013",
  category: "018f0000-0000-4000-8000-000000000014",
  collection: "018f0000-0000-4000-8000-000000000015",
  member: "018f0000-0000-4000-8000-000000000016",
};

const context = {
  requestId: "018f0000-0000-7000-8000-000000000001",
  traceId: "trace-storefront-publishing",
  tenantId: ids.tenant,
  actorId: ids.actor,
  locale: "en-GB",
  timeZone: "Europe/London",
  businessDate: "2026-07-30",
  region: "test",
  permissions: new Set(["storefront.publication.manage", "storefront.content.manage"]),
};

function fakeRepository() {
  const calls = [];
  const repository = {
    async setVariantPublication(command) {
      calls.push({ method: "setVariantPublication", command });
      return { id: command.entityId, state: command.input.state, cacheGeneration: 4n, replayed: false };
    },
    async setCategoryPublication(command) {
      calls.push({ method: "setCategoryPublication", command });
      return { id: command.entityId, state: command.input.state, cacheGeneration: 5n, replayed: false };
    },
    async setCollection(command) {
      calls.push({ method: "setCollection", command });
      return { id: command.entityId, state: command.input.state, cacheGeneration: 6n, replayed: false };
    },
    async replaceCollectionMembers(command) {
      calls.push({ method: "replaceCollectionMembers", command });
      return { id: command.input.collectionId, memberCount: command.input.members.length, cacheGeneration: 7n, replayed: false };
    },
    async publishNavigation(command) {
      calls.push({ method: "publishNavigation", command });
      return { id: command.entityId, revision: 2n, cacheGeneration: 8n, replayed: false };
    },
    async publishContentPage(command) {
      calls.push({ method: "publishContentPage", command });
      return { id: command.entityId, revision: 3n, status: command.input.status, cacheGeneration: 9n, replayed: false };
    },
    async publishHomepage(command) {
      calls.push({ method: "publishHomepage", command });
      return { id: command.entityId, revision: 4n, status: command.input.status, cacheGeneration: 10n, replayed: false };
    },
  };
  return { calls, repository };
}

function request(path, method, body, key = "storefront-publishing-key") {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("publication permission is checked before repository access", async () => {
  const fake = fakeRepository();
  const service = new StorefrontPublishingService(fake.repository);
  await assert.rejects(
    () => service.setVariantPublication(
      { ...context, permissions: new Set() },
      {
        storefrontId: ids.storefront,
        salesChannelId: ids.channel,
        productId: ids.product,
        variantId: ids.variant,
        state: "published",
        idempotencyKey: "variant-permission",
      },
    ),
    /Permission denied/,
  );
  assert.equal(fake.calls.length, 0);
});

test("variant and category commands normalize slugs, IDs and schedules", async () => {
  const fake = fakeRepository();
  const service = new StorefrontPublishingService(fake.repository);
  await service.setVariantPublication(context, {
    storefrontId: ids.storefront.toUpperCase(),
    salesChannelId: ids.channel,
    productId: ids.product,
    variantId: ids.variant,
    state: "published",
    publicSlugSuffix: " Blue-Large ",
    idempotencyKey: "variant-normalize",
  });
  await service.setCategoryPublication(context, {
    storefrontId: ids.storefront,
    salesChannelId: ids.channel,
    categoryId: ids.category,
    publicSlug: " Summer-Wear ",
    sortOrder: 12,
    state: "scheduled",
    scheduledFor: "2026-08-01T09:00:00+06:00",
    idempotencyKey: "category-normalize",
  });

  assert.equal(fake.calls[0].command.input.storefrontId, ids.storefront);
  assert.equal(fake.calls[0].command.input.publicSlugSuffix, "blue-large");
  assert.equal(fake.calls[1].command.input.publicSlug, "summer-wear");
  assert.equal(fake.calls[1].command.input.scheduledFor, "2026-08-01T03:00:00.000Z");
  assert.match(fake.calls[0].command.requestHash, /^[a-f0-9]{64}$/);
});

test("scheduled category and collection commands require a timestamp", async () => {
  const fake = fakeRepository();
  const service = new StorefrontPublishingService(fake.repository);
  await assert.rejects(
    () => service.setCategoryPublication(context, {
      storefrontId: ids.storefront,
      salesChannelId: ids.channel,
      categoryId: ids.category,
      publicSlug: "category",
      state: "scheduled",
      idempotencyKey: "category-no-time",
    }),
    /requires a schedule time/,
  );
  await assert.rejects(
    () => service.setCollection(context, {
      storefrontId: ids.storefront,
      salesChannelId: ids.channel,
      code: "featured",
      publicSlug: "featured",
      title: "Featured",
      state: "scheduled",
      idempotencyKey: "collection-no-time",
    }),
    /requires a schedule time/,
  );
  assert.equal(fake.calls.length, 0);
});

test("collection members reject duplicate identities before I/O", async () => {
  const fake = fakeRepository();
  const service = new StorefrontPublishingService(fake.repository);
  await assert.rejects(
    () => service.replaceCollectionMembers(context, {
      collectionId: ids.collection,
      members: [
        { memberId: ids.member, productId: ids.product },
        {
          memberId: "018f0000-0000-4000-8000-000000000017",
          productId: ids.product,
        },
      ],
      idempotencyKey: "duplicate-members",
    }),
    /duplicate product and variant/,
  );
  assert.equal(fake.calls.length, 0);
});

test("content document hashes and request hashes are deterministic", async () => {
  const left = fakeRepository();
  const right = fakeRepository();
  await new StorefrontPublishingService(left.repository).publishHomepage(context, {
    storefrontId: ids.storefront,
    status: "published",
    homepageDocument: { blocks: [{ type: "hero", data: { title: "Store", subtitle: "Open" } }] },
    seoDocument: { description: "Home", title: "Store" },
    idempotencyKey: "homepage-stable",
  });
  await new StorefrontPublishingService(right.repository).publishHomepage(context, {
    storefrontId: ids.storefront,
    status: "published",
    homepageDocument: { blocks: [{ data: { subtitle: "Open", title: "Store" }, type: "hero" }] },
    seoDocument: { title: "Store", description: "Home" },
    idempotencyKey: "homepage-stable",
  });

  assert.equal(left.calls[0].command.documentHash, right.calls[0].command.documentHash);
  assert.equal(left.calls[0].command.requestHash, right.calls[0].command.requestHash);
});

test("variant route propagates path identities and serializes exact generations", async () => {
  const fake = fakeRepository();
  const incoming = request(
    `/v1/storefront/sales-channels/${ids.channel}/products/${ids.product}/variants/${ids.variant}/publication`,
    "PUT",
    { storefrontId: ids.storefront, state: "published", publicSlugSuffix: "blue-large" },
  );
  const response = await handleStorefrontPublishingRequest(
    incoming,
    new URL(incoming.url),
    context,
    {},
    new StorefrontPublishingService(fake.repository),
  );
  assert.equal(response.status, 201);
  assert.equal(fake.calls[0].command.input.variantId, ids.variant);
  assert.deepEqual(await response.json(), {
    data: {
      id: fake.calls[0].command.entityId,
      state: "published",
      cacheGeneration: "4",
      replayed: false,
    },
  });
});

test("collection member route validates bounded object arrays", async () => {
  const fake = fakeRepository();
  const incoming = request(`/v1/storefront/collections/${ids.collection}/members`, "PUT", {
    members: [{ memberId: ids.member, productId: ids.product, variantId: ids.variant, sortOrder: 1 }],
  });
  const response = await handleStorefrontPublishingRequest(
    incoming,
    new URL(incoming.url),
    context,
    {},
    new StorefrontPublishingService(fake.repository),
  );
  assert.equal(response.status, 200);
  assert.equal(fake.calls[0].command.input.collectionId, ids.collection);
  assert.equal(fake.calls[0].command.input.members[0].variantId, ids.variant);
  assert.equal((await response.json()).data.cacheGeneration, "7");
});

test("navigation, content and homepage routes preserve immutable documents", async () => {
  const fake = fakeRepository();
  const service = new StorefrontPublishingService(fake.repository);
  for (const [path, body] of [
    [
      `/v1/storefront/storefronts/${ids.storefront}/navigation-revisions`,
      { placement: "header", navigationDocument: { items: [{ label: "Home", href: "/" }] } },
    ],
    [
      `/v1/storefront/storefronts/${ids.storefront}/content-pages`,
      {
        publicSlug: "about-us",
        title: "About us",
        status: "published",
        contentDocument: { blocks: [{ type: "richText", text: "About" }] },
      },
    ],
    [
      `/v1/storefront/storefronts/${ids.storefront}/homepage-revisions`,
      { status: "published", homepageDocument: { blocks: [{ type: "hero" }] } },
    ],
  ]) {
    const incoming = request(path, "POST", body);
    const response = await handleStorefrontPublishingRequest(
      incoming,
      new URL(incoming.url),
      context,
      {},
      service,
    );
    assert.equal(response.status, 201);
  }
  assert.deepEqual(fake.calls.map((call) => call.method), [
    "publishNavigation",
    "publishContentPage",
    "publishHomepage",
  ]);
});

test("unmatched publishing routes return null", async () => {
  const fake = fakeRepository();
  const incoming = request("/v1/storefront/not-a-publishing-route", "POST", {});
  assert.equal(
    await handleStorefrontPublishingRequest(
      incoming,
      new URL(incoming.url),
      context,
      {},
      new StorefrontPublishingService(fake.repository),
    ),
    null,
  );
  assert.equal(fake.calls.length, 0);
});
