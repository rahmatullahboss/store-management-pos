import assert from "node:assert/strict";
import test from "node:test";
import {
  StorefrontPublicationService,
} from "../../build/modules/storefront/src/publication.js";
import {
  handleStorefrontPublicationRequest,
} from "../../build/apps/api/src/modules/storefront/publication-handler.js";

const ids = {
  tenant: "018f0000-0000-4000-8000-000000000001",
  actor: "018f0000-0000-4000-8000-000000000002",
  storefront: "018f0000-0000-4000-8000-000000000003",
  channel: "018f0000-0000-4000-8000-000000000004",
  product: "018f0000-0000-4000-8000-000000000005",
  variant: "018f0000-0000-4000-8000-000000000006",
  category: "018f0000-0000-4000-8000-000000000007",
  collection: "018f0000-0000-4000-8000-000000000008",
  member: "018f0000-0000-4000-8000-000000000009",
  page: "018f0000-0000-4000-8000-000000000010",
  homepage: "018f0000-0000-4000-8000-000000000011",
};

function context(permissions = [
  "storefront.publication.manage",
  "storefront.content.manage",
]) {
  return {
    requestId: "018f0000-0000-7000-8000-000000000012",
    traceId: "trace-storefront-publication",
    tenantId: ids.tenant,
    actorId: ids.actor,
    legalEntityId: "018f0000-0000-4000-8000-000000000013",
    storeId: "018f0000-0000-4000-8000-000000000014",
    locale: "en-GB",
    timeZone: "Europe/London",
    businessDate: "2026-07-30",
    region: "test",
    permissions: new Set(permissions),
  };
}

function repository() {
  const calls = [];
  const result = (command, state = "published") => ({
    id: command.entityId,
    state,
    cacheGeneration: 12n,
    replayed: false,
  });
  return {
    calls,
    repository: {
      async setVariantPublication(command) {
        calls.push({ method: "setVariantPublication", command });
        return result(command, command.input.state);
      },
      async setCategoryPublication(command) {
        calls.push({ method: "setCategoryPublication", command });
        return result(command, command.input.state);
      },
      async setCollection(command) {
        calls.push({ method: "setCollection", command });
        return result(command, command.input.state);
      },
      async replaceCollectionMembers(command) {
        calls.push({ method: "replaceCollectionMembers", command });
        return {
          id: command.input.collectionId,
          memberCount: command.input.members.length,
          cacheGeneration: 13n,
          replayed: false,
        };
      },
      async publishNavigation(command) {
        calls.push({ method: "publishNavigation", command });
        return {
          id: command.entityId,
          revision: 2n,
          cacheGeneration: 14n,
          replayed: false,
        };
      },
      async publishContentPage(command) {
        calls.push({ method: "publishContentPage", command });
        return {
          id: command.input.contentPageId,
          revision: 3n,
          status: command.input.status,
          cacheGeneration: 15n,
          replayed: false,
        };
      },
      async publishHomepage(command) {
        calls.push({ method: "publishHomepage", command });
        return {
          id: command.input.homepageId,
          revision: 4n,
          status: command.input.status,
          cacheGeneration: 16n,
          replayed: false,
        };
      },
    },
  };
}

test("publication service normalizes scheduled categories and hashes an idempotent envelope", async () => {
  const fake = repository();
  const service = new StorefrontPublicationService(fake.repository);
  await service.setCategoryPublication(context(), {
    storefrontId: ids.storefront.toUpperCase(),
    salesChannelId: ids.channel,
    categoryId: ids.category,
    publicSlug: "  Summer-Sale  ",
    sortOrder: 4,
    state: "scheduled",
    scheduledFor: "2026-08-01T10:00:00+06:00",
    idempotencyKey: " category-publish-1 ",
  });

  assert.equal(fake.calls.length, 1);
  const command = fake.calls[0].command;
  assert.equal(command.input.storefrontId, ids.storefront);
  assert.equal(command.input.publicSlug, "summer-sale");
  assert.equal(command.input.scheduledFor, "2026-08-01T04:00:00.000Z");
  assert.equal(command.input.idempotencyKey, "category-publish-1");
  assert.match(command.requestHash, /^[a-f0-9]{64}$/u);
  assert.match(command.entityId, /^[0-9a-f-]{36}$/u);
});

test("publication service rejects missing schedules and duplicate collection members", async () => {
  const fake = repository();
  const service = new StorefrontPublicationService(fake.repository);

  await assert.rejects(
    () => service.setCollection(context(), {
      collectionId: ids.collection,
      storefrontId: ids.storefront,
      salesChannelId: ids.channel,
      code: "summer",
      publicSlug: "summer",
      title: "Summer",
      state: "scheduled",
      idempotencyKey: "collection-1",
    }),
    /requires a scheduled time/u,
  );

  await assert.rejects(
    () => service.replaceCollectionMembers(context(), {
      collectionId: ids.collection,
      members: [
        { memberId: ids.member, productId: ids.product, sortOrder: 1 },
        {
          memberId: "018f0000-0000-4000-8000-000000000015",
          productId: ids.product,
          sortOrder: 2,
        },
      ],
      idempotencyKey: "members-1",
    }),
    /duplicate product and variant/u,
  );
  assert.equal(fake.calls.length, 0);
});

