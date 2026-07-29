export * from "./finance-jobs.js";
export * from "./modules/mod-c.js";

import { consumeAtLeastOnce, type ConsumerInbox, type DomainEventEnvelope } from "../../../packages/foundation/src/events.js";
import { parseDomainEventEnvelopeV1 } from "../../../packages/contracts/src/v1/validators.js";

export interface QueueMessage<T> { readonly body: T; ack(): void; retry(): void }
export interface MessageBatch<T> { readonly messages: readonly QueueMessage<T>[] }
export interface JobsEnvironment { readonly inbox: ConsumerInbox }

export async function consumeDomainEvents(batch: MessageBatch<unknown>, env: JobsEnvironment): Promise<void> {
  for (const message of batch.messages) {
    try {
      const event = parseDomainEventEnvelopeV1(message.body) as DomainEventEnvelope;
      const outcome = await consumeAtLeastOnce(env.inbox, { consumer: "foundation-reference-consumer-v1", eventId: event.eventId, payloadHash: JSON.stringify(event.payload) }, async () => {
        if (event.eventType !== "platform.reference.created.v1") return;
      });
      if (outcome === "processed" || outcome === "duplicate") message.ack();
    } catch {
      message.retry();
    }
  }
}
