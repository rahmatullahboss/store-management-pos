import type { DomainEventEnvelopeV1, PriceTaxCalculationRequestV1 } from "./contracts.js";

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requiredString(value: unknown, field: string): string { if (typeof value !== "string" || value.length === 0) throw new TypeError(`${field} is required`); return value; }

export function parseDomainEventEnvelopeV1(value: unknown): DomainEventEnvelopeV1 {
  if (!isRecord(value)) throw new TypeError("Event envelope must be an object");
  if (value.schemaVersion !== "1.0") throw new TypeError("Unsupported event schema version");
  return {
    schemaVersion: "1.0",
    eventId: requiredString(value.eventId, "eventId"),
    eventType: requiredString(value.eventType, "eventType"),
    aggregateType: requiredString(value.aggregateType, "aggregateType"),
    aggregateId: requiredString(value.aggregateId, "aggregateId"),
    tenantId: requiredString(value.tenantId, "tenantId"),
    occurredAt: requiredString(value.occurredAt, "occurredAt"),
    businessDate: requiredString(value.businessDate, "businessDate"),
    correlationId: requiredString(value.correlationId, "correlationId"),
    ...(typeof value.causationId === "string" ? { causationId: value.causationId } : {}),
    ...(typeof value.actorId === "string" ? { actorId: value.actorId } : {}),
    payload: value.payload,
    metadata: isRecord(value.metadata) ? Object.fromEntries(Object.entries(value.metadata).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {},
  };
}

export function assertPriceTaxCalculationRequestV1(value: unknown): asserts value is PriceTaxCalculationRequestV1 {
  if (!isRecord(value) || value.schemaVersion !== "1.0") throw new TypeError("Invalid price/tax request version");
  if (!isRecord(value.context) || !isRecord(value.item) || !isRecord(value.quantity)) throw new TypeError("Price/tax request is missing context, item, or quantity");
  requiredString(value.currency, "currency");
}