test("publication service enforces owner permissions before repository access", async () => {
  const fake = repository();
  const service = new StorefrontPublicationService(fake.repository);
  await assert.rejects(
    () => service.publishNavigation(context([]), {
      storefrontId: ids.storefront,
      placement: "header",
      navigationDocument: { items: [] },
      idempotencyKey: "nav-1",
    }),
    /permission/i,
  );
  assert.equal(fake.calls.length, 0);
});

function fakeCommands() {
  const calls = [];
  return {
    calls,
    service: {
      async setVariantPublication(receivedContext, input) {
        calls.push({ method: "setVariantPublication", receivedContext, input });
        return { id: ids.variant, state: input.state, cacheGeneration: 21n, replayed: false };
      },
      async setCategoryPublication(receivedContext, input) {
        calls.push({ method: "setCategoryPublication", receivedContext, input });
        return { id: ids.category, state: input.state, cacheGeneration: 22n, replayed: false };
      },
      async setCollection(receivedContext, input) {
        calls.push({ method: "setCollection", receivedContext, input });
        return { id: ids.collection, state: input.state, cacheGeneration: 23n, replayed: false };
      },
      async replaceCollectionMembers(receivedContext, input) {
        calls.push({ method: "replaceCollectionMembers", receivedContext, input });
        return { id: ids.collection, memberCount: input.members.length, cacheGeneration: 24n, replayed: false };
      },
      async publishNavigation(receivedContext, input) {
        calls.push({ method: "publishNavigation", receivedContext, input });
        return { id: crypto.randomUUID(), revision: 2n, cacheGeneration: 25n, replayed: false };
      },
      async publishContentPage(receivedContext, input) {
        calls.push({ method: "publishContentPage", receivedContext, input });
        return { id: ids.page, revision: 3n, status: input.status, cacheGeneration: 26n, replayed: false };
      },
      async publishHomepage(receivedContext, input) {
        calls.push({ method: "publishHomepage", receivedContext, input });
        return { id: ids.homepage, revision: 4n, status: input.status, cacheGeneration: 27n, replayed: false };
      },
    },
  };
}

function request(path, method, body) {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": "publication-handler-1",
    },
    body: JSON.stringify(body),
  });
}

async function handle(path, method, body, fake = fakeCommands()) {
  const incoming = request(path, method, body);
  const response = await handleStorefrontPublicationRequest(
    incoming,
    new URL(incoming.url),
    context(),
    {},
    fake.service,
  );
  return { ...fake, response };
}

test("variant publication route binds all path identities and serializes bigint", async () => {
  const { calls, response } = await handle(
    `/v1/storefront/sales-channels/${ids.channel}/products/${ids.product}/variants/${ids.variant}/publication`,
    "PUT",
    {
      storefrontId: ids.storefront,
      state: "published",
      publicSlugSuffix: "blue-xl",
      metadata: { featured: true },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(calls[0].input.salesChannelId, ids.channel);
  assert.equal(calls[0].input.productId, ids.product);
  assert.equal(calls[0].input.variantId, ids.variant);
  assert.deepEqual(await response.json(), {
    data: {
      id: ids.variant,
      state: "published",
      cacheGeneration: "21",
      replayed: false,
    },
  });
});

test("content page route accepts bounded documents and schedule metadata", async () => {
  const { calls, response } = await handle(
    `/v1/storefront/storefronts/${ids.storefront}/content-pages/${ids.page}/revisions`,
    "POST",
    {
      publicSlug: "shipping",
      title: "Shipping",
      status: "scheduled",
      contentDocument: { blocks: [{ type: "text", value: "Delivery details" }] },
      seoDocument: { title: "Shipping" },
      scheduledFor: "2026-08-02T12:00:00Z",
    },
  );

  assert.equal(response.status, 201);
  assert.equal(calls[0].method, "publishContentPage");
  assert.equal(calls[0].input.contentPageId, ids.page);
  assert.deepEqual(await response.json(), {
    data: {
      id: ids.page,
      revision: "3",
      status: "scheduled",
      cacheGeneration: "26",
      replayed: false,
    },
  });
});

test("publication handler returns null for non-owned routes", async () => {
  const fake = fakeCommands();
  const incoming = request("/v1/storefront/unknown", "POST", {});
  const response = await handleStorefrontPublicationRequest(
    incoming,
    new URL(incoming.url),
    context(),
    {},
    fake.service,
  );
  assert.equal(response, null);
  assert.equal(fake.calls.length, 0);
});
