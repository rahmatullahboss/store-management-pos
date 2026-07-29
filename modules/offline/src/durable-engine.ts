import type {
  AppendOfflineOperationResult,
  OfflineOperationInput,
  OfflineOperationOutcome,
  OfflineOperationRecord,
} from "./domain.js";

export interface OfflineStoreSnapshot {
  readonly operations: readonly OfflineOperationRecord[];
  readonly uploadCursor: bigint;
  readonly downloadCursor: string | null;
  readonly projectionVersion: string;
  readonly appVersion: string;
}

export interface MutableOfflineStore {
  find(deviceId: string, operationId: string): OfflineOperationRecord | undefined;
  list(): readonly OfflineOperationRecord[];
  append(record: OfflineOperationRecord): void;
  replace(record: OfflineOperationRecord): void;
  uploadCursor(): bigint;
  setUploadCursor(sequence: bigint): void;
  setDownloadCursor(cursor: string | null): void;
  setProjectionVersion(version: string): void;
  setAppVersion(version: string): void;
}

export interface OfflineDurableStore {
  transaction<T>(work: (store: MutableOfflineStore) => T | Promise<T>): Promise<T>;
  snapshot(): Promise<OfflineStoreSnapshot>;
}

interface MutableState {
  operations: Map<string, OfflineOperationRecord>;
  uploadCursor: bigint;
  downloadCursor: string | null;
  projectionVersion: string;
  appVersion: string;
}

function operationKey(deviceId: string, operationId: string): string {
  return `${deviceId}:${operationId}`;
}

function required(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`${field} is required`);
}

function sameInput(record: OfflineOperationRecord, input: OfflineOperationInput): boolean {
  return record.operationId === input.operationId
    && record.deviceId === input.deviceId
    && record.registerId === input.registerId
    && record.kind === input.kind
    && record.payloadVersion === input.payloadVersion
    && record.requestHash === input.requestHash
    && record.occurredAt === input.occurredAt
    && record.authorizationExpiresAt === input.authorizationExpiresAt;
}

function sameOutcome(record: OfflineOperationRecord, outcome: OfflineOperationOutcome): boolean {
  return record.state === outcome.state
    && record.serverReference === outcome.serverReference
    && record.rejectionReason === outcome.rejectionReason;
}

function cloneState(state: MutableState): MutableState {
  return {
    operations: new Map(state.operations),
    uploadCursor: state.uploadCursor,
    downloadCursor: state.downloadCursor,
    projectionVersion: state.projectionVersion,
    appVersion: state.appVersion,
  };
}

function orderedOperations(state: MutableState): readonly OfflineOperationRecord[] {
  return Object.freeze([...state.operations.values()].sort((left, right) => {
    if (left.sequence === right.sequence) return operationKey(left.deviceId, left.operationId).localeCompare(operationKey(right.deviceId, right.operationId));
    return left.sequence < right.sequence ? -1 : 1;
  }));
}

/**
 * Transactional reference adapter used by tests and non-browser shells. Browser
 * production adapters implement the same contract on IndexedDB/SQLite.
 */
export class MemoryOfflineDurableStore implements OfflineDurableStore {
  #state: MutableState;
  #tail: Promise<void> = Promise.resolve();

  constructor(initial?: Partial<OfflineStoreSnapshot>) {
    const operations = new Map<string, OfflineOperationRecord>();
    for (const record of initial?.operations ?? []) operations.set(operationKey(record.deviceId, record.operationId), record);
    this.#state = {
      operations,
      uploadCursor: initial?.uploadCursor ?? 0n,
      downloadCursor: initial?.downloadCursor ?? null,
      projectionVersion: initial?.projectionVersion ?? "1",
      appVersion: initial?.appVersion ?? "0.0.0",
    };
  }

  async transaction<T>(work: (store: MutableOfflineStore) => T | Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const prior = this.#tail;
    this.#tail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    const draft = cloneState(this.#state);
    const mutable: MutableOfflineStore = {
      find: (deviceId, operationId) => draft.operations.get(operationKey(deviceId, operationId)),
      list: () => orderedOperations(draft),
      append: (record) => {
        const key = operationKey(record.deviceId, record.operationId);
        if (draft.operations.has(key)) throw new TypeError(`Offline operation ${key} already exists`);
        draft.operations.set(key, record);
      },
      replace: (record) => {
        const key = operationKey(record.deviceId, record.operationId);
        if (!draft.operations.has(key)) throw new TypeError(`Offline operation ${key} does not exist`);
        draft.operations.set(key, record);
      },
      uploadCursor: () => draft.uploadCursor,
      setUploadCursor: (sequence) => { draft.uploadCursor = sequence; },
      setDownloadCursor: (cursor) => { draft.downloadCursor = cursor; },
      setProjectionVersion: (version) => { draft.projectionVersion = version; },
      setAppVersion: (version) => { draft.appVersion = version; },
    };

    try {
      const result = await work(mutable);
      this.#state = draft;
      return result;
    } finally {
      release?.();
    }
  }

  async snapshot(): Promise<OfflineStoreSnapshot> {
    await this.#tail;
    return Object.freeze({
      operations: orderedOperations(this.#state),
      uploadCursor: this.#state.uploadCursor,
      downloadCursor: this.#state.downloadCursor,
      projectionVersion: this.#state.projectionVersion,
      appVersion: this.#state.appVersion,
    });
  }
}

