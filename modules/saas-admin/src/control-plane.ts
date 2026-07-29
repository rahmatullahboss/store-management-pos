import type {
  FeatureRolloutV1,
  PlanDefinitionV1,
  SupportIncidentV1,
  TenantLifecycleJobV1,
  TenantSubscriptionV1,
} from "./contracts.js";
import { evaluateEntitlement } from "./domain.js";

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/u;
const FAILURE_CATEGORY_PATTERN = /^[a-z][a-z0-9_.-]{2,63}$/u;

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} is invalid`);
  return parsed;
}

export interface TenantAccessDecisionV1 {
  readonly allowed: boolean;
  readonly reason:
    | "allowed"
    | "subscription_inactive"
    | "subscription_outside_period"
    | "plan_mismatch"
    | "plan_inactive"
    | "entitlement_disabled"
    | "entitlement_limit_exceeded"
    | "entitlement_not_configured";
  readonly enforcement: "hard" | "soft" | "observe";
  readonly requiresBillingAttention: boolean;
  readonly limit?: string;
  readonly observed?: string;
}

export function evaluateTenantAccess(input: {
  readonly subscription: TenantSubscriptionV1;
  readonly plan: PlanDefinitionV1;
  readonly entitlementCode: string;
  readonly observedAt: string;
  readonly observedQuantity?: string;
}): TenantAccessDecisionV1 {
  const observedAt = parseTimestamp(input.observedAt, "Tenant access observedAt");
  const periodStart = parseTimestamp(input.subscription.currentPeriodStart, "Subscription currentPeriodStart");
  const periodEnd = parseTimestamp(input.subscription.currentPeriodEnd, "Subscription currentPeriodEnd");
  if (periodEnd <= periodStart) throw new TypeError("Subscription period is invalid");
  const deny = (
    reason: TenantAccessDecisionV1["reason"],
    enforcement: TenantAccessDecisionV1["enforcement"] = "hard",
  ): TenantAccessDecisionV1 => Object.freeze({
    allowed: false,
    reason,
    enforcement,
    requiresBillingAttention: input.subscription.status === "past_due",
  });

  if (input.subscription.status === "suspended" || input.subscription.status === "cancelled") {
    return deny("subscription_inactive");
  }
  if (observedAt < periodStart || observedAt >= periodEnd) return deny("subscription_outside_period");
  if (input.subscription.planId !== input.plan.planId || input.subscription.planVersion !== input.plan.version) {
    return deny("plan_mismatch");
  }
  const effectiveFrom = parseTimestamp(input.plan.effectiveFrom, "Plan effectiveFrom");
  const effectiveTo = input.plan.effectiveTo === undefined ? undefined : parseTimestamp(input.plan.effectiveTo, "Plan effectiveTo");
  if (input.plan.status !== "active" || observedAt < effectiveFrom || (effectiveTo !== undefined && observedAt >= effectiveTo)) {
    return deny("plan_inactive");
  }

  const entitlement = evaluateEntitlement(input.plan, input.entitlementCode, input.observedQuantity);
  const reason: TenantAccessDecisionV1["reason"] = entitlement.reason === "not_configured"
    ? "entitlement_not_configured"
    : entitlement.reason === "disabled"
      ? "entitlement_disabled"
      : entitlement.reason === "limit_exceeded"
        ? "entitlement_limit_exceeded"
        : "allowed";
  return Object.freeze({
    allowed: entitlement.allowed,
    reason,
    enforcement: entitlement.enforcement,
    requiresBillingAttention: input.subscription.status === "past_due",
    ...(entitlement.limit === undefined ? {} : { limit: entitlement.limit }),
    ...(entitlement.observed === undefined ? {} : { observed: entitlement.observed }),
  });
}

function rolloutBucket(tenantId: string, featureCode: string): number {
  const input = `${tenantId}:${featureCode}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash % 10_000;
}

export function assertFeatureRollout(rollout: FeatureRolloutV1): void {
  if (rollout.rolloutId.trim().length === 0 || rollout.tenantId.trim().length === 0) {
    throw new TypeError("Feature rollout identity is required");
  }
  if (!IDENTIFIER_PATTERN.test(rollout.featureCode)) throw new TypeError("Feature rollout code is invalid");
  if (!Number.isInteger(rollout.rolloutPercentage) || rollout.rolloutPercentage < 0 || rollout.rolloutPercentage > 100) {
    throw new RangeError("Feature rollout percentage must be between 0 and 100");
  }
  if (rollout.status !== "enabled" && rollout.rolloutPercentage !== 0) {
    throw new TypeError("Non-enabled feature rollout percentage must be zero");
  }
  if (rollout.reason.trim().length === 0) throw new TypeError("Feature rollout reason is required");
  parseTimestamp(rollout.updatedAt, "Feature rollout updatedAt");
  if (!/^[1-9][0-9]*$/u.test(rollout.version)) throw new TypeError("Feature rollout version is invalid");
}

export function featureEnabledForTenant(rollout: FeatureRolloutV1): boolean {
  assertFeatureRollout(rollout);
  if (rollout.status !== "enabled" || rollout.rolloutPercentage === 0) return false;
  if (rollout.rolloutPercentage === 100) return true;
  return rolloutBucket(rollout.tenantId, rollout.featureCode) < rollout.rolloutPercentage * 100;
}

export type SupportIncidentCommand = "investigate" | "monitor" | "resolve" | "reopen" | "close";

