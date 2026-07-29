import assert from "node:assert/strict";
import test from "node:test";
import {
  PermanentConnectorProviderError,
  RetryableConnectorProviderError,
  createGenericCsvAdapter,
  createGenericRestAdapter,
  createShopifyProductAdapter,
  mapInboundConnectorRecord,
  runConnectorPage,
} from "../../build/modules/integrations/src/index.js";

const connection = {
  schemaVersion: "1.0",
  connectionId: "connection-1",
  tenantId: "tenant-1",
  connectorType: "generic_csv",
  providerKey: "object-storage",
  credentialReference: "secret://connectors/csv-1",
  status: "active",
  createdAt: "2026-07-30T00:00:00.000Z",
};

const inboundMapping = {
  schemaVersion: "1.0",
  mappingId: "mapping-1",
  connectionId: "connection-1",
  resourceType: "product",
  platformField: "identity.name",
  externalField: "title",
  ownership: "external",
  direction: "inbound",
  transformVersion: "trim.v1",
};

test("generic CSV adapter parses quoted fields and advances deterministic row cursors", async () => {
  const adapter = createGenericCsvAdapter({
    source: {
      async load({ objectReference }) {
        assert.equal(objectReference, "r2://tenant-1/imports/products.csv");
        return new TextEncoder().encode("id,title,description\r\np-1,One,Plain\r\np-2,\"Two, Premium\",\"Line 1\nLine 2\"\r\np-3,Three,Done\r\n");
      },
    },
    configuration: {
      schemaVersion: "1.0",
      resourceType: "product",
      objectReference: "r2://tenant-1/imports/products.csv",
      externalIdColumn: "id",
    },
  });

  const first = await adapter.read({
    connection,
    resourceType: "product",
    direction: "inbound",
    limit: 2,
  });
  assert.equal(first.records.length, 2);
  assert.equal(first.records[1].externalId, "p-2");
  assert.equal(first.records[1].payload.title, "Two, Premium");
  assert.equal(first.records[1].payload.description, "Line 1\nLine 2");
  assert.equal(first.nextCursor, "csv_row_00000002");
  assert.equal(first.exhausted, false);

  const second = await adapter.read({
    connection,
    resourceType: "product",
    direction: "inbound",
    cursor: first.nextCursor,
    limit: 2,
  });
  assert.deepEqual(second.records.map((record) => record.externalId), ["p-3"]);
  assert.equal(second.exhausted, true);
  assert.equal("nextCursor" in second, false);
});

test("generic CSV adapter rejects duplicate identities and malformed row shapes", async () => {
  const duplicate = createGenericCsvAdapter({
    source: { async load() { return new TextEncoder().encode("id,title\np-1,One\np-1,Again\n"); } },
    configuration: {
      schemaVersion: "1.0",
      resourceType: "product",
      objectReference: "r2://tenant-1/imports/products.csv",
      externalIdColumn: "id",
    },
  });
  await assert.rejects(
    duplicate.read({ connection, resourceType: "product", direction: "inbound", limit: 10 }),
    (error) => error instanceof PermanentConnectorProviderError && error.category === "csv_external_id_duplicate",
  );

  const malformed = createGenericCsvAdapter({
    source: { async load() { return new TextEncoder().encode("id,title\np-1,One,Unexpected\n"); } },
    configuration: {
      schemaVersion: "1.0",
      resourceType: "product",
      objectReference: "r2://tenant-1/imports/products.csv",
      externalIdColumn: "id",
    },
  });
  await assert.rejects(
    malformed.read({ connection, resourceType: "product", direction: "inbound", limit: 10 }),
    /column count/i,
  );
});

test("generic REST adapter binds credentials, query pagination and bounded JSON pointers", async () => {
  const requests = [];
  const adapter = createGenericRestAdapter({
    credentials: {
      async headersFor(input) {
        assert.equal(input.credentialReference, "secret://connectors/rest-1");
        return { authorization: "Bearer resolved-outside-database" };
      },
    },
    transport: {
      async request(input) {
        requests.push(input);
        return {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          body: new TextEncoder().encode(JSON.stringify({ data: { records: [{ id: 11, title: "One" }, { id: 12, title: "Two" }], next: "cursor-next-01" } })),
        };
      },
    },
    configuration: {
      schemaVersion: "1.0",
      resourceType: "product",
      baseUrl: "https://partner.example/api/",
      path: "/v2/products",
      itemsPointer: "/data/records",
      externalIdPointer: "/id",
      nextCursorPointer: "/data/next",
      cursorQueryParameter: "after",
      limitQueryParameter: "page_size",
      staticQuery: { status: "active" },
    },
  });

  const result = await adapter.read({
    connection: { ...connection, connectorType: "generic_rest", providerKey: "partner", credentialReference: "secret://connectors/rest-1" },
    resourceType: "product",
    direction: "inbound",
    cursor: "cursor-current-01",
    limit: 2,
  });
  assert.deepEqual(result.records.map((record) => record.externalId), ["11", "12"]);
  assert.equal(result.nextCursor, "cursor-next-01");
  assert.equal(result.exhausted, false);
  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.origin, "https://partner.example");
  assert.equal(requestUrl.pathname, "/v2/products");
  assert.equal(requestUrl.searchParams.get("after"), "cursor-current-01");
  assert.equal(requestUrl.searchParams.get("page_size"), "2");
  assert.equal(requestUrl.searchParams.get("status"), "active");
  assert.equal(requests[0].headers.authorization, "Bearer resolved-outside-database");
});

