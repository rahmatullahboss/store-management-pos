import test from "node:test";
import assert from "node:assert/strict";
import { handleStorefrontRequest } from "../../build/apps/api/src/modules/storefront/handler.js";

const context = {
  requestId: "018f0000-0000-7000-8000-000000000001",
  traceId: "trace-storefront-handler",
  tenantId: "018f0000-0000-4000-8000-000000000002",
  actorId: "018f0000-0000-4000-8000-000000000003",
  legalEntityId: "018f0000-0000-4000-8000-000000000004",
  storeId: "018f0000-0000-4000-8000-000000000005",
  locale: "en-GB",
  timeZone: "Europe/London",
  businessDate: "2026-07-30",
  region: "test",
  permissions: new Set(),
};

function fakeCommands() {
  const calls = [];
  const service = {
    async createStorefront(receivedContext, input) {
      calls.push({ method: "createStorefront", receivedContext, input });
      return { id: "018f0000-0000-4000-8000-000000000010", replayed: false };
    },
    async transitionStorefront(receivedContext, input) {
      calls.push({ method: "transitionStorefront", receivedContext, input });
      return { id: input.storefrontId, status: input.status, replayed: false };
    },
    async createSalesChannel(receivedContext, input) {
      calls.push({ method: "createSalesChannel", receivedContext, input });
      return { id: "018f0000-0000-4000-8000-000000000011", replayed: false };
    },
    async transitionSalesChannel(receivedContext, input) {
      calls.push({ method: "transitionSalesChannel", receivedContext, input });
      return { id: input.salesChannelId, status: input.status, replayed: false };
    },
    async setProductPublication(receivedContext, input) {
      calls.push({ method: "setProductPublication", receivedContext, input });
      return {
        id: "018f0000-0000-4000-8000-000000000013",
        state: input.state,
        cacheGeneration: 7n,
        replayed: false,
      };
    },
    async registerDomain(receivedContext, input) {
      calls.push({ method: "registerDomain", receivedContext, input });
      return { id: "018f0000-0000-4000-8000-000000000014", status: "verification_pending", replayed: false };
    },
    async recordDomainVerification(receivedContext, input) {
      calls.push({ method: "recordDomainVerification", receivedContext, input });
      return { id: input.domainId, status: "certificate_pending", replayed: false };
    },
    async transitionDomain(receivedContext, input) {
      calls.push({ method: "transitionDomain", receivedContext, input });
      return { id: input.domainId, status: input.status, replayed: false };
    },
    async publishTheme(receivedContext, input) {
      calls.push({ method: "publishTheme", receivedContext, input });
      return { id: "018f0000-0000-4000-8000-000000000015", revision: 2n, cacheGeneration: 8n, replayed: false };
    },
  };
  return { calls, service };
}

