import type { BusinessDate, DomainEventEnvelope } from "../../../packages/foundation/src/index.js";

export interface PriceListPublishedPayload {
  readonly priceListId: string;
  readonly version: string;
  readonly currency: string;
  readonly moneyScale: number;
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly publishedAt: string;
}

export interface PromotionChangedPayload {
  readonly promotionId: string;
  readonly version: string;
  readonly status: "scheduled" | "active" | "paused" | "expired" | "retired";
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly publishedAt: string;
}

function instant(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError(`${field} is invalid`);
  return date.toISOString();
}

function positiveVersion(value: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new TypeError("Pricing event version is invalid");
  return value;
}

export function priceListPublishedEvent(input: {
  readonly eventId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly businessDate: BusinessDate;
  readonly payload: PriceListPublishedPayload;
}): DomainEventEnvelope<PriceListPublishedPayload> {
  const payload = Object.freeze({
    ...input.payload,
    version: positiveVersion(input.payload.version),
    effectiveFrom: instant(input.payload.effectiveFrom, "Price list effectiveFrom"),
    ...(input.payload.effectiveUntil === undefined ? {} : { effectiveUntil: instant(input.payload.effectiveUntil, "Price list effectiveUntil") }),
    publishedAt: instant(input.payload.publishedAt, "Price list publishedAt"),
    scope: Object.freeze({ ...input.payload.scope }),
  });
  return Object.freeze({
    schemaVersion: "1.0",
    eventId: input.eventId,
    eventType: "pricing.price_list.published.v1",
    aggregateType: "pricing.price_list",
    aggregateId: payload.priceListId,
    tenantId: input.tenantId,
    occurredAt: payload.publishedAt,
    businessDate: input.businessDate,
    correlationId: input.correlationId,
    actorId: input.actorId,
    payload,
    metadata: Object.freeze({ producer: "MOD-A", contract: "price-list-published-v1" }),
  });
}

export function promotionChangedEvent(input: {
  readonly eventId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly businessDate: BusinessDate;
  readonly payload: PromotionChangedPayload;
}): DomainEventEnvelope<PromotionChangedPayload> {
  const payload = Object.freeze({
    ...input.payload,
    version: positiveVersion(input.payload.version),
    effectiveFrom: instant(input.payload.effectiveFrom, "Promotion effectiveFrom"),
    ...(input.payload.effectiveUntil === undefined ? {} : { effectiveUntil: instant(input.payload.effectiveUntil, "Promotion effectiveUntil") }),
    publishedAt: instant(input.payload.publishedAt, "Promotion publishedAt"),
  });
  return Object.freeze({
    schemaVersion: "1.0",
    eventId: input.eventId,
    eventType: "pricing.promotion.changed.v1",
    aggregateType: "pricing.promotion",
    aggregateId: payload.promotionId,
    tenantId: input.tenantId,
    occurredAt: payload.publishedAt,
    businessDate: input.businessDate,
    correlationId: input.correlationId,
    actorId: input.actorId,
    payload,
    metadata: Object.freeze({ producer: "MOD-A", contract: "promotion-changed-v1" }),
  });
}