test("generic REST adapter classifies retryable provider outages without advancing a connector cursor", async () => {
  const adapter = createGenericRestAdapter({
    credentials: { async headersFor() { return { authorization: "Bearer resolved" }; } },
    transport: {
      async request() {
        return { statusCode: 429, headers: {}, body: new Uint8Array() };
      },
    },
    configuration: {
      schemaVersion: "1.0",
      resourceType: "product",
      baseUrl: "https://partner.example",
      path: "/products",
      itemsPointer: "/items",
      externalIdPointer: "/id",
      nextCursorPointer: "/next",
    },
  });
  let outcomes = 0;
  let cursors = 0;
  await assert.rejects(
    runConnectorPage({
      connection: { ...connection, connectorType: "generic_rest", providerKey: "partner" },
      mappings: [inboundMapping],
      resourceType: "product",
      direction: "inbound",
      adapter,
      apply: { async apply() { return { status: "applied", platformReference: "product-1" }; } },
      commands: {
        async recordOutcome() { outcomes += 1; },
        async advanceCursor() { cursors += 1; },
      },
      observedAt: "2026-07-30T00:00:00.000Z",
    }),
    (error) => error instanceof RetryableConnectorProviderError && error.category === "provider_retryable",
  );
  assert.equal(outcomes, 0);
  assert.equal(cursors, 0);
});

test("Shopify adapter uses explicit GraphQL API version and cursor pagination", async () => {
  const requests = [];
  const adapter = createShopifyProductAdapter({
    credentials: { async headersFor() { return { "x-shopify-access-token": "resolved-outside-database" }; } },
    transport: {
      async request(input) {
        requests.push(input);
        return {
          statusCode: 200,
          headers: { "x-shopify-api-version": "2026-07" },
          body: new TextEncoder().encode(JSON.stringify({
            data: {
              products: {
                edges: [
                  { cursor: "edge-1", node: { id: "gid://shopify/Product/1", title: "One", handle: "one", status: "ACTIVE", vendor: "Ozzyl", productType: "Demo", updatedAt: "2026-07-30T00:00:00Z", variants: { nodes: [] } } },
                ],
                pageInfo: { hasNextPage: true, endCursor: "shopify-next-cursor" },
              },
            },
          })),
        };
      },
    },
    configuration: {
      schemaVersion: "1.0",
      resourceType: "product",
      shopDomain: "ozzyl-demo.myshopify.com",
      apiVersion: "2026-07",
      query: "updated_at:>='2026-07-01T00:00:00Z'",
    },
  });

  const result = await adapter.read({
    connection: { ...connection, connectorType: "shopify_graphql", providerKey: "shopify" },
    resourceType: "product",
    direction: "inbound",
    cursor: "shopify-current-cursor",
    limit: 50,
  });
  assert.equal(result.records[0].externalId, "gid://shopify/Product/1");
  assert.equal(result.nextCursor, "shopify-next-cursor");
  assert.equal(result.exhausted, false);
  assert.equal(requests[0].url, "https://ozzyl-demo.myshopify.com/admin/api/2026-07/graphql.json");
  const requestBody = JSON.parse(new TextDecoder().decode(requests[0].body));
  assert.equal(requestBody.variables.first, 50);
  assert.equal(requestBody.variables.after, "shopify-current-cursor");
  assert.match(requestBody.query, /products\(first: \$first/u);
  assert.throws(
    () => createShopifyProductAdapter({
      credentials: { async headersFor() { return {}; } },
      transport: { async request() { throw new Error("not used"); } },
      configuration: { schemaVersion: "1.0", resourceType: "product", shopDomain: "ozzyl-demo.myshopify.com", apiVersion: "latest" },
    }),
    /explicit quarterly/i,
  );
});

test("inbound mapping applies external ownership and surfaces manual conflicts", () => {
  const record = {
    syncId: "sync-1",
    externalId: "external-1",
    payload: { title: "  Premium Product  ", quantity: 12 },
  };
  const applied = mapInboundConnectorRecord({ record, mappings: [inboundMapping] });
  assert.equal(applied.status, "applied");
  assert.deepEqual(applied.payload, { identity: { name: "Premium Product" } });

  const manual = mapInboundConnectorRecord({
    record,
    mappings: [{ ...inboundMapping, mappingId: "mapping-2", ownership: "manual" }],
    currentPlatformRecord: { identity: { name: "Locally approved name" } },
  });
  assert.deepEqual(manual, { status: "conflict", reasonCode: "manual_field_conflict" });

  const unsafe = mapInboundConnectorRecord({
    record,
    mappings: [{ ...inboundMapping, mappingId: "mapping-3", platformField: "__proto__.polluted" }],
  });
  assert.deepEqual(unsafe, { status: "rejected", reasonCode: "mapping_invalid" });
  assert.equal({}.polluted, undefined);
});
