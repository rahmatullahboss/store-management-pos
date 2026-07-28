import type { ConsumerInbox } from "../../foundation/src/events.js";
import type { IdempotencyRecord, IdempotencyStore } from "../../foundation/src/idempotency.js";

export class InMemoryIdempotencyStore<Result> implements IdempotencyStore<Result> {
  private readonly records = new Map<string, IdempotencyRecord<Result>>();
  private key(tenantId: string, scope: string, key: string): string { return `${tenantId}:${scope}:${key}`; }
  async get(tenantId: string, scope: string, key: string): Promise<IdempotencyRecord<Result> | null> { return this.records.get(this.key(tenantId, scope, key)) ?? null; }
  async claim(record: IdempotencyRecord<Result>): Promise<boolean> {
    const key = this.key(record.tenantId, record.scope, record.key);
    if (this.records.has(key)) return false;
    this.records.set(key, record);
    return true;
  }
  async complete(tenantId: string, scope: string, key: string, result: Result): Promise<void> {
    const mapKey = this.key(tenantId, scope, key);
    const current = this.records.get(mapKey);
    if (!current) throw new Error("Missing idempotency record");
    this.records.set(mapKey, { ...current, status: "completed", result });
  }
  async fail(tenantId: string, scope: string, key: string): Promise<void> {
    const mapKey = this.key(tenantId, scope, key);
    const current = this.records.get(mapKey);
    if (current) this.records.set(mapKey, { ...current, status: "failed" });
  }
}

export class InMemoryConsumerInbox implements ConsumerInbox {
  private readonly records = new Map<string, { hash: string; status: "processing" | "completed" | "failed" }>();
  async claim(consumer: string, eventId: string, payloadHash: string): Promise<boolean> {
    const key = `${consumer}:${eventId}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.hash !== payloadHash) throw new Error("Inbox payload hash conflict");
      return false;
    }
    this.records.set(key, { hash: payloadHash, status: "processing" });
    return true;
  }
  async complete(consumer: string, eventId: string): Promise<void> {
    const key = `${consumer}:${eventId}`;
    const current = this.records.get(key);
    if (!current) throw new Error("Missing inbox record");
    this.records.set(key, { ...current, status: "completed" });
  }
  async fail(consumer: string, eventId: string): Promise<void> {
    const key = `${consumer}:${eventId}`;
    const current = this.records.get(key);
    if (current) this.records.set(key, { ...current, status: "failed" });
  }
}