export class DurableOfflineEngine {
  constructor(readonly store: OfflineDurableStore) {}

  async commit(input: OfflineOperationInput, committedAt: string): Promise<AppendOfflineOperationResult> {
    required(input.deviceId, "deviceId");
    required(input.operationId, "operationId");
    required(input.registerId, "registerId");
    required(input.payloadVersion, "payloadVersion");
    required(input.requestHash, "requestHash");
    required(input.occurredAt, "occurredAt");
    required(committedAt, "committedAt");

    return await this.store.transaction((transaction) => {
      const existing = transaction.find(input.deviceId, input.operationId);
      if (existing) {
        if (!sameInput(existing, input)) {
          throw new TypeError(`Offline operation ${operationKey(input.deviceId, input.operationId)} was replayed with different content`);
        }
        return Object.freeze({ record: existing, replayed: true });
      }

      const last = transaction.list().at(-1);
      const record: OfflineOperationRecord = Object.freeze({
        ...input,
        sequence: (last?.sequence ?? 0n) + 1n,
        state: "pending",
        committedAt,
      });
      transaction.append(record);
      return Object.freeze({ record, replayed: false });
    });
  }

  async recordOutcome(deviceId: string, operationId: string, outcome: OfflineOperationOutcome): Promise<OfflineOperationRecord> {
    return await this.store.transaction((transaction) => {
      const existing = transaction.find(deviceId, operationId);
      if (!existing) throw new TypeError(`Offline operation ${operationKey(deviceId, operationId)} does not exist`);
      if (existing.state !== "pending") {
        if (sameOutcome(existing, outcome)) return existing;
        throw new TypeError(`Offline operation ${operationKey(deviceId, operationId)} already has an immutable outcome`);
      }
      const updated: OfflineOperationRecord = Object.freeze({
        ...existing,
        state: outcome.state,
        ...(outcome.serverReference === undefined ? {} : { serverReference: outcome.serverReference }),
        ...(outcome.rejectionReason === undefined ? {} : { rejectionReason: outcome.rejectionReason }),
      });
      transaction.replace(updated);
      return updated;
    });
  }

  async pendingBatch(limit = 100): Promise<readonly OfflineOperationRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new RangeError("limit must be between 1 and 1000");
    const snapshot = await this.store.snapshot();
    return Object.freeze(snapshot.operations
      .filter((operation) => operation.state === "pending" && operation.sequence > snapshot.uploadCursor)
      .slice(0, limit));
  }

  async advanceUploadCursor(sequence: bigint): Promise<void> {
    if (sequence < 0n) throw new RangeError("upload cursor cannot be negative");
    await this.store.transaction((transaction) => {
      const currentCursor = transaction.uploadCursor();
      if (sequence < currentCursor) throw new RangeError("upload cursor cannot move backwards");
      const operations = transaction.list();
      const maxSequence = operations.at(-1)?.sequence ?? 0n;
      if (sequence > maxSequence) throw new RangeError("upload cursor cannot exceed the durable operation log");
      const pendingBeforeCursor = operations.find((operation) => (
        operation.sequence > currentCursor
        && operation.sequence <= sequence
        && operation.state === "pending"
      ));
      if (pendingBeforeCursor) {
        throw new RangeError(`upload cursor cannot skip pending operation ${operationKey(pendingBeforeCursor.deviceId, pendingBeforeCursor.operationId)}`);
      }
      transaction.setUploadCursor(sequence);
    });
  }

  async recordDownloadCursor(cursor: string | null): Promise<void> {
    if (cursor !== null) required(cursor, "downloadCursor");
    await this.store.transaction((transaction) => transaction.setDownloadCursor(cursor));
  }

  async rebuildProjection(projectionVersion: string): Promise<void> {
    required(projectionVersion, "projectionVersion");
    await this.store.transaction((transaction) => transaction.setProjectionVersion(projectionVersion));
  }

  async assertUpgradeSafe(appVersion: string, supportedPayloadVersions: ReadonlySet<string>): Promise<void> {
    required(appVersion, "appVersion");
    const snapshot = await this.store.snapshot();
    const incompatible = snapshot.operations.find((operation) => operation.state === "pending" && !supportedPayloadVersions.has(operation.payloadVersion));
    if (incompatible) {
      throw new TypeError(`Pending offline operation ${operationKey(incompatible.deviceId, incompatible.operationId)} uses unsupported payload version ${incompatible.payloadVersion}`);
    }
    await this.store.transaction((transaction) => transaction.setAppVersion(appVersion));
  }
}
