import type {
  HardwareCapability,
  HardwareCommandResultV1,
  HardwareCommandV1,
  HardwareProfileV1,
} from "../../../modules/pos/src/hardware-contracts.js";

export interface HardwareAdapterCommand {
  readonly commandId: string;
  readonly action: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface HardwareAdapter {
  readonly capability: HardwareCapability;
  readonly actions: readonly string[];
  execute(command: HardwareAdapterCommand): Promise<Readonly<Record<string, unknown>>>;
}

export type HardwareAgentClock = () => Date;

interface CachedExecution {
  readonly fingerprint: string;
  readonly result: Promise<HardwareCommandResultV1>;
}

const SENSITIVE_KEY = /(?:^|_)(?:pan|cvv|cvc|pin|track(?:_?data)?|card(?:_?number)?|provider(?:_?secret)?|api(?:_?key)?|secret(?:_?key)?)(?:$|_)/iu;

function assertRequired(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`${field} is required`);
}

function assertValidInstant(value: string, field: string): number {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new TypeError(`${field} must be an ISO-8601 instant`);
  return instant;
}

function assertNoSensitiveValue(value: unknown, path = "payload", seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new TypeError(`${path} must not contain cyclic values`);
  seen.add(value);

  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) assertNoSensitiveValue(entry, `${path}[${index}]`, seen);
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new TypeError(`${path}.${key} is prohibited from local hardware commands`);
    assertNoSensitiveValue(entry, `${path}.${key}`, seen);
  }
}

function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (seen.has(value)) throw new TypeError("Hardware command must not contain cyclic values");
  seen.add(value);

  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry, seen)).join(",")}]`;

  const fields = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry, seen)}`);
  return `{${fields.join(",")}}`;
}

function errorResult(
  command: HardwareCommandV1,
  status: Exclude<HardwareCommandResultV1["status"], "succeeded">,
  startedAt: string,
  completedAt: string,
  errorCode: string,
  errorMessage: string,
): HardwareCommandResultV1 {
  return Object.freeze({
    commandId: command.commandId,
    deviceId: command.deviceId,
    capability: command.capability,
    status,
    errorCode,
    errorMessage,
    startedAt,
    completedAt,
  });
}

export class HardwareAgentRuntime {
  readonly profile: HardwareProfileV1;
  readonly #clock: HardwareAgentClock;
  readonly #adapters = new Map<HardwareCapability, HardwareAdapter>();
  readonly #executions = new Map<string, CachedExecution>();

  constructor(profile: HardwareProfileV1, adapters: readonly HardwareAdapter[], clock: HardwareAgentClock = () => new Date()) {
    this.profile = Object.freeze({ ...profile, capabilities: Object.freeze([...profile.capabilities]) });
    this.#clock = clock;

    for (const adapter of adapters) {
      if (this.#adapters.has(adapter.capability)) throw new TypeError(`Duplicate hardware adapter for ${adapter.capability}`);
      if (new Set(adapter.actions).size !== adapter.actions.length) throw new TypeError(`${adapter.capability} contains duplicate actions`);
      this.#adapters.set(adapter.capability, adapter);
    }
  }

  execute(command: HardwareCommandV1): Promise<HardwareCommandResultV1> {
    this.#assertEnvelope(command);
    assertNoSensitiveValue(command.payload);

    const fingerprint = stableSerialize(command);
    const cached = this.#executions.get(command.idempotencyKey);
    if (cached) {
      if (cached.fingerprint !== fingerprint) throw new TypeError(`Hardware idempotency key ${command.idempotencyKey} was replayed with different content`);
      return cached.result;
    }

    const result = this.#executeFresh(command);
    this.#executions.set(command.idempotencyKey, Object.freeze({ fingerprint, result }));
    return result;
  }

  #assertEnvelope(command: HardwareCommandV1): void {
    if (command.schemaVersion !== "1.0") throw new TypeError("Unsupported hardware command schema version");
    assertRequired(command.commandId, "commandId");
    assertRequired(command.deviceId, "deviceId");
    assertRequired(command.action, "action");
    assertRequired(command.idempotencyKey, "idempotencyKey");

    const requestedAt = assertValidInstant(command.requestedAt, "requestedAt");
    const expiresAt = assertValidInstant(command.expiresAt, "expiresAt");
    if (expiresAt <= requestedAt) throw new TypeError("expiresAt must be after requestedAt");

    if (command.context.tenantId !== this.profile.tenantId) throw new TypeError("Hardware command tenant scope does not match the enrolled profile");
    if (command.context.storeId !== this.profile.storeId) throw new TypeError("Hardware command store scope does not match the enrolled profile");
    if (command.context.registerId !== this.profile.registerId) throw new TypeError("Hardware command register scope does not match the enrolled profile");
    if (command.deviceId !== this.profile.deviceId) throw new TypeError("Hardware command device does not match the enrolled profile");
    if (command.context.deviceId !== undefined && command.context.deviceId !== this.profile.deviceId) {
      throw new TypeError("Hardware command context device does not match the enrolled profile");
    }
  }

  async #executeFresh(command: HardwareCommandV1): Promise<HardwareCommandResultV1> {
    const startedAt = this.#clock().toISOString();
    const now = Date.parse(startedAt);

    if (this.profile.revokedAt !== undefined && Date.parse(this.profile.revokedAt) <= now) {
      return errorResult(command, "revoked", startedAt, this.#clock().toISOString(), "DEVICE_REVOKED", "The enrolled hardware profile is revoked");
    }
    if (Date.parse(command.expiresAt) <= now) {
      return errorResult(command, "timed_out", startedAt, this.#clock().toISOString(), "COMMAND_EXPIRED", "The hardware command expired before execution");
    }
    if (!this.profile.capabilities.includes(command.capability)) {
      return errorResult(command, "unsupported", startedAt, this.#clock().toISOString(), "CAPABILITY_NOT_ENROLLED", "The device profile does not permit this capability");
    }

    const adapter = this.#adapters.get(command.capability);
    if (!adapter || !adapter.actions.includes(command.action)) {
      return errorResult(command, "unsupported", startedAt, this.#clock().toISOString(), "ACTION_UNSUPPORTED", "No enrolled adapter supports this hardware action");
    }

    try {
      const output = await adapter.execute(Object.freeze({
        commandId: command.commandId,
        action: command.action,
        payload: command.payload,
      }));
      assertNoSensitiveValue(output, "output");
      return Object.freeze({
        commandId: command.commandId,
        deviceId: command.deviceId,
        capability: command.capability,
        status: "succeeded",
        output: Object.freeze({ ...output }),
        startedAt,
        completedAt: this.#clock().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Hardware adapter failed";
      return errorResult(command, "failed", startedAt, this.#clock().toISOString(), "HARDWARE_ADAPTER_FAILED", message);
    }
  }
}
