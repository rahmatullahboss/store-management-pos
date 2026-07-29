import test from "node:test";
import assert from "node:assert/strict";
import {
  StorefrontContractError,
  normalizeStorefrontHostname,
  parseStorefrontBootstrapV1,
  parseStorefrontMoneyV1,
} from "../../build/packages/storefront-contracts/src/index.js";
import {
  StorefrontClientError,
  createStorefrontClient,
} from "../../build/packages/storefront-client/src/index.js";
import {
  storefrontHealthResponse,
  storefrontRequestHostname,
  storefrontUnavailableResponse,
} from "../../build/apps/storefront-web/src/index.js";
import {
  DEFAULT_STOREFRONT_THEME_V1,
  sanitizeStorefrontThemeV1,
} from "../../build/packages/storefront-theme/src/index.js";

const bootstrapPayload = {
  contractVersion: "storefront-bootstrap.v1",
  context: {
    tenantId: "tenant-1",
    storefrontId: "storefront-1",
    salesChannelId: "channel-1",
    requestHostname: "shop.example.com",
    canonicalHostname: "www.example.com",
    locale: "en-PK",
    currency: "PKR",
    priceListRevision: "price-rev-1",
    publicationGeneration: "catalog-gen-1",
  },
  themeRevision: "theme-rev-1",
  layoutRevision: "layout-rev-1",
  capabilities: ["catalog.read", "checkout.quote", "catalog.read"],
};

test("storefront money accepts integer minor units only", () => {
  assert.deepEqual(parseStorefrontMoneyV1({ currency: "pkr", minor: "125050", scale: 2 }), {
    currency: "PKR",
    minor: "125050",
    scale: 2,
  });
  assert.throws(
    () => parseStorefrontMoneyV1({ currency: "PKR", minor: "1250.50", scale: 2 }),
    StorefrontContractError,
  );
});

test("storefront hostname normalization rejects URLs and ports", () => {
  assert.equal(normalizeStorefrontHostname("Shop.Example.COM."), "shop.example.com");
  assert.throws(() => normalizeStorefrontHostname("https://shop.example.com"));
  assert.throws(() => normalizeStorefrontHostname("shop.example.com:443"));
  assert.throws(() => normalizeStorefrontHostname("localhost"));
});

test("bootstrap parsing is strict and removes duplicate capabilities", () => {
  const bootstrap = parseStorefrontBootstrapV1(bootstrapPayload);
  assert.equal(bootstrap.context.currency, "PKR");
  assert.deepEqual(bootstrap.capabilities, ["catalog.read", "checkout.quote"]);
  assert.throws(() =>
    parseStorefrontBootstrapV1({ ...bootstrapPayload, contractVersion: "storefront-bootstrap.v2" }),
  );
});

test("storefront client requests a normalized hostname and parses bootstrap", async () => {
  let observedUrl = "";
  const client = createStorefrontClient({
    baseUrl: "https://api.example.test/api",
    transport: {
      async fetch(input) {
        observedUrl = String(input);
        return Response.json(bootstrapPayload);
      },
    },
  });

  const bootstrap = await client.getBootstrap("SHOP.EXAMPLE.COM");
  assert.equal(bootstrap.context.storefrontId, "storefront-1");
  assert.equal(
    observedUrl,
    "https://api.example.test/v1/storefront/bootstrap?hostname=shop.example.com",
  );
});

test("storefront client returns a safe error without exposing response bodies", async () => {
  const client = createStorefrontClient({
    baseUrl: "https://api.example.test",
    transport: {
      async fetch() {
        return new Response("provider secret detail", { status: 503 });
      },
    },
  });

  await assert.rejects(
    () => client.getBootstrap("shop.example.com"),
    (error) =>
      error instanceof StorefrontClientError &&
      error.status === 503 &&
      !error.message.includes("secret"),
  );
});

test("storefront runtime uses URL hostname and fail-closed response headers", async () => {
  const request = new Request("https://shop.example.com/products/item");
  assert.equal(storefrontRequestHostname(request), "shop.example.com");

  const unavailable = storefrontUnavailableResponse();
  assert.equal(unavailable.status, 404);
  assert.match(unavailable.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(unavailable.headers.get("x-frame-options"), "DENY");

  const health = storefrontHealthResponse();
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("cache-control"), "no-store");
});

test("theme sanitization retains safe values and rejects CSS injection", () => {
  const theme = sanitizeStorefrontThemeV1({
    colors: {
      primary: "#123ABC",
      background: "url(https://attacker.invalid)",
    },
    density: "airy",
    corner: "rounded",
    container: "focused",
  });

  assert.equal(theme.colors.primary, "#123abc");
  assert.equal(theme.colors.background, DEFAULT_STOREFRONT_THEME_V1.colors.background);
  assert.equal(theme.density, "airy");
  assert.equal(theme.corner, "rounded");
  assert.equal(theme.container, "focused");
});
