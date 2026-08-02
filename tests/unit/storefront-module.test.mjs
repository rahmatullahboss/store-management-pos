import test from "node:test";
import assert from "node:assert/strict";
import { StorefrontCommandService } from "../../build/modules/storefront/src/index.js";

const context = {
  requestId: "018f0000-0000-7000-8000-000000000001",
  traceId: "trace-storefront-module",
  tenantId: "018f0000-0000-4000-8000-000000000002",
  actorId: "018f0000-0000-4000-8000-000000000003",
  legalEntityId: "018f0000-0000-4000-8000-000000000004",
  storeId: "018f0000-0000-4000-8000-000000000005",
  locale: "en-GB",
  timeZone: "Europe/London",
  businessDate: "2026-07-30",
  region: "test",
  permissions: new Set([
    "storefront.storefront.create",
    "storefront.storefront.update",
    "storefront.channel.manage",
    "storefront.publication.manage",
    "storefront.domain.manage",
    "storefront.content.manage",
  ]),
};

function fakeRepository() {
  const commands = [];
  return {
    commands,
    repository: {
      async createStorefront(command) {
        commands.push({ method: "createStorefront", command });
        return { id: command.entityId, replayed: false };
      },
      async transitionStorefront(command) {
        commands.push({ method: "transitionStorefront", command });
        return { id: command.entityId, status: command.input.status, replayed: false };
      },
      async createSalesChannel(command) {
        commands.push({ method: "createSalesChannel", command });
        return { id: command.entityId, replayed: false };
      },
      async transitionSalesChannel(command) {
        commands.push({ method: "transitionSalesChannel", command });
        return { id: command.entityId, status: command.input.status, replayed: false };
      },
      async setProductPublication(command) {
        commands.push({ method: "setProductPublication", command });
        return {
          id: command.entityId,
          state: command.input.state,
          cacheGeneration: 1n,
          replayed: false,
        };
      },
      async registerDomain(command) {
        commands.push({ method: "registerDomain", command });
        return { id: command.entityId, status: "verification_pending", replayed: false };
      },
      async recordDomainVerification(command) {
        commands.push({ method: "recordDomainVerification", command });
        return { id: command.entityId, status: "certificate_pending", replayed: false };
      },
      async transitionDomain(command) {
        commands.push({ method: "transitionDomain", command });
        return { id: command.entityId, status: command.input.status, replayed: false };
      },
      async publishTheme(command) {
        commands.push({ method: "publishTheme", command });
        return { id: command.entityId, revision: 1n, cacheGeneration: 1n, replayed: false };
      },
    },
  };
}

test("create storefront normalizes command input and hashes deterministically", async () => {
  const first = fakeRepository();
  const second = fakeRepository();
  const serviceA = new StorefrontCommandService(first.repository);
  const serviceB = new StorefrontCommandService(second.repository);
  const base = {
    legalEntityId: "018F0000-0000-4000-8000-000000000004",
    primaryStoreId: "018F0000-0000-4000-8000-000000000005",
    code: "  Online-Store  ",
    displayName: "  Online Store  ",
    defaultLocale: " en-GB ",
    defaultCurrency: "gbp",
    timeZone: " Europe/London ",
    platformSubdomain: " Tenant-One ",
    idempotencyKey: "create-storefront-one",
  };
  await serviceA.createStorefront(context, {
    ...base,
    settings: { z: 1, nested: { b: 2, a: 1 } },
  });
  await serviceB.createStorefront(context, {
    ...base,
    settings: { nested: { a: 1, b: 2 }, z: 1 },
  });

  const left = first.commands[0].command;
  const right = second.commands[0].command;
  assert.equal(left.input.code, "online-store");
  assert.equal(left.input.displayName, "Online Store");
  assert.equal(left.input.defaultCurrency, "GBP");
  assert.equal(left.input.platformSubdomain, "tenant-one");
  assert.equal(left.input.legalEntityId, "018f0000-0000-4000-8000-000000000004");
  assert.equal(left.requestHash, right.requestHash);
  assert.match(left.receiptId, /^[0-9a-f-]{36}$/);
  assert.notEqual(left.entityId, right.entityId);
});

