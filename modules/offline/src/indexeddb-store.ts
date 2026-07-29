import type {
  MutableOfflineStore,
  OfflineDurableStore,
  OfflineStoreSnapshot,
} from "./durable-engine.js";
import type { OfflineOperationRecord } from "./domain.js";

const OPERATION_STORE = "operation_log";
const META_STORE = "operation_log_meta";
const PROJECTION_STORE = "pos_local";
const DATABASE_VERSION = 1;

interface StoredOperation {
  readonly key: string;
  readonly operationId: string;
  readonly deviceId: string;
  readonly registerId: string;
  readonly kind: OfflineOperationRecord["kind"];
  readonly payloadVersion: string;
  readonly requestHash: string;
  readonly occurredAt: string;
  readonly authorizationExpiresAt?: string;
  readonly sequence: string;
  readonly state: OfflineOperationRecord["state"];
  readonly committedAt: string;
  readonly serverReference?: string;
  readonly rejectionReason?: string;
}

interface StoredMeta {
  readonly key: string;
  readonly value: string | null;
}

interface IndexedDbState {
  readonly operations: Map<string, OfflineOperationRecord>;
  uploadCursor: bigint;
  downloadCursor: string | null;
  projectionVersion: string;
  appVersion: string;
}

export interface IndexedDbOfflineStoreOptions {
  readonly databaseName: string;
  readonly factory?: IDBFactory;
  readonly initialProjectionVersion?: string;
  readonly initialAppVersion?: string;
}

export class ConcurrentLocalStoreMutationError extends Error {
  constructor() {
    super("The offline store changed in another browser context; reload before retrying");
    this.name = "ConcurrentLocalStoreMutationError";
  }
}

function required(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`${field} is required`);
}

function operationKey(deviceId: string, operationId: string): string {
  return `${deviceId}:${operationId}`;
}

function orderedOperations(state: IndexedDbState): readonly OfflineOperationRecord[] {
  return Object.freeze([...state.operations.values()].sort((left, right) => {
    if (left.sequence === right.sequence) {
      return operationKey(left.deviceId, left.operationId).localeCompare(
        operationKey(right.deviceId, right.operationId),
      );
    }
    return left.sequence < right.sequence ? -1 : 1;
  }));
}

function cloneState(state: IndexedDbState): IndexedDbState {
  return {
    operations: new Map(state.operations),
    uploadCursor: state.uploadCursor,
    downloadCursor: state.downloadCursor,
    projectionVersion: state.projectionVersion,
    appVersion: state.appVersion,
  };
}

export function serializeOfflineOperation(record: OfflineOperationRecord): StoredOperation {
  return Object.freeze({
    key: operationKey(record.deviceId, record.operationId),
    operationId: record.operationId,
    deviceId: record.deviceId,
    registerId: record.registerId,
    kind: record.kind,
    payloadVersion: record.payloadVersion,
    requestHash: record.requestHash,
    occurredAt: record.occurredAt,
    ...(record.authorizationExpiresAt === undefined
      ? {}
      : { authorizationExpiresAt: record.authorizationExpiresAt }),
    sequence: record.sequence.toString(),
    state: record.state,
    committedAt: record.committedAt,
    ...(record.serverReference === undefined ? {} : { serverReference: record.serverReference }),
    ...(record.rejectionReason === undefined ? {} : { rejectionReason: record.rejectionReason }),
  });
}

