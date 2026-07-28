import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { requirePermission } from "../../../packages/foundation/src/context.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";
import type { AuditMetadataV1, MoneyV1, QuantityV1, ScopeContextV1 } from "../../../packages/contracts/src/v1/common.js";
import type { DomainEventEnvelopeV1, PriceTaxSnapshotV1 } from "../../../packages/contracts/src/v1/contracts.js";
import type { SalesOrder, SalesDocumentLine } from "../../sales/src/index.js";
import type { FulfillmentDependencyPorts } from "./simulators.js";

export * from "./simulators.js";

export type FulfillmentPlanStatus = "allocated" | "in_progress" | "completed" | "cancelled";
export type FulfillmentAllocationStatus = "allocated" | "picking" | "picked" | "packed" | "ready_for_pickup" | "shipped" | "delivered" | "picked_up" | "cancelled";
export type FulfillmentMethod = "pickup" | "local_delivery" | "ship_from_store";
export type ReturnStatus = "requested" | "approved" | "rejected" | "received" | "completed";
export type ReturnCondition = "resalable" | "opened" | "damaged" | "defective" | "unknown";
export type ReturnDisposition = "restock" | "refurbish" | "quarantine" | "scrap" | "vendor_return";

export interface FulfillmentProof {
  readonly type: "signature" | "photo" | "identity_check" | "pin";
  readonly recipientName: string;
  readonly reference: string;
  readonly capturedAt: string;
}

export interface FulfillmentAllocation {
  readonly id: string;
  readonly orderLineId: string;
  readonly item: SalesDocumentLine["item"];
  readonly method: FulfillmentMethod;
  readonly warehouseId: string;
  readonly quantity: QuantityV1;
  readonly pickedQuantity?: QuantityV1;
  readonly packedQuantity?: QuantityV1;
  readonly packageReference?: string;
  readonly pickupCode?: string;
  readonly shipment?: { readonly carrier: string; readonly service: string; readonly trackingNumber: string; readonly shippedAt: string };
  readonly proof?: FulfillmentProof;
  readonly status: FulfillmentAllocationStatus;
  readonly updatedAt: string;
}

export interface FulfillmentPlan {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly storeId: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly reservationId: string;
  readonly allocations: readonly FulfillmentAllocation[];
  readonly status: FulfillmentPlanStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly version: bigint;
}

export interface OriginalPaymentAllocation {
  readonly paymentIntentId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
}

export interface ReturnLine {
  readonly id: string;
  readonly orderLineId: string;
  readonly item: SalesDocumentLine["item"];
  readonly quantity: QuantityV1;
  readonly originalQuantity: QuantityV1;
  readonly originalPriceTaxSnapshot: PriceTaxSnapshotV1;
  readonly expectedCondition: ReturnCondition;
  readonly proposedDisposition: ReturnDisposition;
  readonly actualCondition?: ReturnCondition;
  readonly disposition?: ReturnDisposition;
  readonly warehouseId?: string;
}

export interface RefundOrchestrationRecord {
  readonly refundId: string;
  readonly paymentIntentId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: "requested" | "completed";
  readonly reason: string;
}

export interface ExchangeOrchestrationRecord {
  readonly exchangeRequestId: string;
  readonly replacementOrderRequestId: string;
  readonly sourceReturnId: string;
  readonly sourceReturnLineId: string;
  readonly replacementVariantId: string;
  readonly quantity: QuantityV1;
  readonly status: "requested";
}

export interface ReturnAuthorization {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly storeId: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly reason: string;
  readonly lines: readonly ReturnLine[];
  readonly originalPaymentAllocations: readonly OriginalPaymentAllocation[];
  readonly status: ReturnStatus;
  readonly approval?: { readonly decision: "approved" | "rejected"; readonly reason: string; readonly approverId: string; readonly decidedAt: string; readonly policyOverrideApprovalId?: string };
  readonly refundRequests: readonly RefundOrchestrationRecord[];
  readonly exchangeRequests: readonly ExchangeOrchestrationRecord[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly version: bigint;
}

type IdempotencyRecord = { readonly hash: string; readonly kind: "plan" | "return"; readonly id: string };

export interface FulfillmentRepository {
  getPlan(tenantId: string, id: string): Promise<FulfillmentPlan | null>;
  savePlan(plan: FulfillmentPlan): Promise<void>;
  getReturn(tenantId: string, id: string): Promise<ReturnAuthorization | null>;
  saveReturn(authorization: ReturnAuthorization): Promise<void>;
  listReturnsByOrder(tenantId: string, orderId: string): Promise<readonly ReturnAuthorization[]>;
  getIdempotency(tenantId: string, scope: string, key: string): Promise<IdempotencyRecord | null>;
  putIdempotency(tenantId: string, scope: string, key: string, record: IdempotencyRecord): Promise<void>;
  appendOutbox(event: DomainEventEnvelopeV1): Promise<void>;
}

function clone<T>(value: T): T { return structuredClone(value); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested);
  }
  return value;
}
function output<T>(value: T): T { return freeze(clone(value)); }

