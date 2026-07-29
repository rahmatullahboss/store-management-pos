import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { businessDate } from "../../../packages/foundation/src/localization.js";
import type { LegalNumberAllocationV1, LegalNumberScopeV1, PrivacyOperationType, RetentionPolicyV1 } from "./contracts.js";

export interface LegalNumberSequenceState {
  readonly scope: LegalNumberScopeV1;
  readonly nextValue: bigint;
  readonly allocations: readonly LegalNumberAllocationV1[];
}

export interface LegalNumberAllocationResult {
  readonly state: LegalNumberSequenceState;
  readonly allocation: LegalNumberAllocationV1;
  readonly replayed: boolean;
}

export interface PrivacyDisposition {
  readonly requested: PrivacyOperationType;
  readonly effective: PrivacyOperationType;
  readonly preserveImmutableEvidence: boolean;
  readonly allowed: boolean;
  readonly reason?: string;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  return normalized;
}

function parseNonNegativeInteger(value: string, field: string): bigint {
  if (!/^\d+$/u.test(value)) throw new PlatformError("VALIDATION_FAILED", `${field} must be a non-negative integer string`, 400);
  return BigInt(value);
}

export function validateLegalNumberScope(scope: LegalNumberScopeV1): LegalNumberScopeV1 {
  required(scope.scopeId, "scopeId");
  required(scope.tenantId, "tenantId");
  required(scope.legalEntityId, "legalEntityId");
  required(scope.fiscalYear, "fiscalYear");
  required(scope.sequenceVersion, "sequenceVersion");
  const minimum = parseNonNegativeInteger(scope.minimumValue, "minimumValue");
  const maximum = parseNonNegativeInteger(scope.maximumValue, "maximumValue");
  if (maximum < minimum) throw new PlatformError("VALIDATION_FAILED", "Legal number range is invalid", 400);
  if (!Number.isInteger(scope.width) || scope.width < 1 || scope.width > 40) {
    throw new PlatformError("VALIDATION_FAILED", "Legal number width must be between 1 and 40", 400);
  }
  if (maximum.toString().length > scope.width) {
    throw new PlatformError("VALIDATION_FAILED", "Legal number width cannot represent the maximum value", 400);
  }
  businessDate(scope.effectiveFrom);
  if (scope.effectiveTo) {
    businessDate(scope.effectiveTo);
    if (scope.effectiveTo < scope.effectiveFrom) throw new PlatformError("VALIDATION_FAILED", "Legal number effective range is invalid", 400);
  }
  return Object.freeze({ ...scope });
}

export function createLegalNumberSequence(scope: LegalNumberScopeV1): LegalNumberSequenceState {
  const validated = validateLegalNumberScope(scope);
  return Object.freeze({
    scope: validated,
    nextValue: parseNonNegativeInteger(validated.minimumValue, "minimumValue"),
    allocations: Object.freeze([]),
  });
}

function legalNumber(scope: LegalNumberScopeV1, value: bigint): string {
  return `${scope.prefix}${value.toString().padStart(scope.width, "0")}${scope.suffix}`;
}

export function allocateLegalNumber(
  state: LegalNumberSequenceState,
  command: {
    readonly allocationId: string;
    readonly operationId: string;
    readonly allocatedAt: string;
    readonly allocationMode: "online" | "offline_block";
    readonly deviceId?: string;
  },
): LegalNumberAllocationResult {
  const scope = validateLegalNumberScope(state.scope);
  const existing = state.allocations.find((allocation) => allocation.operationId === command.operationId);
  if (existing) return Object.freeze({ state, allocation: existing, replayed: true });
  if (state.allocations.some((allocation) => allocation.allocationId === command.allocationId)) {
    throw new PlatformError("IDEMPOTENCY_CONFLICT", "Legal number allocation ID already exists for another operation", 409);
  }
  if (command.allocationMode === "offline_block" && !scope.offlineAllocationAllowed) {
    throw new PlatformError("PERMISSION_DENIED", "Offline legal number allocation is not supported for this scope", 403);
  }
  if (command.allocationMode === "offline_block" && !command.deviceId) {
    throw new PlatformError("VALIDATION_FAILED", "Offline legal number allocation requires a device ID", 400);
  }
  required(command.allocationId, "allocationId");
  required(command.operationId, "operationId");
  const timestamp = new Date(command.allocatedAt);
  if (Number.isNaN(timestamp.getTime())) throw new PlatformError("VALIDATION_FAILED", "allocatedAt must be a timestamp", 400);

  const maximum = parseNonNegativeInteger(scope.maximumValue, "maximumValue");
  if (state.nextValue > maximum) throw new PlatformError("CONFLICT", "Legal number range is exhausted", 409);
  const formatted = legalNumber(scope, state.nextValue);
  if (state.allocations.some((allocation) => allocation.legalNumber === formatted || allocation.numericValue === state.nextValue.toString())) {
    throw new PlatformError("CONFLICT", "Legal number collision detected", 409);
  }

  const allocation: LegalNumberAllocationV1 = Object.freeze({
    allocationId: command.allocationId,
    scopeId: scope.scopeId,
    operationId: command.operationId,
    numericValue: state.nextValue.toString(),
    legalNumber: formatted,
    allocatedAt: timestamp.toISOString(),
    allocationMode: command.allocationMode,
    ...(command.deviceId ? { deviceId: command.deviceId } : {}),
  });
  const nextState: LegalNumberSequenceState = Object.freeze({
    scope,
    nextValue: state.nextValue + 1n,
    allocations: Object.freeze([...state.allocations, allocation]),
  });
  return Object.freeze({ state: nextState, allocation, replayed: false });
}

export function resolvePrivacyDisposition(
  policy: RetentionPolicyV1,
  requested: PrivacyOperationType,
  legalHold: boolean,
): PrivacyDisposition {
  required(policy.policyId, "policyId");
  required(policy.version, "policyVersion");
  required(policy.dataCategory, "dataCategory");
  required(policy.legalBasis, "legalBasis");
  if (!Number.isInteger(policy.retentionDays) || policy.retentionDays < 0) {
    throw new PlatformError("VALIDATION_FAILED", "Retention days must be a non-negative integer", 400);
  }
  businessDate(policy.effectiveFrom);
  if (policy.effectiveTo) businessDate(policy.effectiveTo);

  const preservationRequired = legalHold || policy.immutableEvidenceRequired;
  if (requested !== "erase" || !preservationRequired) {
    return Object.freeze({ requested, effective: requested, preserveImmutableEvidence: preservationRequired, allowed: true });
  }
  if (policy.anonymizationAllowed) {
    return Object.freeze({
      requested,
      effective: "anonymize",
      preserveImmutableEvidence: true,
      allowed: true,
      reason: "Erasure is converted to anonymization because immutable legal evidence must be retained",
    });
  }
  return Object.freeze({
    requested,
    effective: requested,
    preserveImmutableEvidence: true,
    allowed: false,
    reason: "Erasure is blocked by legal retention and anonymization is not permitted",
  });
}
