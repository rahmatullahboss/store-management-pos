import type { BusinessDate } from "./localization.js";

export interface DomainEventEnvelope<Payload = unknown> {
  readonly schemaVersion: "1.0";
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly tenantId: string;
  readonly occurredAt: string;
  readonly businessDate: BusinessDate;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly actorId?: string;
  readonly payload: Payload;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface OutboxRecord<Payload = unknown> {
  readonly id: string;
  readonly event: DomainEventEnvelope<Payload>;
  readonly publishedAt?: string;
  readonly attempts: number;
}

export interface ConsumerInbox {
  claim(consumer: string, eventId: string, payloadHash: string): Promise<boolean>;
  complete(consumer: string, eventId: string): Promise<void>;
  fail(consumer: string, eventId: string, errorCode: string): Promise<void>;
}

export async function consumeAtLeastOnce(
  inbox: ConsumerInbox,
  input: { consumer: string; eventId: string; payloadHash: string },
  handler: () => Promise<void>,
): Promise<"processed" | "duplicate"> {
  const claimed = await inbox.claim(input.consumer, input.eventId, input.payloadHash);
  if (!claimed) return "duplicate";
  try {
    await handler();
    await inbox.complete(input.consumer, input.eventId);
    return "processed";
  } catch (error) {
    await inbox.fail(input.consumer, input.eventId, error instanceof Error ? error.name : "UnknownError");
    throw error;
  }
}