export class InMemoryFulfillmentRepository implements FulfillmentRepository {
  private readonly plans = new Map<string, FulfillmentPlan>();
  private readonly returns = new Map<string, ReturnAuthorization>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  readonly outboxEvents: DomainEventEnvelopeV1[] = [];
  private key(tenantId: string, id: string): string { return `${tenantId}:${id}`; }
  private idemKey(tenantId: string, scope: string, key: string): string { return `${tenantId}:${scope}:${key}`; }
  async getPlan(tenantId: string, id: string): Promise<FulfillmentPlan | null> { const value = this.plans.get(this.key(tenantId, id)); return value ? clone(value) : null; }
  async savePlan(plan: FulfillmentPlan): Promise<void> { this.plans.set(this.key(plan.tenantId, plan.id), clone(plan)); }
  async getReturn(tenantId: string, id: string): Promise<ReturnAuthorization | null> { const value = this.returns.get(this.key(tenantId, id)); return value ? clone(value) : null; }
  async saveReturn(authorization: ReturnAuthorization): Promise<void> { this.returns.set(this.key(authorization.tenantId, authorization.id), clone(authorization)); }
  async listReturnsByOrder(tenantId: string, orderId: string): Promise<readonly ReturnAuthorization[]> { return [...this.returns.values()].filter((value) => value.tenantId === tenantId && value.orderId === orderId).map(clone); }
  async getIdempotency(tenantId: string, scope: string, key: string): Promise<IdempotencyRecord | null> { return this.idempotency.get(this.idemKey(tenantId, scope, key)) ?? null; }
  async putIdempotency(tenantId: string, scope: string, key: string, record: IdempotencyRecord): Promise<void> { this.idempotency.set(this.idemKey(tenantId, scope, key), clone(record)); }
  async appendOutbox(event: DomainEventEnvelopeV1): Promise<void> { this.outboxEvents.push(clone(event)); }
}

function stable(value: unknown): string {
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`).join(",")}}`;
  return JSON.stringify(value);
}

function quantityAmount(quantity: QuantityV1): bigint {
  if (!/^-?\d+$/u.test(quantity.amount)) throw new PlatformError("VALIDATION_FAILED", "Quantity amount must be an integer string", 400);
  const amount = BigInt(quantity.amount);
  if (amount <= 0n) throw new PlatformError("VALIDATION_FAILED", "Quantity must be positive", 400);
  return amount;
}

