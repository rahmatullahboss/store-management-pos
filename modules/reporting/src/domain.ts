import type {
  MetricDefinitionV1,
  MetricValueV1,
  ProjectionCursorV1,
  ProjectionEventEnvelopeV1,
  ProjectionReconciliationResultV1,
} from "./contracts.js";

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/u;
const INTEGER_PATTERN = /^-?[0-9]+$/u;

function assertIdentifier(value: string, field: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) throw new TypeError(`${field} is invalid`);
}

export function assertMetricDefinition(definition: MetricDefinitionV1): void {
  assertIdentifier(definition.metricId, "metricId");
  assertIdentifier(definition.ownerModule, "ownerModule");
  if (definition.version.trim().length === 0) throw new TypeError("Metric version is required");
  if (definition.displayName.trim().length === 0 || definition.description.trim().length === 0) {
    throw new TypeError("Metric display name and description are required");
  }
  if (definition.formula.trim().length === 0) throw new TypeError("Metric formula is required");
  if (!Number.isInteger(definition.defaultFreshnessSeconds) || definition.defaultFreshnessSeconds <= 0) {
    throw new RangeError("Metric freshness threshold must be a positive integer");
  }
  if (new Set(definition.supportedDimensions).size !== definition.supportedDimensions.length) {
    throw new TypeError("Metric dimensions must be unique");
  }
  if (definition.sourceEventTypes.length === 0) throw new TypeError("Metric requires at least one source event type");
}

export function metricAmount(value: MetricValueV1): bigint {
  if (!INTEGER_PATTERN.test(value.amount)) throw new TypeError("Metric amount must be an exact integer string");
  if (!Number.isInteger(value.scale) || value.scale < 0 || value.scale > 12) throw new RangeError("Metric scale must be between 0 and 12");
  if (value.unit.trim().length === 0) throw new TypeError("Metric unit is required");
  if (value.currency !== undefined && !/^[A-Z]{3}$/u.test(value.currency)) throw new TypeError("Metric currency must be a three-letter ISO code");
  return BigInt(value.amount);
}

function assertCompatibleMetricValues(left: MetricValueV1, right: MetricValueV1): void {
  metricAmount(left);
  metricAmount(right);
  if (left.scale !== right.scale || left.unit !== right.unit || left.currency !== right.currency) {
    throw new TypeError("Metric values use incompatible scale, unit or currency");
  }
}

export function subtractMetricValues(left: MetricValueV1, right: MetricValueV1): MetricValueV1 {
  assertCompatibleMetricValues(left, right);
  return Object.freeze({
    amount: (metricAmount(left) - metricAmount(right)).toString(),
    scale: left.scale,
    unit: left.unit,
    ...(left.currency === undefined ? {} : { currency: left.currency }),
  });
}

export function reconcileProjection(input: {
  readonly tenantId: string;
  readonly projectionName: string;
  readonly metricId: string;
  readonly metricVersion: string;
  readonly projected: MetricValueV1;
  readonly control: MetricValueV1;
  readonly checkedAt: string;
  readonly sourceCursor: string;
}): ProjectionReconciliationResultV1 {
  assertIdentifier(input.projectionName, "projectionName");
  assertIdentifier(input.metricId, "metricId");
  const difference = subtractMetricValues(input.projected, input.control);
  return Object.freeze({
    schemaVersion: "1.0",
    ...input,
    difference,
    reconciled: metricAmount(difference) === 0n,
  });
}

export interface AdvanceProjectionResult {
  readonly disposition: "applied" | "duplicate";
  readonly cursor: ProjectionCursorV1;
}

export function advanceProjectionCursor(
  cursor: ProjectionCursorV1 | undefined,
  event: ProjectionEventEnvelopeV1,
): AdvanceProjectionResult {
  if (!INTEGER_PATTERN.test(event.sequence) || BigInt(event.sequence) <= 0n) throw new TypeError("Projection event sequence must be a positive integer string");
  assertIdentifier(event.eventType, "eventType");
  if (event.eventId.trim().length === 0 || event.tenantId.trim().length === 0) throw new TypeError("Projection event identity is required");

  if (cursor === undefined) {
    return Object.freeze({
      disposition: "applied",
      cursor: Object.freeze({
        schemaVersion: "1.0",
        tenantId: event.tenantId,
        projectionName: event.aggregateType,
        sourceStream: event.eventType,
        highWaterSequence: event.sequence,
        lastEventId: event.eventId,
        lastOccurredAt: event.occurredAt,
        status: "fresh",
      }),
    });
  }

  if (cursor.tenantId !== event.tenantId) throw new TypeError("Projection cursor tenant does not match event tenant");
  const currentSequence = BigInt(cursor.highWaterSequence);
  const nextSequence = BigInt(event.sequence);
  if (nextSequence === currentSequence && event.eventId === cursor.lastEventId) {
    return Object.freeze({ disposition: "duplicate", cursor });
  }
  if (nextSequence <= currentSequence) {
    throw new TypeError("Out-of-order projection event requires an explicit rebuild or reconciliation workflow");
  }

  return Object.freeze({
    disposition: "applied",
    cursor: Object.freeze({
      ...cursor,
      highWaterSequence: event.sequence,
      lastEventId: event.eventId,
      lastOccurredAt: event.occurredAt,
      status: "fresh",
    }),
  });
}

export function projectionFreshness(input: {
  readonly observedAt: string;
  readonly sourceOccurredAt: string;
  readonly thresholdSeconds: number;
}): "fresh" | "stale" {
  if (!Number.isInteger(input.thresholdSeconds) || input.thresholdSeconds <= 0) throw new RangeError("Freshness threshold must be positive");
  const observed = Date.parse(input.observedAt);
  const source = Date.parse(input.sourceOccurredAt);
  if (!Number.isFinite(observed) || !Number.isFinite(source) || observed < source) throw new TypeError("Freshness timestamps are invalid");
  return observed - source <= input.thresholdSeconds * 1_000 ? "fresh" : "stale";
}
