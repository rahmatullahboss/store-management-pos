import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CustomerService, InMemoryCustomerRepository } from "../../build/modules/customer/src/index.js";

const tenantA = "018f0000-0000-7000-8000-000000000001";
const tenantB = "018f0000-0000-7000-8000-000000000002";
const actor = "018f0000-0000-7000-8000-000000000101";
const legalEntity = "018f0000-0000-7000-8000-000000000201";

function context(tenantId = tenantA, permissions = [
  "customer.profile.create",
  "customer.profile.read",
  "customer.profile.update",
  "customer.profile.merge",
  "customer.credit.manage",
  "customer.credit.approve",
  "customer.import",
  "customer.export",
]) {
  return {
    requestId: crypto.randomUUID(),
    traceId: crypto.randomUUID(),
    tenantId,
    actorId: actor,
    legalEntityId: legalEntity,
    storeId: "018f0000-0000-7000-8000-000000000301",
    locale: "en-GB",
    timeZone: "Europe/London",
    businessDate: "2026-07-28",
    region: "test",
    permissions: new Set(permissions),
  };
}

test("customer profiles preserve addresses, contacts and consent history", async () => {
  const service = new CustomerService(new InMemoryCustomerRepository(), { now: () => "2026-07-28T10:00:00.000Z" });
  const created = await service.create(context(), {
    idempotencyKey: "customer-create-001",
    kind: "person",
    displayName: "Amina Rahman",
    person: { givenName: "Amina", familyName: "Rahman" },
    contacts: [{ type: "email", value: "AMINA@example.com", primary: true }],
    addresses: [{ type: "billing", line1: "12 Market Street", city: "London", postalCode: "E1 1AA", countryCode: "GB", primary: true }],
    tags: ["VIP", "newsletter"],
    groups: ["retail"],
    taxRegistrations: [{ countryCode: "GB", registrationType: "VAT", registrationNumber: "GB123456789" }],
  });
  const replay = await service.create(context(), {
    idempotencyKey: "customer-create-001",
    kind: "person",
    displayName: "Amina Rahman",
    person: { givenName: "Amina", familyName: "Rahman" },
    contacts: [{ type: "email", value: "AMINA@example.com", primary: true }],
    addresses: [{ type: "billing", line1: "12 Market Street", city: "London", postalCode: "E1 1AA", countryCode: "GB", primary: true }],
    tags: ["VIP", "newsletter"],
    groups: ["retail"],
    taxRegistrations: [{ countryCode: "GB", registrationType: "VAT", registrationNumber: "GB123456789" }],
  });
  assert.equal(created.id, replay.id);
  assert.equal(created.contacts[0].normalizedValue, "amina@example.com");
  assert.equal(created.addresses[0].countryCode, "GB");
  assert.deepEqual(created.tags, ["newsletter", "vip"]);

  const consented = await service.recordConsent(context(), created.id, {
    channel: "email",
    purpose: "marketing",
    granted: true,
    source: "admin",
    expectedVersion: created.version,
  });
  assert.equal(consented.consentHistory.length, 1);
  assert.equal(consented.consentHistory[0].granted, true);
  assert.equal(consented.version, 2n);
});

test("duplicate detection and merge preserve every historical identity", async () => {
  const repository = new InMemoryCustomerRepository();
  const service = new CustomerService(repository, { now: () => "2026-07-28T10:00:00.000Z" });
  const first = await service.create(context(), {
    idempotencyKey: "customer-duplicate-001",
    kind: "person",
    displayName: "Amina Rahman",
    contacts: [{ type: "phone", value: "+44 7700 900123", primary: true }],
  });
  const second = await service.create(context(), {
    idempotencyKey: "customer-duplicate-002",
    kind: "person",
    displayName: "Amina R.",
    contacts: [{ type: "phone", value: "+44 (7700) 900123", primary: true }],
  });
  const duplicates = await service.findDuplicates(context(), second.id);
  assert.deepEqual(duplicates.map((candidate) => candidate.customerId), [first.id]);

  const merged = await service.merge(context(), {
    survivorId: first.id,
    duplicateId: second.id,
    expectedSurvivorVersion: first.version,
    expectedDuplicateVersion: second.version,
    reason: "Confirmed duplicate phone identity",
  });
  assert.equal(merged.survivor.id, first.id);
  assert.deepEqual(merged.survivor.historicalCustomerIds, [second.id]);
  const duplicate = await repository.get(tenantA, second.id);
  assert.equal(duplicate.status, "merged");
  assert.equal(duplicate.mergedIntoId, first.id);
  assert.equal(repository.auditEvents.filter((event) => event.action === "customer.profile.merge").length, 1);
});