function negativeQuantity(quantity: QuantityV1): QuantityV1 { return { ...quantity, amount: `-${quantityAmount(quantity).toString()}` }; }
function scope(context: RequestContext, warehouseId?: string): ScopeContextV1 {
  if (!context.legalEntityId || !context.storeId) throw new PlatformError("VALIDATION_FAILED", "legalEntityId and storeId are required", 400);
  return {
    tenantId: context.tenantId,
    legalEntityId: context.legalEntityId,
    storeId: context.storeId,
    ...(warehouseId ? { warehouseId } : {}),
    actorId: context.actorId,
    ...(context.deviceId ? { deviceId: context.deviceId } : {}),
    locale: context.locale,
    timeZone: context.timeZone,
    businessDate: context.businessDate,
  };
}
function audit(context: RequestContext, reason?: string, approverId?: string): AuditMetadataV1 {
  return { actorId: context.actorId, ...(reason ? { reason } : {}), ...(approverId ? { approverId } : {}), requestId: context.requestId, traceId: context.traceId, ...(context.deviceId ? { deviceId: context.deviceId } : {}) };
}
function money(amountMinor: bigint, currency: string): MoneyV1 { return { amountMinor: amountMinor.toString(), currency, scale: 2 }; }
function assertVersion(actual: bigint, expected: bigint, label: string): void {
  if (actual !== expected) throw new PlatformError("VERSION_CONFLICT", `${label} version conflict: expected ${expected.toString()}, found ${actual.toString()}`, 409);
}
function derivePlanStatus(allocations: readonly FulfillmentAllocation[]): FulfillmentPlanStatus {
  if (allocations.every((item) => item.status === "cancelled")) return "cancelled";
  if (allocations.every((item) => ["delivered", "picked_up", "cancelled"].includes(item.status))) return "completed";
  if (allocations.some((item) => item.status !== "allocated")) return "in_progress";
  return "allocated";
}
function updateAllocation(plan: FulfillmentPlan, allocationId: string, updater: (allocation: FulfillmentAllocation) => FulfillmentAllocation, occurredAt: string, actorId: string): FulfillmentPlan {
  const allocation = plan.allocations.find((item) => item.id === allocationId);
  if (!allocation) throw new PlatformError("NOT_FOUND", "Fulfillment allocation not found", 404);
  const allocations = plan.allocations.map((item) => item.id === allocationId ? updater(item) : item);
  return { ...plan, allocations, status: derivePlanStatus(allocations), updatedAt: occurredAt, updatedBy: actorId, version: plan.version + 1n };
}

