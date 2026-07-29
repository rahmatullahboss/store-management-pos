import type { AuditMetadataV1, ScopeContextV1 } from "../../../packages/contracts/src/v1/common.js";

export type MetricValueKind = "money" | "quantity" | "count" | "ratio" | "duration";
export type ProjectionHealth = "fresh" | "stale" | "rebuilding" | "degraded" | "failed";

export interface MetricDefinitionV1 {
  readonly schemaVersion: "1.0";
  readonly metricId: string;
  readonly version: string;
  readonly ownerModule: string;
  readonly displayName: string;
  readonly description: string;
  readonly valueKind: MetricValueKind;
  readonly formula: string;
  readonly supportedDimensions: readonly string[];
  readonly sourceEventTypes: readonly string[];
  readonly controlTotalMetricId?: string;
  readonly defaultFreshnessSeconds: number;
}

export interface MetricValueV1 {
  readonly amount: string;
  readonly scale: number;
  readonly unit: string;
  readonly currency?: string;
}

export interface MetricQueryV1 {
  readonly schemaVersion: "1.0";
  readonly scope: ScopeContextV1;
  readonly metricId: string;
  readonly metricVersion: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly dimensions: Readonly<Record<string, string>>;
  readonly requestedAt: string;
}

export interface MetricResultV1 {
  readonly schemaVersion: "1.0";
  readonly query: MetricQueryV1;
  readonly value: MetricValueV1;
  readonly controlTotal?: MetricValueV1;
  readonly sourceCount: string;
  readonly sourceCursor: string;
  readonly freshnessObservedAt: string;
  readonly freshnessSeconds: number;
  readonly health: ProjectionHealth;
  readonly drillThrough: readonly SourceReferenceV1[];
}

export interface SourceReferenceV1 {
  readonly module: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventId?: string;
  readonly businessDate: string;
}

export interface ProjectionCursorV1 {
  readonly schemaVersion: "1.0";
  readonly tenantId: string;
  readonly projectionName: string;
  readonly sourceStream: string;
  readonly highWaterSequence: string;
  readonly lastEventId: string;
  readonly lastOccurredAt: string;
  readonly rebuiltAt?: string;
  readonly status: ProjectionHealth;
}

export interface ProjectionEventEnvelopeV1<TPayload = Readonly<Record<string, unknown>>> {
  readonly schemaVersion: "1.0";
  readonly eventId: string;
  readonly tenantId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly sequence: string;
  readonly occurredAt: string;
  readonly businessDate: string;
  readonly payload: TPayload;
  readonly metadata: AuditMetadataV1;
}

export interface ProjectionReconciliationResultV1 {
  readonly schemaVersion: "1.0";
  readonly tenantId: string;
  readonly projectionName: string;
  readonly metricId: string;
  readonly metricVersion: string;
  readonly projected: MetricValueV1;
  readonly control: MetricValueV1;
  readonly difference: MetricValueV1;
  readonly reconciled: boolean;
  readonly checkedAt: string;
  readonly sourceCursor: string;
}

export interface ExportRequestV1 {
  readonly schemaVersion: "1.0";
  readonly exportId: string;
  readonly scope: ScopeContextV1;
  readonly format: "csv" | "xlsx" | "pdf" | "json";
  readonly reportId: string;
  readonly parameters: Readonly<Record<string, string>>;
  readonly requestedAt: string;
  readonly metadata: AuditMetadataV1;
}
