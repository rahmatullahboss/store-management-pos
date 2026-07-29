export type ReportingWorkloadKind = "interactive_query" | "projection_batch" | "large_export" | "full_rebuild";

export interface ReportingWorkloadSnapshotV1 {
  readonly checkoutActiveRequests: number;
  readonly checkoutP95Milliseconds: number;
  readonly exportQueueDepth: number;
  readonly concurrentHeavyJobs: number;
  readonly projectionLagSeconds: number;
}

export interface ReportingWorkloadPolicyV1 {
  readonly checkoutP95CeilingMilliseconds: number;
  readonly checkoutActiveRequestCeiling: number;
  readonly exportQueueCeiling: number;
  readonly heavyJobConcurrencyCeiling: number;
  readonly projectionLagEmergencySeconds: number;
}

export interface ReportingWorkloadDecisionV1 {
  readonly disposition: "admit" | "defer" | "reject";
  readonly reason:
    | "within_budget"
    | "checkout_pressure"
    | "queue_saturated"
    | "heavy_job_capacity"
    | "projection_lag_emergency"
    | "invalid_workload";
  readonly retryAfterSeconds?: number;
  readonly priority: "interactive" | "normal" | "background";
}

const DEFAULT_POLICY: ReportingWorkloadPolicyV1 = Object.freeze({
  checkoutP95CeilingMilliseconds: 350,
  checkoutActiveRequestCeiling: 100,
  exportQueueCeiling: 500,
  heavyJobConcurrencyCeiling: 4,
  projectionLagEmergencySeconds: 900,
});

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${field} must be a non-negative integer`);
}

export function decideReportingWorkload(input: {
  readonly kind: ReportingWorkloadKind;
  readonly snapshot: ReportingWorkloadSnapshotV1;
  readonly policy?: ReportingWorkloadPolicyV1;
}): ReportingWorkloadDecisionV1 {
  const policy = input.policy ?? DEFAULT_POLICY;
  for (const [field, value] of Object.entries(input.snapshot)) assertNonNegativeInteger(value, field);
  for (const [field, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value < 1) return Object.freeze({ disposition: "reject", reason: "invalid_workload", priority: "background" });
    if (field.trim().length === 0) return Object.freeze({ disposition: "reject", reason: "invalid_workload", priority: "background" });
  }

  if (input.kind === "interactive_query") {
    if (input.snapshot.checkoutP95Milliseconds > policy.checkoutP95CeilingMilliseconds * 2) {
      return Object.freeze({ disposition: "defer", reason: "checkout_pressure", retryAfterSeconds: 5, priority: "interactive" });
    }
    return Object.freeze({ disposition: "admit", reason: "within_budget", priority: "interactive" });
  }

  if (input.snapshot.checkoutP95Milliseconds > policy.checkoutP95CeilingMilliseconds
      || input.snapshot.checkoutActiveRequests > policy.checkoutActiveRequestCeiling) {
    return Object.freeze({ disposition: "defer", reason: "checkout_pressure", retryAfterSeconds: 30, priority: "background" });
  }
  if (input.snapshot.exportQueueDepth >= policy.exportQueueCeiling && input.kind === "large_export") {
    return Object.freeze({ disposition: "defer", reason: "queue_saturated", retryAfterSeconds: 120, priority: "background" });
  }
  if (input.snapshot.concurrentHeavyJobs >= policy.heavyJobConcurrencyCeiling
      && (input.kind === "large_export" || input.kind === "full_rebuild")) {
    return Object.freeze({ disposition: "defer", reason: "heavy_job_capacity", retryAfterSeconds: 60, priority: "background" });
  }
  if (input.snapshot.projectionLagSeconds >= policy.projectionLagEmergencySeconds
      && input.kind === "large_export") {
    return Object.freeze({ disposition: "defer", reason: "projection_lag_emergency", retryAfterSeconds: 60, priority: "background" });
  }
  return Object.freeze({
    disposition: "admit",
    reason: "within_budget",
    priority: input.kind === "projection_batch" ? "normal" : "background",
  });
}