test("permission checks happen before repository calls", async () => {
  const fake = fakeRepository();
  const service = new StorefrontCommandService(fake.repository);
  await assert.rejects(
    () =>
      service.createStorefront(
        { ...context, permissions: new Set() },
        {
          legalEntityId: "018f0000-0000-4000-8000-000000000004",
          code: "online",
          displayName: "Online",
          defaultLocale: "en-GB",
          defaultCurrency: "GBP",
          timeZone: "Europe/London",
          idempotencyKey: "denied",
        },
      ),
    /Permission denied/,
  );
  assert.equal(fake.commands.length, 0);
});

test("scheduled publication requires a valid schedule", async () => {
  const fake = fakeRepository();
  const service = new StorefrontCommandService(fake.repository);
  const input = {
    storefrontId: "018f0000-0000-4000-8000-000000000010",
    salesChannelId: "018f0000-0000-4000-8000-000000000011",
    productId: "018f0000-0000-4000-8000-000000000012",
    publicSlug: "linen-shirt",
    state: "scheduled",
    idempotencyKey: "schedule-product",
  };
  await assert.rejects(() => service.setProductPublication(context, input), /schedule time/);
  await service.setProductPublication(context, {
    ...input,
    scheduledFor: "2026-08-01T12:00:00+06:00",
  });
  const command = fake.commands[0].command;
  assert.equal(command.input.scheduledFor, "2026-08-01T06:00:00.000Z");
  assert.equal(command.input.publicSlug, "linen-shirt");
});

test("custom domains require verification and safe hostnames", async () => {
  const fake = fakeRepository();
  const service = new StorefrontCommandService(fake.repository);
  const base = {
    storefrontId: "018f0000-0000-4000-8000-000000000010",
    hostname: "Shop.Example.COM.",
    kind: "custom",
    idempotencyKey: "domain-one",
  };
  await assert.rejects(() => service.registerDomain(context, base), /verification method/);
  await service.registerDomain(context, { ...base, verificationMethod: "dns_txt" });
  assert.equal(fake.commands[0].command.input.hostname, "shop.example.com");
  await assert.rejects(
    () => service.registerDomain(context, { ...base, hostname: "https://shop.example.com", verificationMethod: "dns_txt" }),
    /hostname is invalid/,
  );
});

test("domain verification validates hashes, attempts and expiry", async () => {
  const fake = fakeRepository();
  const service = new StorefrontCommandService(fake.repository);
  const base = {
    domainId: "018f0000-0000-4000-8000-000000000020",
    attempt: 1,
    challengeType: "dns_txt",
    challengeName: "_verify.shop.example.com",
    challengeValueHash: "a".repeat(64),
    resultStatus: "verified",
    observedAt: "2026-07-30T00:00:00Z",
    expiresAt: "2026-07-31T00:00:00Z",
    idempotencyKey: "verify-domain-one",
  };
  await service.recordDomainVerification(context, base);
  assert.equal(fake.commands.length, 1);
  await assert.rejects(
    () => service.recordDomainVerification(context, { ...base, attempt: 0 }),
    /attempt is invalid/,
  );
  await assert.rejects(
    () => service.recordDomainVerification(context, { ...base, challengeValueHash: "unsafe" }),
    /hash is invalid/,
  );
  await assert.rejects(
    () => service.recordDomainVerification(context, { ...base, expiresAt: base.observedAt }),
    /after observation/,
  );
});

test("theme documents use a canonical command hash", async () => {
  const first = fakeRepository();
  const second = fakeRepository();
  const input = {
    storefrontId: "018f0000-0000-4000-8000-000000000010",
    idempotencyKey: "publish-theme",
  };
  await new StorefrontCommandService(first.repository).publishTheme(context, {
    ...input,
    themeDocument: { colors: { foreground: "#111111", background: "#ffffff" }, density: "comfortable" },
  });
  await new StorefrontCommandService(second.repository).publishTheme(context, {
    ...input,
    themeDocument: { density: "comfortable", colors: { background: "#ffffff", foreground: "#111111" } },
  });
  assert.equal(first.commands[0].command.requestHash, second.commands[0].command.requestHash);
});
