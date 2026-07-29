import assert from "node:assert/strict";
import test from "node:test";
import { PlatformError } from "../../build/packages/foundation/src/errors.js";
import { LocalizationService } from "../../build/modules/localization/src/service.js";
import { NeonLocalizationStore } from "../../build/modules/localization/src/store.js";

const context = {
  requestId: "018f0000-0000-7000-8000-000000000001",
  traceId: "trace-localization",
  tenantId: "018f0000-0000-7000-8000-000000000002",
  actorId: "018f0000-0000-7000-8000-000000000003",
  legalEntityId: "018f0000-0000-7000-8000-000000000004",
  storeId: "018f0000-0000-7000-8000-000000000005",
  deviceId: "018f0000-0000-7000-8000-000000000006",
  locale: "bn-BD",
  timeZone: "Asia/Dhaka",
  businessDate: "2026-07-29",
  region: "test",
  permissions: new Set([
    "localization.pack.read",
    "localization.pack.activate",
    "localization.number.allocate",
  ]),
};

class FakeLocalizationStore {
  constructor() {
    this.calls = [];
  }

  async activateCountryPack(_context, command) {
    this.calls.push(["activate", command]);
    return { activationId: command.activationId, replayed: false };
  }

  async allocateLegalNumber(_context, command) {
    this.calls.push(["allocate", command]);
    return { allocationId: command.allocationId, legalNumber: "BD-0001", numericValue: "1", replayed: false };
  }

  async readEffectiveConfiguration(_context, onDate) {
    this.calls.push(["read", onDate]);
    return {
      activationId: "activation-1",
      packVersionId: "pack-version-1",
      packId: "country.bd",
      countryCode: "BD",
      packVersion: "1.0.0",
      supportLevel: "limited",
      defaultLocale: "bn-BD",
      effectiveFrom: "2026-01-01",
      capabilities: {},
      currencies: [],
      businessDayBoundaries: [],
    };
  }
}

test("localization service enforces permissions, legal-entity scope and offline device context", async () => {
  const store = new FakeLocalizationStore();
  const service = new LocalizationService(store);
  const activation = await service.activateCountryPack(context, {
    activationId: "activation-1",
    packVersionId: "pack-version-1",
    effectiveFrom: "2026-08-01",
    reason: "Approved country rollout",
    idempotencyKey: "activation-key-001",
    requestHash: "hash-activation-001",
  });
  assert.equal(activation.activationId, "activation-1");

  const allocation = await service.allocateLegalNumber(context, {
    allocationId: "allocation-1",
    scopeId: "scope-1",
    operationId: "operation-1",
    allocationMode: "offline_block",
  });
  assert.equal(allocation.legalNumber, "BD-0001");
  assert.equal(store.calls[1][1].deviceId, context.deviceId);

  const configuration = await service.readEffectiveConfiguration(context);
  assert.equal(configuration.packId, "country.bd");
  assert.deepEqual(store.calls[2], ["read", context.businessDate]);

  await assert.rejects(
    () => service.readEffectiveConfiguration({ ...context, permissions: new Set() }),
    (error) => error instanceof PlatformError && error.code === "PERMISSION_DENIED",
  );
  await assert.rejects(
    () => service.activateCountryPack({ ...context, legalEntityId: undefined }, {
      activationId: "activation-2",
      packVersionId: "pack-version-1",
      effectiveFrom: "2026-08-01",
      reason: "Missing scope",
      idempotencyKey: "activation-key-002",
      requestHash: "hash-activation-002",
    }),
    (error) => error instanceof PlatformError && error.code === "VALIDATION_FAILED",
  );
});

function database(rowsByOperation) {
  return {
    async withClientTransaction(_context, work) {
      return await work({
        async query(text, values) {
          if (text.includes("activate_country_pack")) return { rows: rowsByOperation.activate, rowCount: rowsByOperation.activate.length, values };
          if (text.includes("allocate_legal_number")) return { rows: rowsByOperation.allocate, rowCount: rowsByOperation.allocate.length, values };
          return { rows: rowsByOperation.configuration, rowCount: rowsByOperation.configuration.length, values };
        },
      });
    },
  };
}

test("Neon localization store maps command and effective configuration rows exactly", async () => {
  const store = new NeonLocalizationStore(database({
    activate: [{ activation_id: "activation-1", replayed: false }],
    allocate: [{ allocation_id: "allocation-1", legal_number: "BD-0001", numeric_value: "1", replayed: true }],
    configuration: [{
      activation_id: "activation-1",
      pack_version_id: "pack-version-1",
      pack_id: "country.bd",
      country_code: "BD",
      pack_version: "1.0.0",
      support_level: "limited",
      default_locale: "bn-BD",
      effective_from: "2026-01-01",
      effective_to: null,
      capabilities: { legalReceipts: true },
      currencies: [{
        currency: "BDT",
        accountingScale: 2,
        cashIncrementMinor: "100",
        cashRoundingMode: "nearest",
        metadataVersion: "bdt-2026-v1",
      }],
      boundaries: [{ timeZone: "Asia/Dhaka", localStartTime: "06:00:00", boundaryVersion: "bd-boundary-v1" }],
    }],
  }));

  assert.deepEqual(await store.activateCountryPack(context, {
    activationId: "activation-1",
    packVersionId: "pack-version-1",
    effectiveFrom: "2026-08-01",
    reason: "Approved",
    idempotencyKey: "activation-key-001",
    requestHash: "hash-activation-001",
  }), { activationId: "activation-1", replayed: false });

  assert.deepEqual(await store.allocateLegalNumber(context, {
    allocationId: "allocation-1",
    scopeId: "scope-1",
    operationId: "operation-1",
    allocationMode: "online",
  }), { allocationId: "allocation-1", legalNumber: "BD-0001", numericValue: "1", replayed: true });

  const result = await store.readEffectiveConfiguration(context, "2026-07-29");
  assert.equal(result.defaultLocale, "bn-BD");
  assert.equal(result.currencies[0].cashIncrementMinor, "100");
  assert.equal(result.businessDayBoundaries[0].timeZone, "Asia/Dhaka");
});
