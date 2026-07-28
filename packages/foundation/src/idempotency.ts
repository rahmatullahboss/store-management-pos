import { PlatformError } from "./errors.js";

export interface IdempotencyRecord<Result> {
  readonly tenantId: string;
  readonly scope: string;
  readonly key: string;
  readonly requestHash: string;
  readonly status: "processing" | "completed" | "failed";
  readonly result?: Result;
}

export interface IdempotencyStore<Result> {
  get(tenantId: string, scope: string, key: string): Promise<IdempotencyRecord<Result> | null>;
  claim(record: IdempotencyRecord<Result>): Promise<boolean>;
  complete(tenantId: string, scope: string, key: string, result: Result): Promise<void>;
  fail(tenantId: string, scope: string, key: string): Promise<void>;
}

export async function executeIdempotently<Result>(
  store: IdempotencyStore<Result>,
  input: { tenantId: string; scope: string; key: string; requestHash: string },
  work: () => Promise<Result>,
): Promise<Result> {
  const existing = await store.get(input.tenantId, input.scope, input.key);
  if (existing) {
    if (existing.requestHash !== input.requestHash) throw new PlatformError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different request", 409);
    if (existing.status === "completed" && existing.result !== undefined) return existing.result;
    throw new PlatformError("CONFLICT", "The idempotent request is already processing", 409);
  }
  const claimed = await store.claim({ ...input, status: "processing" });
  if (!claimed) return await executeIdempotently(store, input, work);
  try {
    const result = await work();
    await store.complete(input.tenantId, input.scope, input.key, result);
    return result;
  } catch (error) {
    await store.fail(input.tenantId, input.scope, input.key);
    throw error;
  }
}