export function deserializeOfflineOperation(stored: StoredOperation): OfflineOperationRecord {
  required(stored.operationId, "operationId");
  required(stored.deviceId, "deviceId");
  required(stored.registerId, "registerId");
  required(stored.payloadVersion, "payloadVersion");
  required(stored.requestHash, "requestHash");
  required(stored.occurredAt, "occurredAt");
  required(stored.committedAt, "committedAt");
  const sequence = BigInt(stored.sequence);
  if (sequence <= 0n) throw new RangeError("Stored offline sequence must be positive");
  return Object.freeze({
    operationId: stored.operationId,
    deviceId: stored.deviceId,
    registerId: stored.registerId,
    kind: stored.kind,
    payloadVersion: stored.payloadVersion,
    requestHash: stored.requestHash,
    occurredAt: stored.occurredAt,
    ...(stored.authorizationExpiresAt === undefined
      ? {}
      : { authorizationExpiresAt: stored.authorizationExpiresAt }),
    sequence,
    state: stored.state,
    committedAt: stored.committedAt,
    ...(stored.serverReference === undefined ? {} : { serverReference: stored.serverReference }),
    ...(stored.rejectionReason === undefined ? {} : { rejectionReason: stored.rejectionReason }),
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed")), {
      once: true,
    });
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

function openDatabase(factory: IDBFactory, databaseName: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(databaseName, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OPERATION_STORE)) {
        const operations = database.createObjectStore(OPERATION_STORE, { keyPath: "key" });
        operations.createIndex("sequence", "sequence", { unique: true });
        operations.createIndex("state", "state", { unique: false });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(PROJECTION_STORE)) {
        const projections = database.createObjectStore(PROJECTION_STORE, { keyPath: "key" });
        projections.createIndex("projection", "projection", { unique: false });
        projections.createIndex("version", "version", { unique: false });
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB open failed")), {
      once: true,
    });
    request.addEventListener("blocked", () => reject(new Error("IndexedDB upgrade is blocked by another tab")), {
      once: true,
    });
  });
}

function metaValue(entries: ReadonlyMap<string, string | null>, key: string): string | null | undefined {
  return entries.get(key);
}

export class IndexedDbOfflineDurableStore implements OfflineDurableStore {
  readonly #databaseName: string;
  readonly #factory: IDBFactory;
  readonly #initialProjectionVersion: string;
  readonly #initialAppVersion: string;
  #database: Promise<IDBDatabase> | undefined;
  #state: IndexedDbState | undefined;
  #revision = 0n;
  #tail: Promise<void> = Promise.resolve();

  constructor(options: IndexedDbOfflineStoreOptions) {
    required(options.databaseName, "databaseName");
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new TypeError("IndexedDB is unavailable in this runtime");
    this.#databaseName = options.databaseName;
    this.#factory = factory;
    this.#initialProjectionVersion = options.initialProjectionVersion ?? "1";
    this.#initialAppVersion = options.initialAppVersion ?? "0.0.0";
  }

  async transaction<T>(work: (store: MutableOfflineStore) => T | Promise<T>): Promise<T> {
    let release: (() => void) | undefined;
    const prior = this.#tail;
    this.#tail = new Promise<void>((resolve) => { release = resolve; });
    await prior;

    try {
      const current = await this.#load();
      const draft = cloneState(current);
      const changedOperations = new Set<string>();
      let metadataChanged = false;
      const mutable: MutableOfflineStore = {
        find: (deviceId, operationId) => draft.operations.get(operationKey(deviceId, operationId)),
        list: () => orderedOperations(draft),
        append: (record) => {
          const key = operationKey(record.deviceId, record.operationId);
          if (draft.operations.has(key)) throw new TypeError(`Offline operation ${key} already exists`);
          draft.operations.set(key, record);
          changedOperations.add(key);
        },
        replace: (record) => {
          const key = operationKey(record.deviceId, record.operationId);
          if (!draft.operations.has(key)) throw new TypeError(`Offline operation ${key} does not exist`);
          draft.operations.set(key, record);
          changedOperations.add(key);
        },
        uploadCursor: () => draft.uploadCursor,
        setUploadCursor: (sequence) => {
          draft.uploadCursor = sequence;
          metadataChanged = true;
        },
        setDownloadCursor: (cursor) => {
          draft.downloadCursor = cursor;
          metadataChanged = true;
        },
        setProjectionVersion: (version) => {
          draft.projectionVersion = version;
          metadataChanged = true;
        },
        setAppVersion: (version) => {
          draft.appVersion = version;
          metadataChanged = true;
        },
      };

      const result = await work(mutable);
      if (changedOperations.size > 0 || metadataChanged) {
        await this.#persist(draft, changedOperations, this.#revision);
        this.#state = draft;
        this.#revision += 1n;
      }
      return result;
    } finally {
      release?.();
    }
  }

