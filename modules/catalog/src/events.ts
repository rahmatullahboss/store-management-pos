import type { BusinessDate, DomainEventEnvelope } from "../../../packages/foundation/src/index.js";

export interface CatalogProductChangedPayload {
  readonly productId: string;
  readonly version: string;
  readonly status: "draft" | "active" | "inactive" | "archived";
  readonly changeKind: "created" | "updated" | "status_changed";
  readonly variantIds: readonly string[];
  readonly updatedAt: string;
}

export function catalogProductChangedEvent(input: {
  readonly eventId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly businessDate: BusinessDate;
  readonly payload: CatalogProductChangedPayload;
}): DomainEventEnvelope<CatalogProductChangedPayload> {
  const occurredAt = new Date(input.payload.updatedAt);
  if (Number.isNaN(occurredAt.valueOf())) throw new TypeError("Catalog event updatedAt is invalid");
  if (!/^\d+$/.test(input.payload.version) || BigInt(input.payload.version) <= 0n) throw new TypeError("Catalog event version is invalid");
  const payload = Object.freeze({ ...input.payload, variantIds: Object.freeze([...input.payload.variantIds]), updatedAt: occurredAt.toISOString() });
  return Object.freeze({
    schemaVersion: "1.0",
    eventId: input.eventId,
    eventType: "catalog.product.changed.v1",
    aggregateType: "catalog.product",
    aggregateId: payload.productId,
    tenantId: input.tenantId,
    occurredAt: payload.updatedAt,
    businessDate: input.businessDate,
    correlationId: input.correlationId,
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
    actorId: input.actorId,
    payload,
    metadata: Object.freeze({ producer: "MOD-A", contract: "catalog-product-changed-v1" }),
  });
}
