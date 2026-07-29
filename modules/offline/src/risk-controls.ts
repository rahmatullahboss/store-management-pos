export type OfflineProjectionKind =
  | "catalog"
  | "barcode"
  | "price"
  | "tax"
  | "promotion"
  | "permission"
  | "country_capability";

export interface ProjectionRequirement {
  readonly projection: OfflineProjectionKind;
  readonly requiredVersion: string;
  readonly localVersion?: string;
  readonly stalePolicy: "block" | "review";
}

export interface ProjectionFreshnessAssessment {
  readonly allowed: boolean;
  readonly reviewRequired: boolean;
  readonly stale: readonly {
    readonly projection: OfflineProjectionKind;
    readonly requiredVersion: string;
    readonly localVersion: string | null;
    readonly policy: "block" | "review";
  }[];
}

export function assessProjectionFreshness(
  requirements: readonly ProjectionRequirement[],
): ProjectionFreshnessAssessment {
  const seen = new Set<OfflineProjectionKind>();
  const stale: ProjectionFreshnessAssessment["stale"][number][] = [];

  for (const requirement of requirements) {
    if (seen.has(requirement.projection)) {
      throw new TypeError(`Projection ${requirement.projection} was supplied more than once`);
    }
    seen.add(requirement.projection);
    if (requirement.requiredVersion.trim().length === 0) {
      throw new TypeError(`Required ${requirement.projection} projection version is empty`);
    }
    if (requirement.localVersion !== requirement.requiredVersion) {
      stale.push(Object.freeze({
        projection: requirement.projection,
        requiredVersion: requirement.requiredVersion,
        localVersion: requirement.localVersion ?? null,
        policy: requirement.stalePolicy,
      }));
    }
  }

  return Object.freeze({
    allowed: !stale.some((entry) => entry.policy === "block"),
    reviewRequired: stale.some((entry) => entry.policy === "review"),
    stale: Object.freeze(stale),
  });
}

export interface OfflineStockClaim {
  readonly operationId: string;
  readonly deviceId: string;
  readonly registerId: string;
  readonly variantId: string;
  readonly quantity: bigint;
  readonly serverOrder: bigint;
  readonly localReceiptSnapshotId: string;
}

export interface OfflineStockOutcome {
  readonly operationId: string;
  readonly deviceId: string;
  readonly variantId: string;
  readonly state: "accepted" | "rejected";
  readonly quantity: bigint;
  readonly remainingQuantity: bigint;
  readonly reasonCode: "FINAL_UNIT_STOCK_CONFLICT" | "INSUFFICIENT_STOCK" | null;
  readonly localReceiptSnapshotId: string;
}

function required(value: string, field: string): void {
  if (value.trim().length === 0) throw new TypeError(`${field} is required`);
}

function claimKey(claim: Pick<OfflineStockClaim, "deviceId" | "operationId">): string {
  return `${claim.deviceId}:${claim.operationId}`;
}

export function reconcileOfflineStockClaims(
  claims: readonly OfflineStockClaim[],
  initialAvailability: ReadonlyMap<string, bigint>,
): readonly OfflineStockOutcome[] {
  const remaining = new Map(initialAvailability);
  for (const [variantId, quantity] of remaining) {
    required(variantId, "variantId");
    if (quantity < 0n) throw new RangeError(`Availability for ${variantId} cannot be negative`);
  }

  const keys = new Set<string>();
  const ordered = [...claims].sort((left, right) => {
    if (left.serverOrder !== right.serverOrder) return left.serverOrder < right.serverOrder ? -1 : 1;
    return claimKey(left).localeCompare(claimKey(right));
  });

  const outcomes: OfflineStockOutcome[] = [];
  for (const claim of ordered) {
    required(claim.operationId, "operationId");
    required(claim.deviceId, "deviceId");
    required(claim.registerId, "registerId");
    required(claim.variantId, "variantId");
    required(claim.localReceiptSnapshotId, "localReceiptSnapshotId");
    if (claim.quantity <= 0n) throw new RangeError("Offline stock claim quantity must be positive");
    if (claim.serverOrder < 0n) throw new RangeError("serverOrder cannot be negative");
    const key = claimKey(claim);
    if (keys.has(key)) throw new TypeError(`Offline stock claim ${key} is duplicated`);
    keys.add(key);

    const available = remaining.get(claim.variantId) ?? 0n;
    if (available >= claim.quantity) {
      const next = available - claim.quantity;
      remaining.set(claim.variantId, next);
      outcomes.push(Object.freeze({
        operationId: claim.operationId,
        deviceId: claim.deviceId,
        variantId: claim.variantId,
        state: "accepted",
        quantity: claim.quantity,
        remainingQuantity: next,
        reasonCode: null,
        localReceiptSnapshotId: claim.localReceiptSnapshotId,
      }));
      continue;
    }

    outcomes.push(Object.freeze({
      operationId: claim.operationId,
      deviceId: claim.deviceId,
      variantId: claim.variantId,
      state: "rejected",
      quantity: claim.quantity,
      remainingQuantity: available,
      reasonCode: claim.quantity === 1n && available === 0n
        ? "FINAL_UNIT_STOCK_CONFLICT"
        : "INSUFFICIENT_STOCK",
      localReceiptSnapshotId: claim.localReceiptSnapshotId,
    }));
  }

  return Object.freeze(outcomes);
}