  async snapshot(): Promise<OfflineStoreSnapshot> {
    await this.#tail;
    const state = await this.#load();
    return Object.freeze({
      operations: orderedOperations(state),
      uploadCursor: state.uploadCursor,
      downloadCursor: state.downloadCursor,
      projectionVersion: state.projectionVersion,
      appVersion: state.appVersion,
    });
  }

  async refresh(): Promise<OfflineStoreSnapshot> {
    await this.#tail;
    this.#state = undefined;
    return await this.snapshot();
  }

  async close(): Promise<void> {
    await this.#tail;
    const database = await this.#database;
    database?.close();
    this.#database = undefined;
    this.#state = undefined;
  }

  async #connection(): Promise<IDBDatabase> {
    this.#database ??= openDatabase(this.#factory, this.#databaseName);
    return await this.#database;
  }

  async #load(): Promise<IndexedDbState> {
    if (this.#state) return this.#state;
    const database = await this.#connection();
    const transaction = database.transaction([OPERATION_STORE, META_STORE], "readonly");
    const operationsRequest = transaction.objectStore(OPERATION_STORE).getAll() as IDBRequest<StoredOperation[]>;
    const metadataRequest = transaction.objectStore(META_STORE).getAll() as IDBRequest<StoredMeta[]>;
    const [storedOperations, storedMetadata] = await Promise.all([
      requestResult(operationsRequest),
      requestResult(metadataRequest),
    ]);
    await transactionCompletion(transaction);

    const metadata = new Map(storedMetadata.map((entry) => [entry.key, entry.value]));
    const operations = new Map<string, OfflineOperationRecord>();
    for (const stored of storedOperations) {
      const record = deserializeOfflineOperation(stored);
      const key = operationKey(record.deviceId, record.operationId);
      if (stored.key !== key || operations.has(key)) {
        throw new TypeError(`Corrupt offline operation key ${stored.key}`);
      }
      operations.set(key, record);
    }

    this.#revision = BigInt(metaValue(metadata, "revision") ?? "0");
    this.#state = {
      operations,
      uploadCursor: BigInt(metaValue(metadata, "uploadCursor") ?? "0"),
      downloadCursor: metaValue(metadata, "downloadCursor") ?? null,
      projectionVersion: metaValue(metadata, "projectionVersion") ?? this.#initialProjectionVersion,
      appVersion: metaValue(metadata, "appVersion") ?? this.#initialAppVersion,
    };
    return this.#state;
  }

  async #persist(
    state: IndexedDbState,
    changedOperations: ReadonlySet<string>,
    expectedRevision: bigint,
  ): Promise<void> {
    const database = await this.#connection();
    const transaction = database.transaction([OPERATION_STORE, META_STORE], "readwrite", {
      durability: "strict",
    });
    const completion = transactionCompletion(transaction);
    const operations = transaction.objectStore(OPERATION_STORE);
    const metadata = transaction.objectStore(META_STORE);
    const storedRevision = await requestResult(
      metadata.get("revision") as IDBRequest<StoredMeta | undefined>,
    );
    const actualRevision = BigInt(storedRevision?.value ?? "0");
    if (actualRevision !== expectedRevision) {
      transaction.abort();
      await completion.catch(() => undefined);
      this.#state = undefined;
      throw new ConcurrentLocalStoreMutationError();
    }

    for (const key of changedOperations) {
      const record = state.operations.get(key);
      if (!record) {
        transaction.abort();
        await completion.catch(() => undefined);
        throw new TypeError(`Changed offline operation ${key} is missing`);
      }
      operations.put(serializeOfflineOperation(record));
    }

    const nextRevision = expectedRevision + 1n;
    const entries: readonly StoredMeta[] = [
      { key: "revision", value: nextRevision.toString() },
      { key: "uploadCursor", value: state.uploadCursor.toString() },
      { key: "downloadCursor", value: state.downloadCursor },
      { key: "projectionVersion", value: state.projectionVersion },
      { key: "appVersion", value: state.appVersion },
    ];
    for (const entry of entries) metadata.put(entry);
    await completion;
  }
}