export function transitionSupportIncident(
  incident: SupportIncidentV1,
  command: SupportIncidentCommand,
  observedAt: string,
): SupportIncidentV1 {
  const transitions: Readonly<Record<SupportIncidentV1["status"], Readonly<Partial<Record<SupportIncidentCommand, SupportIncidentV1["status"]>>>>> = {
    open: { investigate: "investigating", resolve: "resolved" },
    investigating: { monitor: "monitoring", resolve: "resolved" },
    monitoring: { investigate: "investigating", resolve: "resolved" },
    resolved: { reopen: "investigating", close: "closed" },
    closed: {},
  };
  const next = transitions[incident.status][command];
  if (next === undefined) throw new TypeError(`Invalid support incident transition: ${incident.status} -> ${command}`);
  const observed = parseTimestamp(observedAt, "Support incident observedAt");
  if (observed < parseTimestamp(incident.openedAt, "Support incident openedAt")) {
    throw new TypeError("Support incident transition precedes opening");
  }
  const result: SupportIncidentV1 = {
    schemaVersion: incident.schemaVersion,
    incidentId: incident.incidentId,
    tenantId: incident.tenantId,
    incidentCode: incident.incidentCode,
    severity: incident.severity,
    status: next,
    summary: incident.summary,
    openedAt: incident.openedAt,
    version: (BigInt(incident.version) + 1n).toString(),
    ...(next === "resolved"
      ? { resolvedAt: observedAt }
      : next === "investigating"
        ? {}
        : incident.resolvedAt === undefined
          ? {}
          : { resolvedAt: incident.resolvedAt }),
  };
  return Object.freeze(result);
}

export class TenantLifecycleExecutionError extends Error {
  override readonly name = "TenantLifecycleExecutionError";

  constructor(readonly category: string, readonly retryable: boolean, message: string) {
    super(message);
    if (!FAILURE_CATEGORY_PATTERN.test(category)) throw new TypeError("Tenant lifecycle failure category is invalid");
  }
}

export interface TenantLifecycleExecutionPort {
  execute(job: TenantLifecycleJobV1): Promise<{
    readonly disposition: "completed" | "review";
    readonly evidenceReference?: string;
    readonly reasonCode?: string;
  }>;
}

export interface TenantLifecycleCommandPort {
  transition(input: {
    readonly jobId: string;
    readonly tenantId: string;
    readonly priorStatus: TenantLifecycleJobV1["status"];
    readonly newStatus: TenantLifecycleJobV1["status"];
    readonly reasonCode?: string;
    readonly observedAt: string;
  }): Promise<void>;
}

export interface TenantLifecycleRunResultV1 {
  readonly status: "completed" | "review" | "failed";
  readonly reasonCode?: string;
  readonly retryable?: boolean;
  readonly evidenceReference?: string;
}

export async function runTenantLifecycleJob(input: {
  readonly job: TenantLifecycleJobV1;
  readonly observedAt: string;
  readonly executor: TenantLifecycleExecutionPort;
  readonly commands: TenantLifecycleCommandPort;
}): Promise<TenantLifecycleRunResultV1> {
  if (input.job.status !== "queued") throw new TypeError("Only queued tenant lifecycle jobs can run");
  if (input.job.jobId.trim().length === 0 || input.job.tenantId.trim().length === 0 || input.job.reason.trim().length === 0) {
    throw new TypeError("Tenant lifecycle job identity and reason are required");
  }
  parseTimestamp(input.job.requestedAt, "Tenant lifecycle requestedAt");
  parseTimestamp(input.observedAt, "Tenant lifecycle observedAt");
  await input.commands.transition({
    jobId: input.job.jobId,
    tenantId: input.job.tenantId,
    priorStatus: "queued",
    newStatus: "running",
    observedAt: input.observedAt,
  });

  try {
    const execution = await input.executor.execute(input.job);
    if ((input.job.operation === "export" || input.job.operation === "offboard")
        && execution.disposition === "completed"
        && (execution.evidenceReference === undefined
          || execution.evidenceReference.trim().length === 0
          || execution.evidenceReference.length > 2_048)) {
      throw new TenantLifecycleExecutionError("export_evidence_invalid", false, "Lifecycle export evidence is invalid");
    }
    const status = execution.disposition;
    await input.commands.transition({
      jobId: input.job.jobId,
      tenantId: input.job.tenantId,
      priorStatus: "running",
      newStatus: status,
      ...(execution.reasonCode === undefined ? {} : { reasonCode: execution.reasonCode }),
      observedAt: input.observedAt,
    });
    return Object.freeze({
      status,
      ...(execution.reasonCode === undefined ? {} : { reasonCode: execution.reasonCode }),
      ...(execution.evidenceReference === undefined ? {} : { evidenceReference: execution.evidenceReference }),
    });
  } catch (error) {
    const normalized = error instanceof TenantLifecycleExecutionError
      ? error
      : new TenantLifecycleExecutionError("execution_failed", true, "Tenant lifecycle execution failed");
    await input.commands.transition({
      jobId: input.job.jobId,
      tenantId: input.job.tenantId,
      priorStatus: "running",
      newStatus: "failed",
      reasonCode: normalized.category,
      observedAt: input.observedAt,
    });
    return Object.freeze({ status: "failed", reasonCode: normalized.category, retryable: normalized.retryable });
  }
}
