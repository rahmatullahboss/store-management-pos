import type {
  EntitlementDefinitionV1,
  PlanDefinitionV1,
  SupportImpersonationGrantV1,
  TenantSubscriptionV1,
  UsageCounterV1,
  UsageEventV1,
} from "./contracts.js";

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/u;
const POSITIVE_INTEGER_PATTERN = /^[0-9]+$/u;

function assertIdentifier(value: string, field: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) throw new TypeError(`${field} is invalid`);
}

export function assertPlanDefinition(plan: PlanDefinitionV1): void {
  assertIdentifier(plan.planId, "planId");
  if (plan.version.trim().length === 0 || plan.displayName.trim().length === 0) throw new TypeError("Plan version and display name are required");
  if (plan.entitlements.length === 0) throw new TypeError("Plan requires at least one entitlement");
  const codes = new Set<string>();
  for (const entitlement of plan.entitlements) {
    assertEntitlementDefinition(entitlement);
    if (codes.has(entitlement.entitlementCode)) throw new TypeError("Plan entitlement codes must be unique");
    codes.add(entitlement.entitlementCode);
  }
  if (plan.effectiveTo !== undefined && Date.parse(plan.effectiveTo) <= Date.parse(plan.effectiveFrom)) {
    throw new TypeError("Plan effective end must follow effective start");
  }
}

function assertEntitlementDefinition(entitlement: EntitlementDefinitionV1): void {
  assertIdentifier(entitlement.entitlementCode, "entitlementCode");
  if (entitlement.valueType === "boolean" && entitlement.value !== "true" && entitlement.value !== "false") {
    throw new TypeError("Boolean entitlement value must be true or false");
  }
  if (entitlement.valueType === "integer" && !POSITIVE_INTEGER_PATTERN.test(entitlement.value)) {
    throw new TypeError("Integer entitlement value must be a non-negative integer string");
  }
  if (entitlement.valueType === "string" && entitlement.value.trim().length === 0) throw new TypeError("String entitlement value is required");
}

export interface EntitlementDecision {
  readonly allowed: boolean;
  readonly enforcement: EntitlementDefinitionV1["enforcement"];
  readonly reason: "enabled" | "disabled" | "within_limit" | "limit_exceeded" | "not_configured";
  readonly limit?: string;
  readonly observed?: string;
}

export function evaluateEntitlement(
  plan: PlanDefinitionV1,
  entitlementCode: string,
  observedQuantity?: string,
): EntitlementDecision {
  assertPlanDefinition(plan);
  const entitlement = plan.entitlements.find((candidate) => candidate.entitlementCode === entitlementCode);
  if (!entitlement) return Object.freeze({ allowed: false, enforcement: "hard", reason: "not_configured" });
  if (entitlement.valueType === "boolean") {
    const enabled = entitlement.value === "true";
    return Object.freeze({
      allowed: enabled || entitlement.enforcement !== "hard",
      enforcement: entitlement.enforcement,
      reason: enabled ? "enabled" : "disabled",
    });
  }
  if (entitlement.valueType !== "integer") {
    return Object.freeze({ allowed: true, enforcement: entitlement.enforcement, reason: "enabled" });
  }
  if (observedQuantity === undefined || !POSITIVE_INTEGER_PATTERN.test(observedQuantity)) throw new TypeError("Observed entitlement quantity must be a non-negative integer string");
  const allowed = BigInt(observedQuantity) <= BigInt(entitlement.value);
  return Object.freeze({
    allowed: allowed || entitlement.enforcement !== "hard",
    enforcement: entitlement.enforcement,
    reason: allowed ? "within_limit" : "limit_exceeded",
    limit: entitlement.value,
    observed: observedQuantity,
  });
}

export type SubscriptionCommand = "activate" | "mark_past_due" | "suspend" | "resume" | "cancel";

export function transitionSubscription(
  subscription: TenantSubscriptionV1,
  command: SubscriptionCommand,
  observedAt: string,
): TenantSubscriptionV1 {
  const transitions: Readonly<Record<TenantSubscriptionV1["status"], Readonly<Partial<Record<SubscriptionCommand, TenantSubscriptionV1["status"]>>>>> = {
    trial: { activate: "active", suspend: "suspended", cancel: "cancelled" },
    active: { mark_past_due: "past_due", suspend: "suspended", cancel: "cancelled" },
    past_due: { activate: "active", suspend: "suspended", cancel: "cancelled" },
    suspended: { resume: "active", cancel: "cancelled" },
    cancelled: {},
  };
  const next = transitions[subscription.status][command];
  if (!next) throw new TypeError(`Invalid subscription transition: ${subscription.status} -> ${command}`);
  return Object.freeze({
    schemaVersion: "1.0",
    subscriptionId: subscription.subscriptionId,
    tenantId: subscription.tenantId,
    planId: subscription.planId,
    planVersion: subscription.planVersion,
    status: next,
    startedAt: subscription.startedAt,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    version: (BigInt(subscription.version) + 1n).toString(),
    ...(next === "suspended" ? { suspendedAt: observedAt } : {}),
    ...(next === "cancelled" ? { cancelledAt: observedAt } : {}),
  });
}

export function applyUsageEvent(counter: UsageCounterV1 | undefined, event: UsageEventV1, periodStart: string, periodEnd: string): UsageCounterV1 {
  assertIdentifier(event.meterCode, "meterCode");
  if (!POSITIVE_INTEGER_PATTERN.test(event.quantity)) throw new TypeError("Usage quantity must be a non-negative integer string");
  if (Date.parse(periodEnd) <= Date.parse(periodStart)) throw new TypeError("Usage period end must follow start");
  if (counter !== undefined) {
    if (counter.tenantId !== event.tenantId || counter.subscriptionId !== event.subscriptionId || counter.meterCode !== event.meterCode) {
      throw new TypeError("Usage counter scope does not match event");
    }
    if (counter.periodStart !== periodStart || counter.periodEnd !== periodEnd) throw new TypeError("Usage event period does not match counter period");
    if (counter.lastUsageEventId === event.usageEventId) return counter;
  }
  return Object.freeze({
    schemaVersion: "1.0",
    tenantId: event.tenantId,
    subscriptionId: event.subscriptionId,
    meterCode: event.meterCode,
    periodStart,
    periodEnd,
    quantity: (BigInt(counter?.quantity ?? "0") + BigInt(event.quantity)).toString(),
    lastUsageEventId: event.usageEventId,
    updatedAt: event.occurredAt,
  });
}

export function assertSupportImpersonationActive(
  grant: SupportImpersonationGrantV1,
  actorId: string,
  scope: string,
  observedAt: string,
): void {
  if (grant.supportActorId !== actorId) throw new TypeError("Support actor does not match impersonation grant");
  if (grant.approvedBy === grant.supportActorId) throw new TypeError("Support impersonation requires independent approval");
  if (grant.revokedAt !== undefined) throw new TypeError("Support impersonation grant is revoked");
  const timestamp = Date.parse(observedAt);
  if (timestamp < Date.parse(grant.issuedAt) || timestamp >= Date.parse(grant.expiresAt)) throw new TypeError("Support impersonation grant is outside its approval window");
  if (!grant.scopes.includes(scope)) throw new TypeError("Support impersonation scope is not approved");
}

export const assertImpersonationGrantActive = assertSupportImpersonationActive;
