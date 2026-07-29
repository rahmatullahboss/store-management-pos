import test from "node:test";
import assert from "node:assert/strict";
import { HardwareAgentRuntime } from "../../build/apps/hardware-agent/src/runtime.js";

const fixedClock = () => new Date("2026-07-29T08:30:00.000Z");

function profile(overrides = {}) {
  return {
    schemaVersion: "1.0",
    profileId: "profile-1",
    tenantId: "tenant-1",
    storeId: "store-1",
    registerId: "register-1",
    deviceId: "device-1",
    agentVersion: "1.0.0",
    capabilities: ["receipt_printer"],
    capabilityVersions: { receipt_printer: "1.0" },
    enrolledAt: "2026-07-29T08:00:00.000Z",
    ...overrides,
  };
}

function command(overrides = {}) {
  return {
    schemaVersion: "1.0",
    context: {
      tenantId: "tenant-1",
      storeId: "store-1",
      registerId: "register-1",
      actorId: "user-1",
      deviceId: "device-1",
      locale: "en-BD",
      timeZone: "Asia/Dhaka",
      businessDate: "2026-07-29",
    },
    commandId: "command-1",
    deviceId: "device-1",
    capability: "receipt_printer",
    action: "print",
    payload: { receiptId: "receipt-1" },
    requestedAt: "2026-07-29T08:20:00.000Z",
    expiresAt: "2026-07-29T08:40:00.000Z",
    idempotencyKey: "hardware-command-1",
    ...overrides,
  };
}

test("MOD-D hardware commands execute once across concurrent idempotent replay", async () => {
  let executions = 0;
  const adapter = {
    capability: "receipt_printer",
    actions: ["print"],
    async execute(input) {
      executions += 1;
      return { printJobId: `job-${input.commandId}` };
    },
  };
  const runtime = new HardwareAgentRuntime(profile(), [adapter], fixedClock);

  const first = runtime.execute(command());
  const replay = runtime.execute(command());
  assert.equal(first, replay);

  const [firstResult, replayResult] = await Promise.all([first, replay]);
  assert.equal(executions, 1);
  assert.equal(firstResult, replayResult);
  assert.equal(firstResult.status, "succeeded");
  assert.deepEqual(firstResult.output, { printJobId: "job-command-1" });
});

test("MOD-D hardware idempotency rejects changed command content", async () => {
  const runtime = new HardwareAgentRuntime(profile(), [{
    capability: "receipt_printer",
    actions: ["print"],
    async execute() { return { accepted: true }; },
  }], fixedClock);

  await runtime.execute(command());
  assert.throws(
    () => runtime.execute(command({ payload: { receiptId: "receipt-2" } })),
    /replayed with different content/i,
  );
});

test("MOD-D hardware agent rejects scope mismatch and sensitive card payloads before adapter execution", () => {
  let executions = 0;
  const runtime = new HardwareAgentRuntime(profile(), [{
    capability: "receipt_printer",
    actions: ["print"],
    async execute() {
      executions += 1;
      return {};
    },
  }], fixedClock);

  assert.throws(
    () => runtime.execute(command({ context: { ...command().context, storeId: "other-store" } })),
    /store scope/i,
  );
  assert.throws(
    () => runtime.execute(command({ payload: { card_number: "4111111111111111" } })),
    /prohibited from local hardware commands/i,
  );
  assert.equal(executions, 0);
});

test("MOD-D hardware agent blocks expired, revoked and unsupported commands", async () => {
  const adapter = {
    capability: "receipt_printer",
    actions: ["print"],
    async execute() { return {}; },
  };

  const expired = await new HardwareAgentRuntime(profile(), [adapter], fixedClock)
    .execute(command({ expiresAt: "2026-07-29T08:25:00.000Z" }));
  assert.equal(expired.status, "timed_out");

  const revoked = await new HardwareAgentRuntime(
    profile({ revokedAt: "2026-07-29T08:10:00.000Z" }),
    [adapter],
    fixedClock,
  ).execute(command({ idempotencyKey: "revoked-command" }));
  assert.equal(revoked.status, "revoked");

  const unsupported = await new HardwareAgentRuntime(profile({ capabilities: [] }), [adapter], fixedClock)
    .execute(command({ idempotencyKey: "unsupported-command" }));
  assert.equal(unsupported.status, "unsupported");
});
