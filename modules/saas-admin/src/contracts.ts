import type { AuditMetadataV1 } from "../../../packages/contracts/src/v1/common.js";

export interface PlanDefinitionV1 {
  readonly schemaVersion: "1.0";
  readonly planId: string;
  readonly version: string;
  readonly displayName: string;
  readonly status: "draft" | "active" | "retired";
  readonly entitlements: readonly EntitlementDefinitionV1[];
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface EntitlementDefinitionV1 {
  readonly entitlementCode: string;
  readonly valueType: "boolean" | "integer" | "string";
  readonly value: string;
  readonly enforcement: "hard" | "soft" | "observe";
  readonly resetPeriod?: "day" | "month" | "year";
}

export interface TenantSubscriptionV1 {
  readonly schemaVersion: "1.0";
  readonly subscriptionId: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly planVersion: string;
  readonly status: "trial" | "active" | "past_due" | "suspended" | "cancelled";
  readonly startedAt: string;
  readonly currentPeriodStart: string;
  readonly currentPeriodEnd: string;
  readonly suspendedAt?: string;
  readonly cancelledAt?: string;
  readonly version: string;
}

export interface UsageEventV1 {
  readonly schemaVersion: "1.0";
  readonly usageEventId: string;
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly meterCode: string;
  readonly quantity: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly occurredAt: string;
  readonly businessDate: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface UsageCounterV1 {
  readonly schemaVersion: "1.0";
  readonly tenantId: string;
  readonly subscriptionId: string;
  readonly meterCode: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly quantity: string;
  readonly lastUsageEventId: string;
  readonly updatedAt: string;
}

export interface TenantLifecycleJobV1 {
  readonly schemaVersion: "1.0";
  readonly jobId: string;
  readonly tenantId: string;
  readonly operation: "provision" | "suspend" | "resume" | "offboard" | "export";
  readonly status: "queued" | "running" | "review" | "completed" | "failed" | "cancelled";
  readonly requestedAt: string;
  readonly requestedBy: string;
  readonly reason: string;
  readonly metadata: AuditMetadataV1;
}

export interface SupportImpersonationGrantV1 {
  readonly schemaVersion: "1.0";
  readonly grantId: string;
  readonly tenantId: string;
  readonly supportActorId: string;
  readonly approvedBy: string;
  readonly reason: string;
  readonly scopes: readonly string[];
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt?: string;
}

export interface FeatureRolloutV1 {
  readonly schemaVersion: "1.0";
  readonly rolloutId: string;
  readonly tenantId: string;
  readonly featureCode: string;
  readonly status: "planned" | "enabled" | "paused" | "disabled";
  readonly rolloutPercentage: number;
  readonly reason: string;
  readonly updatedAt: string;
  readonly version: string;
}

export interface SupportIncidentV1 {
  readonly schemaVersion: "1.0";
  readonly incidentId: string;
  readonly tenantId: string;
  readonly incidentCode: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly status: "open" | "investigating" | "monitoring" | "resolved" | "closed";
  readonly summary: string;
  readonly openedAt: string;
  readonly resolvedAt?: string;
  readonly version: string;
}
