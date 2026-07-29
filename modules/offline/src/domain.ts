export type OfflineOperationKind = "sale" | "refund" | "cash_event" | "shift_close" | "device_health";

export type OfflineOperationState = "pending" | "accepted" | "rejected" | "review_required";

export interface OfflineOperationInput {
  readonly operationId: string;
  readonly deviceId: string;
  readonly registerId: string;
  readonly kind: OfflineOperationKind;
  readonly payloadVersion: string;
  readonly requestHash: string;
  readonly occurredAt: string;
  readonly authorizationExpiresAt?: string;
}

export interface OfflineOperationRecord extends OfflineOperationInput {
  readonly sequence: bigint;
  readonly state: OfflineOperationState;
  readonly committedAt: string;
  readonly serverReference?: string;
  readonly rejectionReason?: string;
}

export interface OfflineOperationOutcome {
  readonly state: Exclude<OfflineOperationState, "pending">;
  readonly serverReference?: string;
  readonly rejectionReason?: string;
}

export interface AppendOfflineOperationResult {
  readonly record: OfflineOperationRecord;
  readonly replayed: boolean;
}

function assertRequired(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`${field} is required`);
}

function operationKey(input: Pick<OfflineOperationInput, "deviceId" | "operationId">): string {
  return `${input.deviceId}:${input.operationId}`;
}

function sameInput(left: OfflineOperationRecord, right: OfflineOperationInput): boolean {
  return left.operationId === right.operationId
    && left.deviceId === right.deviceId
    && left.registerId === right.registerId
    && left.kind === right.kind
    && left.payloadVersion === right.payloadVersion
    && left.requestHash === right.requestHash
    && left.occurredAt === right.occurredAt
    && left.authorizationExpiresAt === right.authorizationExpiresAt;
}

function sameOutcome(record: OfflineOperationRecord, outcome: OfflineOperationOutcome): boolean {
  return record.state === outcome.state
    && record.serverReference === outcome.serverReference
    && record.rejectionReason === outcome.rejectionReason;
}

export class OfflineOperationLog {
  readonly #byId = new Map<string, OfflineOperationRecord>();
  readonly #ordered: OfflineOperationRecord[] = [];

  append(input: OfflineOperationInput, committedAt: string): AppendOfflineOperationResult {
    assertRequired(input.operationId, "operationId");
    assertRequired(input.deviceId, "deviceId");
    assertRequired(input.registerId, "registerId");
    assertRequired(input.payloadVersion, "payloadVersion");
    assertRequired(input.requestHash, "requestHash");
    assertRequired(input.occurredAt, "occurredAt");
    assertRequired(committedAt, "committedAt");

    const key = operationKey(input);
    const existing = this.#byId.get(key);
    if (existing) {
      if (!sameInput(existing, input)) {
        throw new TypeError(`Offline operation ${key} was replayed with different content`);
      }
      return Object.freeze({ record: existing, replayed: true });
    }

    const record: OfflineOperationRecord = Object.freeze({
      ...input,
      sequence: BigInt(this.#ordered.length + 1),
      state: "pending",
      committedAt,
    });
    this.#byId.set(key, record);
    this.#ordered.push(record);
    return Object.freeze({ record, replayed: false });
  }

  recordDeviceOutcome(deviceId: string, operationId: string, outcome: OfflineOperationOutcome): OfflineOperationRecord {
    assertRequired(deviceId, "deviceId");
    assertRequired(operationId, "operationId");
    const key = operationKey({ deviceId, operationId });
    const existing = this.#byId.get(key);
    if (!existing) throw new TypeError(`Offline operation ${key} does not exist`);
    return this.#recordOutcome(existing, key, outcome);
  }

  recordOutcome(operationId: string, outcome: OfflineOperationOutcome): OfflineOperationRecord {
    assertRequired(operationId, "operationId");
    const matches = this.#ordered.filter((record) => record.operationId === operationId);
    if (matches.length === 0) throw new TypeError(`Offline operation ${operationId} does not exist`);
    if (matches.length > 1) {
      throw new TypeError(`Offline operation ${operationId} is ambiguous across devices; use recordDeviceOutcome`);
    }
    const existing = matches[0];
    if (!existing) throw new TypeError(`Offline operation ${operationId} does not exist`);
    return this.#recordOutcome(existing, operationKey(existing), outcome);
  }

  #recordOutcome(existing: OfflineOperationRecord, key: string, outcome: OfflineOperationOutcome): OfflineOperationRecord {
    if (existing.state !== "pending") {
      if (sameOutcome(existing, outcome)) return existing;
      throw new TypeError(`Offline operation ${key} already has an immutable outcome`);
    }

    const updated: OfflineOperationRecord = Object.freeze({
      ...existing,
      state: outcome.state,
      ...(outcome.serverReference === undefined ? {} : { serverReference: outcome.serverReference }),
      ...(outcome.rejectionReason === undefined ? {} : { rejectionReason: outcome.rejectionReason }),
    });
    const index = this.#ordered.findIndex((record) => operationKey(record) === key);
    if (index < 0) throw new TypeError(`Offline operation ${key} is missing from the ordered log`);
    this.#ordered[index] = updated;
    this.#byId.set(key, updated);
    return updated;
  }

  uploadBatch(afterSequence = 0n, limit = 100): readonly OfflineOperationRecord[] {
    if (afterSequence < 0n) throw new RangeError("afterSequence cannot be negative");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError("limit must be between 1 and 1000");
    return Object.freeze(this.#ordered
      .filter((record) => record.state === "pending" && record.sequence > afterSequence)
      .slice(0, limit));
  }

  pendingCount(): number {
    return this.#ordered.reduce((count, record) => count + (record.state === "pending" ? 1 : 0), 0);
  }

  snapshot(): readonly OfflineOperationRecord[] {
    return Object.freeze([...this.#ordered]);
  }
}