export interface ReceiptAllocationScope {
  readonly tenantId: string;
  readonly storeId: string;
  readonly registerId: string;
  readonly deviceId: string;
}

export interface OfflineReceiptAllocation extends ReceiptAllocationScope {
  readonly allocationId: string;
  readonly prefix: string;
  readonly start: bigint;
  readonly end: bigint;
  readonly next: bigint;
  readonly expiresAt: string;
  readonly countryAllowsOfflineReceipt: boolean;
  readonly requiresOnlineFiscalization: boolean;
}

export interface AllocatedOfflineReceipt {
  readonly allocationId: string;
  readonly number: bigint;
  readonly receiptNumber: string;
  readonly remaining: bigint;
}

function sameScope(left: ReceiptAllocationScope, right: ReceiptAllocationScope): boolean {
  return left.tenantId === right.tenantId
    && left.storeId === right.storeId
    && left.registerId === right.registerId
    && left.deviceId === right.deviceId;
}

export class ScopedOfflineReceiptAllocator {
  readonly #allocation: Omit<OfflineReceiptAllocation, "next">;
  #next: bigint;

  constructor(allocation: OfflineReceiptAllocation) {
    for (const [field, value] of Object.entries({
      allocationId: allocation.allocationId,
      tenantId: allocation.tenantId,
      storeId: allocation.storeId,
      registerId: allocation.registerId,
      deviceId: allocation.deviceId,
      prefix: allocation.prefix,
      expiresAt: allocation.expiresAt,
    })) required(value, field);
    if (allocation.start < 0n || allocation.end < allocation.start) {
      throw new RangeError("Receipt allocation range is invalid");
    }
    if (allocation.next < allocation.start || allocation.next > allocation.end + 1n) {
      throw new RangeError("Receipt allocation cursor is outside its range");
    }
    if (!Number.isFinite(Date.parse(allocation.expiresAt))) {
      throw new TypeError("Receipt allocation expiry is invalid");
    }
    this.#next = allocation.next;
    this.#allocation = Object.freeze({
      allocationId: allocation.allocationId,
      tenantId: allocation.tenantId,
      storeId: allocation.storeId,
      registerId: allocation.registerId,
      deviceId: allocation.deviceId,
      prefix: allocation.prefix,
      start: allocation.start,
      end: allocation.end,
      expiresAt: allocation.expiresAt,
      countryAllowsOfflineReceipt: allocation.countryAllowsOfflineReceipt,
      requiresOnlineFiscalization: allocation.requiresOnlineFiscalization,
    });
  }

  allocate(scope: ReceiptAllocationScope, now: string): AllocatedOfflineReceipt {
    if (!sameScope(this.#allocation, scope)) {
      throw new TypeError("Receipt allocation is outside the current tenant/store/register/device scope");
    }
    const timestamp = Date.parse(now);
    if (!Number.isFinite(timestamp)) throw new TypeError("Receipt allocation time is invalid");
    if (timestamp >= Date.parse(this.#allocation.expiresAt)) {
      throw new TypeError("Receipt allocation has expired");
    }
    if (!this.#allocation.countryAllowsOfflineReceipt || this.#allocation.requiresOnlineFiscalization) {
      throw new TypeError("Country capability requires online receipt fiscalization");
    }
    if (this.#next > this.#allocation.end) {
      throw new RangeError("Offline receipt allocation is exhausted");
    }

    const number = this.#next;
    this.#next += 1n;
    return Object.freeze({
      allocationId: this.#allocation.allocationId,
      number,
      receiptNumber: `${this.#allocation.prefix}${number.toString()}`,
      remaining: this.#allocation.end - number,
    });
  }

  snapshot(): OfflineReceiptAllocation {
    return Object.freeze({ ...this.#allocation, next: this.#next });
  }
}