function request(path, method, body, key = "storefront-handler-key") {
  return new Request(`https://api.example.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function handle(path, method, body, fake = fakeCommands()) {
  const incoming = request(path, method, body);
  const response = await handleStorefrontRequest(incoming, new URL(incoming.url), context, {}, fake.service);
  return { ...fake, response };
}

test("create storefront route sends a bounded command and returns 201", async () => {
  const { calls, response } = await handle("/v1/storefront/storefronts", "POST", {
    legalEntityId: "018f0000-0000-4000-8000-000000000004",
    code: "online-store",
    displayName: "Online Store",
    defaultLocale: "en-GB",
    defaultCurrency: "GBP",
    timeZone: "Europe/London",
    settings: { catalogue: "public" },
  });

  assert.equal(response.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "createStorefront");
  assert.equal(calls[0].input.idempotencyKey, "storefront-handler-key");
  assert.deepEqual(calls[0].input.settings, { catalogue: "public" });
});

test("sales-channel route preserves explicit boolean false and country codes", async () => {
  const storefrontId = "018f0000-0000-4000-8000-000000000010";
  const { calls, response } = await handle(`/v1/storefront/storefronts/${storefrontId}/sales-channels`, "POST", {
    code: "web-pk",
    displayName: "Pakistan Web",
    priceListId: "018f0000-0000-4000-8000-000000000020",
    allowedCountryCodes: ["PK"],
    guestCheckoutEnabled: false,
    customerAccountsEnabled: true,
    backorderPolicy: "deny",
  });

  assert.equal(response.status, 201);
  assert.equal(calls[0].input.storefrontId, storefrontId);
  assert.equal(calls[0].input.guestCheckoutEnabled, false);
  assert.deepEqual(calls[0].input.allowedCountryCodes, ["PK"]);
});

test("publication route uses path identities and serializes bigint results", async () => {
  const channelId = "018f0000-0000-4000-8000-000000000011";
  const productId = "018f0000-0000-4000-8000-000000000012";
  const { calls, response } = await handle(
    `/v1/storefront/sales-channels/${channelId}/products/${productId}/publication`,
    "PUT",
    {
      storefrontId: "018f0000-0000-4000-8000-000000000010",
      publicSlug: "linen-shirt",
      state: "published",
      metadata: { featured: true },
    },
  );

  assert.equal(calls[0].input.salesChannelId, channelId);
  assert.equal(calls[0].input.productId, productId);
  assert.deepEqual(await response.json(), {
    data: {
      id: "018f0000-0000-4000-8000-000000000013",
      state: "published",
      cacheGeneration: "7",
      replayed: false,
    },
  });
});

test("domain registration remains available while external provider observations fail closed", async () => {
  const storefrontId = "018f0000-0000-4000-8000-000000000010";
  const domainId = "018f0000-0000-4000-8000-000000000014";
  const fake = fakeCommands();

  const registration = await handle(
    `/v1/storefront/storefronts/${storefrontId}/domains`,
    "POST",
    {
      hostname: "shop.example.com",
      kind: "custom",
      verificationMethod: "dns_txt",
    },
    fake,
  );
  assert.equal(registration.response.status, 201);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].method, "registerDomain");

  const verification = await handle(
    `/v1/storefront/domains/${domainId}/verifications`,
    "POST",
    {
      attempt: 1,
      challengeType: "dns_txt",
      challengeName: "_verify.shop.example.com",
      challengeValueHash: "a".repeat(64),
      resultStatus: "verified",
      providerReference: "forged-provider-reference",
      observedAt: "2026-08-01T10:00:00.000Z",
      expiresAt: "2026-08-01T11:00:00.000Z",
    },
    fake,
  );
  assert.equal(verification.response.status, 503);
  assert.deepEqual(await verification.response.json(), {
    error: { code: "DOMAIN_PROVIDER_CONTROL_UNAVAILABLE" },
  });
  assert.equal(verification.response.headers.get("cache-control"), "no-store");

  const transition = await handle(
    `/v1/storefront/domains/${domainId}/transition`,
    "POST",
    {
      status: "active",
      certificateStatus: "active",
      providerHostnameId: "forged-provider-hostname",
      canonical: true,
    },
    fake,
  );
  assert.equal(transition.response.status, 503);
  assert.deepEqual(await transition.response.json(), {
    error: { code: "DOMAIN_PROVIDER_CONTROL_UNAVAILABLE" },
  });
  assert.equal(transition.response.headers.get("cache-control"), "no-store");

  assert.equal(fake.calls.length, 1);
});

test("theme publication requires an object and serializes revisions", async () => {
  const storefrontId = "018f0000-0000-4000-8000-000000000010";
  const { response } = await handle(`/v1/storefront/storefronts/${storefrontId}/theme-revisions`, "POST", {
    themeDocument: { colors: { primary: "#123abc" } },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    data: {
      id: "018f0000-0000-4000-8000-000000000015",
      revision: "2",
      cacheGeneration: "8",
      replayed: false,
    },
  });
});

test("handler rejects invalid booleans before command execution", async () => {
  const fake = fakeCommands();
  const storefrontId = "018f0000-0000-4000-8000-000000000010";
  await assert.rejects(
    () => handle(`/v1/storefront/storefronts/${storefrontId}/sales-channels`, "POST", {
      code: "web",
      displayName: "Web",
      priceListId: "018f0000-0000-4000-8000-000000000020",
      guestCheckoutEnabled: "yes",
    }, fake),
    /guestCheckoutEnabled must be a boolean/,
  );
  assert.equal(fake.calls.length, 0);
});

test("unmatched routes return null without invoking commands", async () => {
  const fake = fakeCommands();
  const incoming = request("/v1/storefront/unknown", "POST", {});
  const response = await handleStorefrontRequest(incoming, new URL(incoming.url), context, {}, fake.service);
  assert.equal(response, null);
  assert.equal(fake.calls.length, 0);
});