export class FulfillmentService {
  private readonly now: () => string;
  private readonly id: () => string;
  constructor(private readonly repository: FulfillmentRepository, private readonly dependencies: FulfillmentDependencyPorts, options: { readonly now?: () => string; readonly id?: () => string } = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => uuidV7());
  }

  async createPlan(context: RequestContext, input: { readonly idempotencyKey: string; readonly order: SalesOrder; readonly allocations: readonly { readonly orderLineId: string; readonly method: FulfillmentMethod; readonly warehouseId: string; readonly quantity: QuantityV1 }[] }): Promise<FulfillmentPlan> {
    requirePermission(context, "fulfillment.plan.create");
    const replay = await this.replay<FulfillmentPlan>(context, "fulfillment.plan.create", input.idempotencyKey, input);
    if (replay) return replay;
    if (input.order.tenantId !== context.tenantId) throw new PlatformError("NOT_FOUND", "Sales order not found", 404);
    if (input.allocations.length < 1) throw new PlatformError("VALIDATION_FAILED", "At least one fulfillment allocation is required", 400);
    for (const line of input.order.lines) {
      const allocated = input.allocations.filter((item) => item.orderLineId === line.id).reduce((sum, item) => sum + quantityAmount(item.quantity), 0n);
      if (allocated > quantityAmount(line.quantity)) throw new PlatformError("CONFLICT", "Fulfillment allocation cannot exceed ordered quantity", 409);
    }
    for (const allocation of input.allocations) if (!input.order.lines.some((line) => line.id === allocation.orderLineId)) throw new PlatformError("NOT_FOUND", "Order line not found for allocation", 404);
    const occurredAt = this.now();
    const { legalEntityId, storeId } = input.order;
    const plan: FulfillmentPlan = {
      id: this.id(), tenantId: context.tenantId, legalEntityId, storeId, orderId: input.order.id, orderNumber: input.order.documentNumber, reservationId: input.order.reservationId,
      allocations: input.allocations.map((allocation) => {
        const line = input.order.lines.find((candidate) => candidate.id === allocation.orderLineId)!;
        return { id: this.id(), orderLineId: line.id, item: clone(line.item), method: allocation.method, warehouseId: allocation.warehouseId, quantity: clone(allocation.quantity), status: "allocated", updatedAt: occurredAt };
      }),
      status: "allocated", createdAt: occurredAt, updatedAt: occurredAt, createdBy: context.actorId, updatedBy: context.actorId, version: 1n,
    };
    await this.repository.savePlan(plan);
    await this.remember(context, "fulfillment.plan.create", input.idempotencyKey, input, "plan", plan.id);
    await this.event(context, "fulfillment.plan.created.v1", "fulfillment_plan", plan.id, plan.version, { orderId: plan.orderId, allocationCount: plan.allocations.length });
    return output(plan);
  }

  async getPlan(context: RequestContext, planId: string): Promise<FulfillmentPlan> { requirePermission(context, "fulfillment.read"); return output(await this.requirePlan(context.tenantId, planId)); }

  async startPicking(context: RequestContext, input: { readonly planId: string; readonly allocationId: string; readonly expectedVersion: bigint }): Promise<FulfillmentPlan> {
    requirePermission(context, "fulfillment.pick");
    const plan = await this.requirePlan(context.tenantId, input.planId); assertVersion(plan.version, input.expectedVersion, "Fulfillment plan");
    const occurredAt = this.now();
    const updated = updateAllocation(plan, input.allocationId, (allocation) => {
      if (allocation.status !== "allocated") throw new PlatformError("CONFLICT", "Only allocated work can start picking", 409);
      return { ...allocation, status: "picking", updatedAt: occurredAt };
    }, occurredAt, context.actorId);
    await this.savePlanEvent(context, updated, "fulfillment.picking.started.v1", input.allocationId); return output(updated);
  }

  async confirmPick(context: RequestContext, input: { readonly planId: string; readonly allocationId: string; readonly quantity: QuantityV1; readonly expectedVersion: bigint }): Promise<FulfillmentPlan> {
    requirePermission(context, "fulfillment.pick");
    const plan = await this.requirePlan(context.tenantId, input.planId); assertVersion(plan.version, input.expectedVersion, "Fulfillment plan");
    const occurredAt = this.now();
    const updated = updateAllocation(plan, input.allocationId, (allocation) => {
      if (allocation.status !== "picking") throw new PlatformError("CONFLICT", "Allocation must be picking before confirmation", 409);
      if (quantityAmount(input.quantity) > quantityAmount(allocation.quantity)) throw new PlatformError("CONFLICT", "Picked quantity cannot exceed allocated quantity", 409);
      return { ...allocation, pickedQuantity: clone(input.quantity), status: "picked", updatedAt: occurredAt };
    }, occurredAt, context.actorId);
    await this.savePlanEvent(context, updated, "fulfillment.pick.confirmed.v1", input.allocationId); return output(updated);
  }

  async pack(context: RequestContext, input: { readonly planId: string; readonly allocationId: string; readonly quantity: QuantityV1; readonly packageReference: string; readonly expectedVersion: bigint }): Promise<FulfillmentPlan> {
    requirePermission(context, "fulfillment.pack");
    const plan = await this.requirePlan(context.tenantId, input.planId); assertVersion(plan.version, input.expectedVersion, "Fulfillment plan");
    const occurredAt = this.now();
    const updated = updateAllocation(plan, input.allocationId, (allocation) => {
      if (allocation.status !== "picked" || !allocation.pickedQuantity) throw new PlatformError("CONFLICT", "Allocation must be picked before packing", 409);
      if (quantityAmount(input.quantity) > quantityAmount(allocation.pickedQuantity)) throw new PlatformError("CONFLICT", "Packed quantity cannot exceed picked quantity", 409);
      return { ...allocation, packedQuantity: clone(input.quantity), packageReference: input.packageReference.trim(), status: "packed", updatedAt: occurredAt };
    }, occurredAt, context.actorId);
    await this.savePlanEvent(context, updated, "fulfillment.package.packed.v1", input.allocationId); return output(updated);
  }

  async markReadyForPickup(context: RequestContext, input: { readonly planId: string; readonly allocationId: string; readonly pickupCode: string; readonly expectedVersion: bigint }): Promise<FulfillmentPlan> {
    requirePermission(context, "fulfillment.pickup");
    const plan = await this.requirePlan(context.tenantId, input.planId); assertVersion(plan.version, input.expectedVersion, "Fulfillment plan");
    const occurredAt = this.now();
    const updated = updateAllocation(plan, input.allocationId, (allocation) => {
      if (allocation.method !== "pickup" || allocation.status !== "picked") throw new PlatformError("CONFLICT", "Pickup allocation must be picked before it is ready", 409);
      if (!/^\d{6}$/u.test(input.pickupCode)) throw new PlatformError("VALIDATION_FAILED", "Pickup code must contain six digits", 400);
      return { ...allocation, pickupCode: input.pickupCode, status: "ready_for_pickup", updatedAt: occurredAt };
    }, occurredAt, context.actorId);
    await this.savePlanEvent(context, updated, "fulfillment.pickup.ready.v1", input.allocationId); return output(updated);
  }

  async ship(context: RequestContext, input: { readonly planId: string; readonly allocationId: string; readonly carrier: string; readonly service: string; readonly trackingNumber: string; readonly expectedVersion: bigint }): Promise<FulfillmentPlan> {
    requirePermission(context, "fulfillment.ship");
    const plan = await this.requirePlan(context.tenantId, input.planId); assertVersion(plan.version, input.expectedVersion, "Fulfillment plan");
    const allocation = plan.allocations.find((item) => item.id === input.allocationId);
    if (!allocation) throw new PlatformError("NOT_FOUND", "Fulfillment allocation not found", 404);
    if (allocation.status !== "packed" || !allocation.packedQuantity) throw new PlatformError("CONFLICT", "Allocation must be packed before shipping", 409);
    const occurredAt = this.now();
    await this.postIssue(context, plan, allocation, allocation.packedQuantity, "sale_issue");
    const updated = updateAllocation(plan, input.allocationId, (item) => ({ ...item, shipment: { carrier: input.carrier.trim(), service: input.service.trim(), trackingNumber: input.trackingNumber.trim(), shippedAt: occurredAt }, status: "shipped", updatedAt: occurredAt }), occurredAt, context.actorId);
    await this.savePlanEvent(context, updated, "fulfillment.shipment.shipped.v1", input.allocationId); return output(updated);
  }

  async deliver(context: RequestContext, input: { readonly planId: string; readonly allocationId: string; readonly proof: FulfillmentProof; readonly expectedVersion: bigint }): Promise<FulfillmentPlan> {
    requirePermission(context, "fulfillment.deliver");
    const plan = await this.requirePlan(context.tenantId, input.planId); assertVersion(plan.version, input.expectedVersion, "Fulfillment plan");
    const occurredAt = this.now();
    const updated = updateAllocation(plan, input.allocationId, (allocation) => {
      if (allocation.status !== "shipped") throw new PlatformError("CONFLICT", "Allocation must be shipped before delivery", 409);
      return { ...allocation, proof: clone(input.proof), status: "delivered", updatedAt: occurredAt };
    }, occurredAt, context.actorId);
    await this.savePlanEvent(context, updated, "fulfillment.delivery.completed.v1", input.allocationId); return output(updated);
  }

  async confirmPickup(context: RequestContext, input: { readonly planId: string; readonly allocationId: string; readonly pickupCode: string; readonly proof: FulfillmentProof; readonly expectedVersion: bigint }): Promise<FulfillmentPlan> {
    requirePermission(context, "fulfillment.pickup");
    const plan = await this.requirePlan(context.tenantId, input.planId); assertVersion(plan.version, input.expectedVersion, "Fulfillment plan");
    const allocation = plan.allocations.find((item) => item.id === input.allocationId);
    if (!allocation) throw new PlatformError("NOT_FOUND", "Fulfillment allocation not found", 404);
    if (allocation.status !== "ready_for_pickup" || allocation.pickupCode !== input.pickupCode) throw new PlatformError("CONFLICT", "Pickup allocation or code is invalid", 409);
    await this.postIssue(context, plan, allocation, allocation.pickedQuantity ?? allocation.quantity, "sale_issue");
    const occurredAt = this.now();
    const updated = updateAllocation(plan, input.allocationId, (item) => ({ ...item, proof: clone(input.proof), status: "picked_up", updatedAt: occurredAt }), occurredAt, context.actorId);
    await this.savePlanEvent(context, updated, "fulfillment.pickup.completed.v1", input.allocationId); return output(updated);
  }

  async requestReturn(context: RequestContext, input: { readonly idempotencyKey: string; readonly order: SalesOrder; readonly reason: string; readonly lines: readonly { readonly orderLineId: string; readonly quantity: QuantityV1; readonly expectedCondition: ReturnCondition; readonly proposedDisposition: ReturnDisposition }[]; readonly originalPaymentAllocations: readonly OriginalPaymentAllocation[]; readonly policyOverrideApprovalId?: string }): Promise<ReturnAuthorization> {
    requirePermission(context, "return.request");
    const replay = await this.replay<ReturnAuthorization>(context, "return.request", input.idempotencyKey, input); if (replay) return replay;
    if (input.order.tenantId !== context.tenantId) throw new PlatformError("NOT_FOUND", "Sales order not found", 404);
    if (input.lines.length < 1) throw new PlatformError("VALIDATION_FAILED", "At least one return line is required", 400);
    const existing = (await this.repository.listReturnsByOrder(context.tenantId, input.order.id)).filter((item) => item.status !== "rejected");
    for (const requestLine of input.lines) {
      const orderLine = input.order.lines.find((line) => line.id === requestLine.orderLineId);
      if (!orderLine) throw new PlatformError("NOT_FOUND", "Order line not found", 404);
      const alreadyRequested = existing.flatMap((item) => item.lines).filter((line) => line.orderLineId === orderLine.id).reduce((sum, line) => sum + quantityAmount(line.quantity), 0n);
      if (alreadyRequested + quantityAmount(requestLine.quantity) > quantityAmount(orderLine.quantity)) {
        if (!input.policyOverrideApprovalId) throw new PlatformError("CONFLICT", "Cumulative returned quantity cannot exceed the original order quantity", 409);
        requirePermission(context, "return.override_policy");
      }
    }
    const occurredAt = this.now();
    const authorization: ReturnAuthorization = {
      id: this.id(), tenantId: context.tenantId, legalEntityId: input.order.legalEntityId, storeId: input.order.storeId, orderId: input.order.id, orderNumber: input.order.documentNumber, reason: input.reason.trim(),
      lines: input.lines.map((requestLine) => {
        const orderLine = input.order.lines.find((line) => line.id === requestLine.orderLineId)!;
        return { id: this.id(), orderLineId: orderLine.id, item: clone(orderLine.item), quantity: clone(requestLine.quantity), originalQuantity: clone(orderLine.quantity), originalPriceTaxSnapshot: clone(orderLine.priceTaxSnapshot), expectedCondition: requestLine.expectedCondition, proposedDisposition: requestLine.proposedDisposition };
      }),
      originalPaymentAllocations: input.originalPaymentAllocations.map((allocation) => ({ ...allocation, currency: allocation.currency.toUpperCase() })),
      status: "requested", refundRequests: [], exchangeRequests: [], createdAt: occurredAt, updatedAt: occurredAt, createdBy: context.actorId, updatedBy: context.actorId, version: 1n,
    };
    await this.repository.saveReturn(authorization); await this.remember(context, "return.request", input.idempotencyKey, input, "return", authorization.id);
    await this.event(context, "sales.return.requested.v1", "return", authorization.id, authorization.version, { orderId: authorization.orderId, lineCount: authorization.lines.length }); return output(authorization);
  }

  async approveReturn(context: RequestContext, input: { readonly returnId: string; readonly expectedVersion: bigint; readonly decision: "approved" | "rejected"; readonly reason: string; readonly policyOverrideApprovalId?: string }): Promise<ReturnAuthorization> {
    requirePermission(context, "return.approve");
    const authorization = await this.requireReturn(context.tenantId, input.returnId); assertVersion(authorization.version, input.expectedVersion, "Return");
    if (authorization.status !== "requested") throw new PlatformError("CONFLICT", "Only requested returns can be decided", 409);
    if (input.policyOverrideApprovalId) requirePermission(context, "return.override_policy");
    const occurredAt = this.now();
    const updated: ReturnAuthorization = { ...authorization, status: input.decision === "approved" ? "approved" : "rejected", approval: { decision: input.decision, reason: input.reason.trim(), approverId: context.actorId, decidedAt: occurredAt, ...(input.policyOverrideApprovalId ? { policyOverrideApprovalId: input.policyOverrideApprovalId } : {}) }, updatedAt: occurredAt, updatedBy: context.actorId, version: authorization.version + 1n };
    await this.repository.saveReturn(updated); await this.event(context, `sales.return.${input.decision}.v1`, "return", updated.id, updated.version, { orderId: updated.orderId, reason: input.reason }); return output(updated);
  }

  async receiveReturn(context: RequestContext, input: { readonly returnId: string; readonly expectedVersion: bigint; readonly receivedLines: readonly { readonly returnLineId: string; readonly actualCondition: ReturnCondition; readonly disposition: ReturnDisposition; readonly warehouseId: string }[] }): Promise<ReturnAuthorization> {
    requirePermission(context, "return.receive");
    const authorization = await this.requireReturn(context.tenantId, input.returnId); assertVersion(authorization.version, input.expectedVersion, "Return");
    if (authorization.status === "completed") throw new PlatformError("CONFLICT", "Completed returns are immutable", 409);
    if (authorization.status !== "approved") throw new PlatformError("CONFLICT", "Return must be approved before receiving", 409);
    if (input.receivedLines.length !== authorization.lines.length) throw new PlatformError("VALIDATION_FAILED", "Every approved return line must be received or explicitly rejected", 400);
    const occurredAt = this.now();
    const lines = authorization.lines.map((line) => {
      const received = input.receivedLines.find((candidate) => candidate.returnLineId === line.id);
      if (!received) throw new PlatformError("NOT_FOUND", "Received return line not found", 404);
      return { ...line, actualCondition: received.actualCondition, disposition: received.disposition, warehouseId: received.warehouseId };
    });
    await this.dependencies.inventory.post({ schemaVersion: "1.0", context: scope(context, lines[0]?.warehouseId), operationId: this.id(), postingGroupId: this.id(), movementType: "customer_return", lines: lines.map((line) => ({ item: clone(line.item), warehouseId: line.warehouseId!, quantityDelta: clone(line.quantity), sourceDocumentId: authorization.id, sourceDocumentLineId: line.id })), audit: audit(context, "Receive approved customer return") });
    const updated: ReturnAuthorization = { ...authorization, lines, status: "received", updatedAt: occurredAt, updatedBy: context.actorId, version: authorization.version + 1n };
    await this.repository.saveReturn(updated); await this.event(context, "sales.return.received.v1", "return", updated.id, updated.version, { orderId: updated.orderId }); return output(updated);
  }

  async resolveReturn(context: RequestContext, input: { readonly returnId: string; readonly expectedVersion: bigint; readonly idempotencyKey: string; readonly resolutions: readonly ({ readonly type: "refund"; readonly paymentIntentId: string; readonly amountMinor: bigint; readonly currency: string; readonly reason: string } | { readonly type: "exchange"; readonly returnLineId: string; readonly replacementVariantId: string; readonly quantity: QuantityV1 })[] }): Promise<ReturnAuthorization> {
    requirePermission(context, "return.resolve");
    const replay = await this.replay<ReturnAuthorization>(context, "return.resolve", input.idempotencyKey, input); if (replay) return replay;
    const authorization = await this.requireReturn(context.tenantId, input.returnId); assertVersion(authorization.version, input.expectedVersion, "Return");
    if (authorization.status !== "received") throw new PlatformError("CONFLICT", "Return must be received before resolution", 409);
    const refunds: RefundOrchestrationRecord[] = [];
    const exchanges: ExchangeOrchestrationRecord[] = [];
    for (const resolution of input.resolutions) {
      if (resolution.type === "refund") {
        const allocation = authorization.originalPaymentAllocations.find((item) => item.paymentIntentId === resolution.paymentIntentId && item.currency === resolution.currency.toUpperCase());
        if (!allocation || resolution.amountMinor > allocation.amountMinor) throw new PlatformError("CONFLICT", "Refund cannot exceed the named original payment allocation", 409);
        const refundId = this.id();
        const result = await this.dependencies.refunds.requestRefund({ schemaVersion: "1.0", context: scope(context), refundId, paymentIntentId: resolution.paymentIntentId, amount: money(resolution.amountMinor, resolution.currency.toUpperCase()), reason: resolution.reason, idempotencyKey: `${input.idempotencyKey}:${resolution.paymentIntentId}`, audit: audit(context, resolution.reason) });
        refunds.push({ refundId, paymentIntentId: resolution.paymentIntentId, amountMinor: resolution.amountMinor, currency: resolution.currency.toUpperCase(), status: result.status, reason: resolution.reason });
      } else {
        const line = authorization.lines.find((item) => item.id === resolution.returnLineId); if (!line) throw new PlatformError("NOT_FOUND", "Return line not found", 404);
        if (quantityAmount(resolution.quantity) > quantityAmount(line.quantity)) throw new PlatformError("CONFLICT", "Exchange quantity cannot exceed returned quantity", 409);
        const exchangeRequestId = this.id();
        const result = await this.dependencies.exchange.createReplacement({ schemaVersion: "1.0", context: scope(context, line.warehouseId), exchangeRequestId, sourceReturnId: authorization.id, sourceReturnLineId: line.id, replacementVariantId: resolution.replacementVariantId, quantity: clone(resolution.quantity), idempotencyKey: `${input.idempotencyKey}:${line.id}` });
        exchanges.push({ exchangeRequestId, replacementOrderRequestId: result.replacementOrderRequestId, sourceReturnId: authorization.id, sourceReturnLineId: line.id, replacementVariantId: resolution.replacementVariantId, quantity: clone(resolution.quantity), status: "requested" });
      }
    }
    const occurredAt = this.now();
    const updated: ReturnAuthorization = { ...authorization, refundRequests: [...authorization.refundRequests, ...refunds], exchangeRequests: [...authorization.exchangeRequests, ...exchanges], status: "completed", updatedAt: occurredAt, updatedBy: context.actorId, version: authorization.version + 1n };
    await this.repository.saveReturn(updated); await this.remember(context, "return.resolve", input.idempotencyKey, input, "return", updated.id);
    await this.event(context, "sales.return.completed.v1", "return", updated.id, updated.version, { orderId: updated.orderId, refunds: refunds.length, exchanges: exchanges.length }); return output(updated);
  }

  private async postIssue(context: RequestContext, plan: FulfillmentPlan, allocation: FulfillmentAllocation, quantity: QuantityV1, movementType: string): Promise<void> {
    await this.dependencies.inventory.post({ schemaVersion: "1.0", context: scope(context, allocation.warehouseId), operationId: this.id(), postingGroupId: this.id(), movementType, lines: [{ item: clone(allocation.item), warehouseId: allocation.warehouseId, quantityDelta: negativeQuantity(quantity), sourceDocumentId: plan.orderId, sourceDocumentLineId: allocation.orderLineId }], audit: audit(context, `Fulfillment ${allocation.method}`) });
  }
  private async savePlanEvent(context: RequestContext, plan: FulfillmentPlan, eventType: string, allocationId: string): Promise<void> { await this.repository.savePlan(plan); await this.event(context, eventType, "fulfillment_plan", plan.id, plan.version, { orderId: plan.orderId, allocationId, status: plan.status }); }
  private async replay<T>(context: RequestContext, scopeName: string, key: string, payload: unknown): Promise<T | null> {
    if (key.trim().length < 8) throw new PlatformError("VALIDATION_FAILED", "idempotencyKey must contain at least 8 characters", 400);
    const record = await this.repository.getIdempotency(context.tenantId, scopeName, key); if (!record) return null;
    if (record.hash !== stable(payload)) throw new PlatformError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with a different fulfillment payload", 409);
    return output(record.kind === "plan" ? await this.requirePlan(context.tenantId, record.id) : await this.requireReturn(context.tenantId, record.id)) as T;
  }
  private async remember(context: RequestContext, scopeName: string, key: string, payload: unknown, kind: IdempotencyRecord["kind"], id: string): Promise<void> { await this.repository.putIdempotency(context.tenantId, scopeName, key, { hash: stable(payload), kind, id }); }
  private async requirePlan(tenantId: string, id: string): Promise<FulfillmentPlan> { const value = await this.repository.getPlan(tenantId, id); if (!value) throw new PlatformError("NOT_FOUND", "Fulfillment plan not found", 404); return value; }
  private async requireReturn(tenantId: string, id: string): Promise<ReturnAuthorization> { const value = await this.repository.getReturn(tenantId, id); if (!value) throw new PlatformError("NOT_FOUND", "Return authorization not found", 404); return value; }
  private async event(context: RequestContext, eventType: string, aggregateType: string, aggregateId: string, version: bigint, payload: Readonly<Record<string, unknown>>): Promise<void> {
    await this.repository.appendOutbox({ schemaVersion: "1.0", eventId: this.id(), eventType, aggregateType, aggregateId, tenantId: context.tenantId, occurredAt: this.now(), businessDate: context.businessDate, correlationId: context.requestId, actorId: context.actorId, payload, metadata: { traceId: context.traceId, version: version.toString(), ...(context.legalEntityId ? { legalEntityId: context.legalEntityId } : {}), ...(context.storeId ? { storeId: context.storeId } : {}) } });
  }
}
