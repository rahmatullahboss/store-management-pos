import assert from "node:assert/strict";
import test from "node:test";

import {
  deliverStorefrontOperationalEventV1,
  parseStorefrontOperationalSinkReceiptV1,
} from "../../build/modules/storefront/src/operational-sink-bridge.js";

function event(overrides = {}) {
  return {
    eventVersion: "storefront-operational-event.v1",
    eventName: "storefront.abuse_control.decision",
    occurredAt: "2026-08-02T01:00:00.000Z",
    severity: "warn",
    outcome: "denied",
    reason: "rate_limited",
    requestId: "request-018f0000",
    traceId: "trace-018f0000",
    tenantId: "tenant-1",
    storefrontId: "storefront-1",
    salesChannelId: "channel-1",
    cacheFamily: null,
    abusePolicyClass: "public_search",
    domainPhase: null,
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    receiptVersion: "storefront-operational-sink-receipt.v1",
    state: "accepted",
    reason: "accepted",
    sinkRevision: "shared-telemetry:v2",
    ...overrides,
  };
}

test("operational sink receives only the validated privacy-safe event envelope", async () => {
  const seen = [];
  const result = await deliverStorefrontOperationalEventV1({
    sink: {
      async emit(value) {
        seen.push(value);
        return receipt();
      },
    },
    event: event(),
  });

  assert.deepEqual(result, receipt());
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], event());
  assert.equal(Object.isFrozen(seen[0]), true);
});

test("sensitive or free-form event fields are rejected before sink invocation", async () => {
  for (const [key, value] of [
    ["customerId", "018f0000-0000-4000-8000-000000000999"],
    ["requestHostname", "private.example.com"],
    ["rawIp", "203.0.113.10"],
    ["abuseKey", "edge_secret_key_material"],
    ["providerHostnameId", "provider-secret"],
    ["paymentIntentId", "pi_secret"],
    ["metadata", { anything: "free-form" }],
  ]) {
    let calls = 0;
    await assert.rejects(
      () => deliverStorefrontOperationalEventV1({
        sink: {
          async emit() {
            calls += 1;
            return receipt();
          },
        },
        event: event({ [key]: value }),
      }),
      new RegExp(`unsupported fields: ${key}`, "u"),
    );
    assert.equal(calls, 0, key);
  }
});

test("sink transport failure becomes bounded unavailable state without leaking exception detail", async () => {
  const result = await deliverStorefrontOperationalEventV1({
    sink: {
      async emit() {
        throw new Error("authorization token=secret-provider-value");
      },
    },
    event: event(),
  });

  assert.deepEqual(result, {
    receiptVersion: "storefront-operational-sink-receipt.v1",
    state: "unavailable",
    reason: "sink_unavailable",
    sinkRevision: null,
  });
  assert.equal(JSON.stringify(result).includes("secret-provider-value"), false);
});

test("invalid sink receipts become configuration_error without forwarding sink-internal fields", async () => {
  const result = await deliverStorefrontOperationalEventV1({
    sink: {
      async emit() {
        return {
          ...receipt(),
          providerToken: "sink-secret-token",
        };
      },
    },
    event: event(),
  });

  assert.deepEqual(result, {
    receiptVersion: "storefront-operational-sink-receipt.v1",
    state: "unavailable",
    reason: "configuration_error",
    sinkRevision: null,
  });
  assert.equal(JSON.stringify(result).includes("sink-secret-token"), false);
});

test("receipt parser enforces bounded versioned sink semantics", () => {
  assert.deepEqual(parseStorefrontOperationalSinkReceiptV1(receipt()), receipt());
  assert.throws(
    () => parseStorefrontOperationalSinkReceiptV1(receipt({ sinkRevision: null })),
    /require a sink revision/u,
  );
  assert.throws(
    () => parseStorefrontOperationalSinkReceiptV1(receipt({
      state: "unavailable",
      reason: "accepted",
      sinkRevision: null,
    })),
    /unavailable reason/u,
  );
  assert.throws(
    () => parseStorefrontOperationalSinkReceiptV1({ ...receipt(), rawException: "secret" }),
    /unsupported fields: rawException/u,
  );
});
