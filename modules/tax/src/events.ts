import type { BusinessDate, DomainEventEnvelope } from "../../../packages/foundation/src/index.js";

export interface TaxConfigurationPublishedPayload {
  readonly taxCodeId: string;
  readonly taxCodeVersion: string;
  readonly jurisdictionId: string;
  readonly rateVersions: readonly { readonly rateId: string; readonly version: string; readonly rateBasisPoints: string; readonly compound: boolean }[];
  readonly effectiveFrom: string;
  readonly effectiveUntil?: string;
  readonly publishedAt: string;
}

function instant(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError(`${field} is invalid`);
  return date.toISOString();
}

function positiveInteger(value: string, field: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new TypeError(`${field} is invalid`);
  return value;
}

function nonNegativeInteger(value: string, field: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) < 0n) throw new TypeError(`${field} is invalid`);
  return value;
}

export function taxConfigurationPublishedEvent(input: {
  readonly eventId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly businessDate: BusinessDate;
  readonly payload: TaxConfigurationPublishedPayload;
}): DomainEventEnvelope<TaxConfigurationPublishedPayload> {
  const payload = Object.freeze({
    ...input.payload,
    taxCodeVersion: positiveInteger(input.payload.taxCodeVersion, "Tax code version"),
    rateVersions: Object.freeze(input.payload.rateVersions.map((rate) => Object.freeze({
      ...rate,
      version: positiveInteger(rate.version, "Tax rate version"),
      rateBasisPoints: nonNegativeInteger(rate.rateBasisPoints, "Tax rate basis points"),
    }))),
    effectiveFrom: instant(input.payload.effectiveFrom, "Tax configuration effectiveFrom"),
    ...(input.payload.effectiveUntil === undefined ? {} : { effectiveUntil: instant(input.payload.effectiveUntil, "Tax configuration effectiveUntil") }),
    publishedAt: instant(input.payload.publishedAt, "Tax configuration publishedAt"),
  });
  return Object.freeze({
    schemaVersion: "1.0",
    eventId: input.eventId,
    eventType: "tax.configuration.published.v1",
    aggregateType: "tax.code",
    aggregateId: payload.taxCodeId,
    tenantId: input.tenantId,
    occurredAt: payload.publishedAt,
    businessDate: input.businessDate,
    correlationId: input.correlationId,
    actorId: input.actorId,
    payload,
    metadata: Object.freeze({ producer: "MOD-A", contract: "tax-configuration-published-v1" }),
  });
}