test("credit controls require approval when an on-account sale exceeds the available limit", async () => {
  const service = new CustomerService(new InMemoryCustomerRepository(), { now: () => "2026-07-28T10:00:00.000Z" });
  const customer = await service.create(context(), {
    idempotencyKey: "customer-credit-001",
    kind: "company",
    displayName: "Northwind Retail Ltd",
    company: { legalName: "Northwind Retail Ltd", registrationNumber: "01234567" },
  });
  const withCredit = await service.setCreditProfile(context(), customer.id, {
    currency: "GBP",
    limitMinor: 100_000n,
    balanceMinor: 75_000n,
    paymentTermsDays: 30,
    status: "active",
    expectedVersion: customer.version,
  });
  const within = await service.checkCredit(context(), { customerId: customer.id, amountMinor: 20_000n, currency: "GBP" });
  assert.deepEqual(within, { decision: "approved", availableMinor: 25_000n, approvalRequired: false });
  const exceeded = await service.checkCredit(context(), { customerId: customer.id, amountMinor: 30_000n, currency: "GBP" });
  assert.equal(exceeded.decision, "approval_required");
  assert.equal(exceeded.excessMinor, 5_000n);

  const approved = await service.authorizeCreditOverride(context(), {
    customerId: customer.id,
    amountMinor: 30_000n,
    currency: "GBP",
    reason: "Manager-approved strategic account order",
    expectedVersion: withCredit.version,
  });
  assert.equal(approved.approved, true);
  assert.equal(approved.approverId, actor);
});

test("customer queries are tenant isolated and permission constrained", async () => {
  const repository = new InMemoryCustomerRepository();
  const service = new CustomerService(repository);
  const alpha = await service.create(context(tenantA), { idempotencyKey: "tenant-alpha-customer", kind: "person", displayName: "Alpha Customer" });
  await service.create(context(tenantB), { idempotencyKey: "tenant-beta-customer", kind: "person", displayName: "Beta Customer" });
  assert.deepEqual((await service.list(context(tenantA))).items.map((item) => item.id), [alpha.id]);
  await assert.rejects(() => service.list(context(tenantA, [])), /customer\.profile\.read/);
  await assert.rejects(() => service.get(context(tenantB), alpha.id), /not found/i);
});

test("customer import and export remain deterministic and bounded", async () => {
  const service = new CustomerService(new InMemoryCustomerRepository());
  const imported = await service.importCustomers(context(), {
    idempotencyKey: "customer-import-001",
    rows: [
      { externalId: "CRM-001", kind: "person", displayName: "Imported One", email: "one@example.com", countryCode: "GB" },
      { externalId: "CRM-002", kind: "company", displayName: "Imported Two Ltd", email: "two@example.com", countryCode: "GB" },
    ],
  });
  assert.deepEqual(imported, { imported: 2, skipped: 0, errors: [] });
  const exported = await service.exportCustomers(context(), { limit: 50 });
  assert.deepEqual(exported.rows.map((row) => row.externalId), ["CRM-001", "CRM-002"]);
  assert.equal(exported.nextCursor, undefined);
  await assert.rejects(() => service.importCustomers(context(), { idempotencyKey: "too-large", rows: Array.from({ length: 1001 }, (_, index) => ({ externalId: `X-${index}`, kind: "person", displayName: `Customer ${index}` })) }), /1000/);
});

test("customer migration declares tenant RLS, immutable history and indexed identity lookup", async () => {
  const sql = await readFile("database/modules/customer/migrations/CUS-0001-customer.sql", "utf8");
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS customer/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS customer\.customers/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS customer\.consent_events/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS customer\.merge_history/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/g);
  assert.match(sql, /customer\.reject_history_mutation/);
  assert.match(sql, /customer_contacts_normalized_idx/);
  assert.match(sql, /customer_external_identity_unique/);
  assert.match(sql, /customer\.credit\.approve/);
  assert.match(sql, /CUS-0001/);
});
