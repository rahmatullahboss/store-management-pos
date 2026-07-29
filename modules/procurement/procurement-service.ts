import type { AccountingPostingInstructionV1, AuditMetadataV1, MoneyV1, QuantityV1, ScopeContextV1 } from "../../packages/contracts/src/v1/index.js";
import { PlatformError } from "../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../packages/foundation/src/ids.js";
import type { InventoryService } from "../inventory/inventory-service.js";
import type { StockPostingLine, StockStatus } from "../inventory/types.js";
import type {
  GoodsReceipt,
  GoodsReceiptLine,
  LandedCostAllocation,
  LandedCostDocument,
  ProcurementEvent,
  PurchaseOrder,
  PurchaseOrderCreateCommand,
  PurchaseOrderLine,
  PurchaseRequisition,
  PurchaseRequisitionLine,
  ReorderPolicy,
  ReplenishmentProposal,
  Supplier,
  SupplierBillReference,
  SupplierContact,
  SupplierItem,
  SupplierReturn,
  SupplierReturnLine,
  ThreeWayMatchResult,
} from "./types.js";

export interface ProcurementServiceOptions {
  readonly now?: () => Date;
  readonly idFactory?: () => string;
  readonly onEvent?: (event: ProcurementEvent) => void;
}

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/u;
const INTEGER_PATTERN = /^-?\d+$/u;

function key(...parts: readonly string[]): string {
  return parts.join("::");
}

function optional<K extends string, T>(value: T | undefined, property: K): { [P in K]?: T } {
  return (value === undefined ? {} : { [property]: value }) as { [P in K]?: T };
}

function scaleFactor(scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) throw new PlatformError("VALIDATION_FAILED", "Scale must be between 0 and 18", 400);
  return 10n ** BigInt(scale);
}

function parseQuantity(quantity: QuantityV1): bigint {
  const raw = quantity.amount.trim();
  if (!DECIMAL_PATTERN.test(raw)) throw new PlatformError("VALIDATION_FAILED", "Quantity must be an exact decimal string", 400);
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (fraction.length > quantity.scale) throw new PlatformError("VALIDATION_FAILED", "Quantity precision exceeds scale", 400);
  const normalized = `${whole}${fraction.padEnd(quantity.scale, "0")}`.replace(/^0+(?=\d)/u, "");
  const value = BigInt(normalized || "0");
  return negative ? -value : value;
}

function formatQuantity(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const raw = absolute.toString().padStart(scale + 1, "0");
  const whole = raw.slice(0, -scale);
  const fraction = raw.slice(-scale).replace(/0+$/u, "");
  const result = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return negative ? `-${result}` : result;
}

function parseMoney(money: MoneyV1): bigint {
  if (!INTEGER_PATTERN.test(money.amountMinor)) throw new PlatformError("VALIDATION_FAILED", "Money amount must be an integer minor-unit string", 400);
  return BigInt(money.amountMinor);
}

function money(amountMinor: bigint, currency: string, scale = 2): MoneyV1 {
  return { amountMinor: amountMinor.toString(), currency, scale };
}

function multiplyMoney(unitCost: MoneyV1, quantity: QuantityV1): bigint {
  return parseMoney(unitCost) * parseQuantity(quantity) / scaleFactor(quantity.scale);
}

function assertCurrency(moneyValue: MoneyV1, currency: string, field: string): void {
  if (moneyValue.currency !== currency) throw new PlatformError("VALIDATION_FAILED", `${field} currency must match document currency`, 400);
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new PlatformError("VALIDATION_FAILED", `${field} is required`, 400);
  return normalized;
}

function cloneSupplier(value: Supplier): Supplier { return { ...value }; }
function cloneRequisition(value: PurchaseRequisition): PurchaseRequisition { return { ...value, lines: value.lines.map((line) => ({ ...line, item: { ...line.item }, quantity: { ...line.quantity }, ...optional(line.estimatedUnitCost === undefined ? undefined : { ...line.estimatedUnitCost }, "estimatedUnitCost") })) }; }
function clonePurchaseOrder(value: PurchaseOrder): PurchaseOrder { return { ...value, lines: value.lines.map((line) => ({ ...line, item: { ...line.item }, quantity: { ...line.quantity }, unitCost: { ...line.unitCost } })) }; }
function cloneReceipt(value: GoodsReceipt): GoodsReceipt { return { ...value, lines: value.lines.map((line) => ({ ...line, item: { ...line.item }, receivedQuantity: { ...line.receivedQuantity }, unitCost: { ...line.unitCost }, serialIds: [...line.serialIds], stockLedgerEntryIds: [...line.stockLedgerEntryIds] })) }; }
function cloneReturn(value: SupplierReturn): SupplierReturn { return { ...value, lines: value.lines.map((line) => ({ ...line, item: { ...line.item }, quantity: { ...line.quantity }, unitCost: { ...line.unitCost }, stockLedgerEntryIds: [...line.stockLedgerEntryIds] })) }; }
function cloneLandedCost(value: LandedCostDocument): LandedCostDocument { return { ...value, total: { ...value.total }, allocations: value.allocations.map((allocation) => ({ ...allocation, amount: { ...allocation.amount } })) }; }

export class ProcurementService {
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly onEvent: ((event: ProcurementEvent) => void) | undefined;
  private readonly suppliers = new Map<string, Supplier>();
  private readonly contacts = new Map<string, SupplierContact>();
  private readonly supplierItems = new Map<string, SupplierItem>();
  private readonly requisitions = new Map<string, PurchaseRequisition>();
  private readonly purchaseOrders = new Map<string, PurchaseOrder>();
  private readonly receipts = new Map<string, GoodsReceipt>();
  private readonly supplierReturns = new Map<string, SupplierReturn>();
  private readonly supplierBills = new Map<string, SupplierBillReference>();
  private readonly matchResults = new Map<string, ThreeWayMatchResult>();
  private readonly landedCosts = new Map<string, LandedCostDocument>();
  private readonly reorderPolicies = new Map<string, ReorderPolicy>();
  private readonly events: ProcurementEvent[] = [];

  constructor(private readonly inventory: InventoryService, options: ProcurementServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => uuidV7());
    this.onEvent = options.onEvent;
  }

  createSupplier(input: Omit<Supplier, "createdAt" | "updatedAt" | "version">): Supplier {
    const recordKey = key(input.tenantId, input.id);
    if (this.suppliers.has(recordKey)) throw new PlatformError("CONFLICT", "Supplier already exists", 409);
    const code = nonEmpty(input.code, "supplier code").toUpperCase();
    if ([...this.suppliers.values()].some((supplier) => supplier.tenantId === input.tenantId && supplier.code === code)) throw new PlatformError("CONFLICT", "Supplier code already exists", 409);
    if (!/^[A-Z]{3}$/u.test(input.currency)) throw new PlatformError("VALIDATION_FAILED", "Supplier currency must be ISO 4217", 400);
    if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || input.paymentTermsDays > 3650) throw new PlatformError("VALIDATION_FAILED", "Supplier payment terms are invalid", 400);
    if (!Number.isInteger(input.leadTimeDays) || input.leadTimeDays < 0 || input.leadTimeDays > 3650) throw new PlatformError("VALIDATION_FAILED", "Supplier lead time is invalid", 400);
    const timestamp = this.now().toISOString();
    const supplier: Supplier = {
      ...input,
      code,
      legalName: nonEmpty(input.legalName, "supplier legal name"),
      displayName: nonEmpty(input.displayName, "supplier display name"),
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.suppliers.set(recordKey, supplier);
    this.emit(input.tenantId, "procurement.supplier.created.v1", "supplier", input.id, input.id, { code }, this.today());
    return cloneSupplier(supplier);
  }

  updateSupplier(input: { readonly tenantId: string; readonly supplierId: string; readonly expectedVersion: number; readonly patch: Partial<Pick<Supplier, "displayName" | "status" | "paymentTermsDays" | "leadTimeDays" | "email" | "phone">>; readonly actorId: string }): Supplier {
    const recordKey = key(input.tenantId, input.supplierId);
    const supplier = this.requireSupplier(input.tenantId, input.supplierId);
    if (supplier.version !== input.expectedVersion) throw new PlatformError("VERSION_CONFLICT", "Supplier was modified by another operation", 409);
    const updated: Supplier = {
      ...supplier,
      ...input.patch,
      ...(input.patch.displayName === undefined ? {} : { displayName: nonEmpty(input.patch.displayName, "supplier display name") }),
      updatedAt: this.now().toISOString(),
      version: supplier.version + 1,
    };
    this.suppliers.set(recordKey, updated);
    this.emit(input.tenantId, "procurement.supplier.updated.v1", "supplier", input.supplierId, input.actorId, { version: updated.version }, this.today());
    return cloneSupplier(updated);
  }

  addSupplierContact(input: SupplierContact): SupplierContact {
    this.requireSupplier(input.tenantId, input.supplierId);
    const recordKey = key(input.tenantId, input.id);
    if (this.contacts.has(recordKey)) throw new PlatformError("CONFLICT", "Supplier contact already exists", 409);
    const contact = { ...input, name: nonEmpty(input.name, "supplier contact name") };
    if (contact.primary) {
      for (const [contactKey, existing] of this.contacts) {
        if (existing.tenantId === input.tenantId && existing.supplierId === input.supplierId && existing.primary) this.contacts.set(contactKey, { ...existing, primary: false });
      }
    }
    this.contacts.set(recordKey, contact);
    return { ...contact };
  }

  mapSupplierItem(input: SupplierItem): SupplierItem {
    this.requireSupplier(input.tenantId, input.supplierId);
    const recordKey = key(input.tenantId, input.id);
    if (this.supplierItems.has(recordKey)) throw new PlatformError("CONFLICT", "Supplier item mapping already exists", 409);
    if (parseQuantity(input.minimumOrderQuantity) < 0n || parseQuantity(input.packQuantity) <= 0n) throw new PlatformError("VALIDATION_FAILED", "Supplier item quantities are invalid", 400);
    if ([...this.supplierItems.values()].some((item) => item.tenantId === input.tenantId && item.supplierId === input.supplierId && item.supplierSku === input.supplierSku)) throw new PlatformError("CONFLICT", "Supplier SKU already exists for this supplier", 409);
    const item: SupplierItem = {
      ...input,
      supplierSku: nonEmpty(input.supplierSku, "supplier SKU"),
      minimumOrderQuantity: { ...input.minimumOrderQuantity },
      packQuantity: { ...input.packQuantity },
      ...optional(input.lastQuotedUnitCost === undefined ? undefined : { ...input.lastQuotedUnitCost }, "lastQuotedUnitCost"),
    };
    this.supplierItems.set(recordKey, item);
    return { ...item, minimumOrderQuantity: { ...item.minimumOrderQuantity }, packQuantity: { ...item.packQuantity }, ...optional(item.lastQuotedUnitCost === undefined ? undefined : { ...item.lastQuotedUnitCost }, "lastQuotedUnitCost") };
  }

  listSuppliers(tenantId: string): readonly Supplier[] {
    return [...this.suppliers.values()].filter((supplier) => supplier.tenantId === tenantId).map(cloneSupplier);
  }

  createRequisition(input: { readonly id: string; readonly context: ScopeContextV1; readonly lines: readonly PurchaseRequisitionLine[] }): PurchaseRequisition {
    if (input.context.legalEntityId === undefined) throw new PlatformError("VALIDATION_FAILED", "Legal entity context is required", 400);
    if (input.lines.length === 0) throw new PlatformError("VALIDATION_FAILED", "Purchase requisition requires at least one line", 400);
    const recordKey = key(input.context.tenantId, input.id);
    if (this.requisitions.has(recordKey)) throw new PlatformError("CONFLICT", "Purchase requisition already exists", 409);
    for (const line of input.lines) {
      if (parseQuantity(line.quantity) <= 0n) throw new PlatformError("VALIDATION_FAILED", "Requisition quantity must be positive", 400);
      nonEmpty(line.reason, "requisition reason");
      if (line.preferredSupplierId !== undefined) this.requireSupplier(input.context.tenantId, line.preferredSupplierId);
    }
    const timestamp = this.now().toISOString();
    const requisition: PurchaseRequisition = {
      id: input.id,
      tenantId: input.context.tenantId,
      legalEntityId: input.context.legalEntityId,
      state: "draft",
      lines: input.lines.map((line) => ({ ...line, item: { ...line.item }, quantity: { ...line.quantity }, ...optional(line.estimatedUnitCost === undefined ? undefined : { ...line.estimatedUnitCost }, "estimatedUnitCost") })),
      requestedBy: input.context.actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.requisitions.set(recordKey, requisition);
    return cloneRequisition(requisition);
  }

  submitRequisition(tenantId: string, requisitionId: string, actorId: string): PurchaseRequisition {
    return this.transitionRequisition(tenantId, requisitionId, "draft", { state: "submitted" }, actorId, "procurement.requisition.submitted.v1");
  }

  approveRequisition(tenantId: string, requisitionId: string, approverId: string): PurchaseRequisition {
    return this.transitionRequisition(tenantId, requisitionId, "submitted", { state: "approved", approvedBy: approverId }, approverId, "procurement.requisition.approved.v1");
  }

  rejectRequisition(tenantId: string, requisitionId: string, approverId: string, reason: string): PurchaseRequisition {
    return this.transitionRequisition(tenantId, requisitionId, "submitted", { state: "rejected", approvedBy: approverId, rejectionReason: nonEmpty(reason, "rejection reason") }, approverId, "procurement.requisition.rejected.v1");
  }

  createPurchaseOrder(command: PurchaseOrderCreateCommand): PurchaseOrder {
    if (command.context.legalEntityId === undefined) throw new PlatformError("VALIDATION_FAILED", "Legal entity context is required", 400);
    const supplier = this.requireSupplier(command.context.tenantId, command.supplierId);
    if (supplier.status !== "active") throw new PlatformError("CONFLICT", "Purchase orders require an active supplier", 409);
    if (command.lines.length === 0) throw new PlatformError("VALIDATION_FAILED", "Purchase order requires at least one line", 400);
    const recordKey = key(command.context.tenantId, command.id);
    if (this.purchaseOrders.has(recordKey)) return clonePurchaseOrder(this.purchaseOrders.get(recordKey)!);
    const orderNumber = nonEmpty(command.orderNumber, "purchase order number");
    if ([...this.purchaseOrders.values()].some((order) => order.tenantId === command.context.tenantId && order.orderNumber === orderNumber)) throw new PlatformError("CONFLICT", "Purchase order number already exists", 409);
    const lines: PurchaseOrderLine[] = command.lines.map((line) => {
      if (line.warehouseId !== command.warehouseId) throw new PlatformError("VALIDATION_FAILED", "All purchase order lines must use the order warehouse", 400);
      if (parseQuantity(line.quantity) <= 0n) throw new PlatformError("VALIDATION_FAILED", "Purchase order quantity must be positive", 400);
      assertCurrency(line.unitCost, supplier.currency, "purchase order unit cost");
      if (parseMoney(line.unitCost) < 0n) throw new PlatformError("VALIDATION_FAILED", "Purchase order unit cost cannot be negative", 400);
      if (!Number.isInteger(line.overReceiptToleranceBasisPoints) || line.overReceiptToleranceBasisPoints < 0 || line.overReceiptToleranceBasisPoints > 10_000) throw new PlatformError("VALIDATION_FAILED", "Over-receipt tolerance is invalid", 400);
      return { ...line, item: { ...line.item }, quantity: { ...line.quantity }, unitCost: { ...line.unitCost }, receivedQuantity: "0", returnedQuantity: "0", cancelledQuantity: "0" };
    });
    const timestamp = this.now().toISOString();
    const order: PurchaseOrder = {
      id: command.id,
      tenantId: command.context.tenantId,
      legalEntityId: command.context.legalEntityId,
      supplierId: command.supplierId,
      orderNumber,
      state: "draft",
      currency: supplier.currency,
      warehouseId: command.warehouseId,
      lines,
      requestedBy: command.audit.actorId,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    this.purchaseOrders.set(recordKey, order);
    this.emit(command.context.tenantId, "procurement.purchase_order.created.v1", "purchase_order", order.id, command.audit.actorId, { orderNumber }, command.context.businessDate);
    return clonePurchaseOrder(order);
  }

  submitPurchaseOrder(tenantId: string, purchaseOrderId: string, actorId: string): PurchaseOrder {
    const order = this.requirePurchaseOrder(tenantId, purchaseOrderId);
    if (order.state !== "draft") throw new PlatformError("CONFLICT", "Only draft purchase orders can be submitted", 409);
    const updated: PurchaseOrder = { ...order, state: "submitted", submittedBy: actorId, updatedAt: this.now().toISOString(), version: order.version + 1 };
    this.purchaseOrders.set(key(tenantId, purchaseOrderId), updated);
    this.emit(tenantId, "procurement.purchase_order.submitted.v1", "purchase_order", purchaseOrderId, actorId, {}, this.today());
    return clonePurchaseOrder(updated);
  }

  approvePurchaseOrder(input: { readonly tenantId: string; readonly purchaseOrderId: string; readonly approverId: string; readonly approvalId: string; readonly businessDate?: string }): PurchaseOrder {
    const order = this.requirePurchaseOrder(input.tenantId, input.purchaseOrderId);
    if (order.state !== "submitted") throw new PlatformError("CONFLICT", "Only submitted purchase orders can be approved", 409);
    const updated: PurchaseOrder = {
      ...order,
      state: "approved",
      approvedBy: input.approverId,
      approvalId: nonEmpty(input.approvalId, "approval id"),
      updatedAt: this.now().toISOString(),
      version: order.version + 1,
    };
    this.purchaseOrders.set(key(input.tenantId, input.purchaseOrderId), updated);
    this.emit(input.tenantId, "procurement.purchase_order.approved.v1", "purchase_order", input.purchaseOrderId, input.approverId, { approvalId: input.approvalId }, input.businessDate ?? this.today());
    return clonePurchaseOrder(updated);
  }

  amendPurchaseOrder(input: { readonly tenantId: string; readonly purchaseOrderId: string; readonly actorId: string; readonly expectedVersion: number; readonly lines: readonly PurchaseOrderLine[]; readonly reason: string }): PurchaseOrder {
    const order = this.requirePurchaseOrder(input.tenantId, input.purchaseOrderId);
    if (!['draft', 'submitted', 'approved', 'partially_received'].includes(order.state)) throw new PlatformError("CONFLICT", "Purchase order cannot be amended from its current state", 409);
    if (order.version !== input.expectedVersion) throw new PlatformError("VERSION_CONFLICT", "Purchase order was modified by another operation", 409);
    nonEmpty(input.reason, "amendment reason");
    const existingById = new Map(order.lines.map((line) => [line.id, line]));
    const amendedLines = input.lines.map((line) => {
      const existing = existingById.get(line.id);
      const ordered = parseQuantity(line.quantity);
      const received = existing === undefined ? 0n : parseQuantity({ amount: existing.receivedQuantity, unit: existing.quantity.unit, scale: existing.quantity.scale });
      if (ordered < received) throw new PlatformError("VALIDATION_FAILED", "Amended order quantity cannot be below received quantity", 400);
      assertCurrency(line.unitCost, order.currency, "purchase order unit cost");
      return {
        ...line,
        item: { ...line.item },
        quantity: { ...line.quantity },
        unitCost: { ...line.unitCost },
        receivedQuantity: existing?.receivedQuantity ?? line.receivedQuantity,
        returnedQuantity: existing?.returnedQuantity ?? line.returnedQuantity,
        cancelledQuantity: existing?.cancelledQuantity ?? line.cancelledQuantity,
      };
    });
    const updated: PurchaseOrder = {
      ...order,
      state: "draft",
      lines: amendedLines,
      revision: order.revision + 1,
      updatedAt: this.now().toISOString(),
      version: order.version + 1,
    };
    this.purchaseOrders.set(key(input.tenantId, input.purchaseOrderId), updated);
    this.emit(input.tenantId, "procurement.purchase_order.amended.v1", "purchase_order", input.purchaseOrderId, input.actorId, { revision: updated.revision, reason: input.reason }, this.today());
    return clonePurchaseOrder(updated);
  }

  cancelPurchaseOrder(tenantId: string, purchaseOrderId: string, actorId: string, reason: string): PurchaseOrder {
    const order = this.requirePurchaseOrder(tenantId, purchaseOrderId);
    if (['received', 'closed', 'cancelled'].includes(order.state)) throw new PlatformError("CONFLICT", "Purchase order cannot be cancelled from its current state", 409);
    nonEmpty(reason, "cancellation reason");
    const lines = order.lines.map((line) => {
      const ordered = parseQuantity(line.quantity);
      const received = this.lineQuantity(line, line.receivedQuantity);
      return { ...line, cancelledQuantity: formatQuantity(ordered - received, line.quantity.scale) };
    });
    const updated: PurchaseOrder = { ...order, state: "cancelled", lines, updatedAt: this.now().toISOString(), version: order.version + 1 };
    this.purchaseOrders.set(key(tenantId, purchaseOrderId), updated);
    this.emit(tenantId, "procurement.purchase_order.cancelled.v1", "purchase_order", purchaseOrderId, actorId, { reason }, this.today());
    return clonePurchaseOrder(updated);
  }

  convertRequisitionToPurchaseOrder(input: { readonly tenantId: string; readonly requisitionId: string; readonly supplierId: string; readonly orderId: string; readonly orderNumber: string; readonly actorId: string; readonly audit: AuditMetadataV1; readonly unitCosts: Readonly<Record<string, MoneyV1>> }): PurchaseOrder {
    const requisition = this.requireRequisition(input.tenantId, input.requisitionId);
    if (requisition.state !== "approved") throw new PlatformError("CONFLICT", "Only approved requisitions can be converted", 409);
    const supplier = this.requireSupplier(input.tenantId, input.supplierId);
    const warehouseIds = new Set(requisition.lines.map((line) => line.warehouseId));
    if (warehouseIds.size !== 1) throw new PlatformError("VALIDATION_FAILED", "A purchase order conversion currently supports one warehouse", 400);
    const warehouseId = requisition.lines[0]!.warehouseId;
    const order = this.createPurchaseOrder({
      schemaVersion: "1.0",
      context: {
        tenantId: requisition.tenantId,
        legalEntityId: requisition.legalEntityId,
        actorId: input.actorId,
        locale: "en-GB",
        timeZone: "UTC",
        businessDate: this.today(),
      },
      id: input.orderId,
      orderNumber: input.orderNumber,
      supplierId: supplier.id,
      warehouseId,
      lines: requisition.lines.map((line) => {
        const unitCost = input.unitCosts[line.id];
        if (unitCost === undefined) throw new PlatformError("VALIDATION_FAILED", `Missing unit cost for requisition line ${line.id}`, 400);
        return {
          id: line.id,
          item: { ...line.item },
          warehouseId: line.warehouseId,
          quantity: { ...line.quantity },
          unitCost: { ...unitCost },
          overReceiptToleranceBasisPoints: 0,
          ...optional(line.requiredBy, "promisedDate"),
        };
      }),
      audit: input.audit,
    });
    const updated: PurchaseRequisition = { ...requisition, state: "converted", purchaseOrderId: order.id, updatedAt: this.now().toISOString(), version: requisition.version + 1 };
    this.requisitions.set(key(input.tenantId, input.requisitionId), updated);
    return order;
  }

  receivePurchaseOrder(input: {
    readonly context: ScopeContextV1;
    readonly purchaseOrderId: string;
    readonly receiptId: string;
    readonly receiptNumber: string;
    readonly operationId: string;
    readonly postingGroupId: string;
    readonly lines: readonly {
      readonly id?: string;
      readonly purchaseOrderLineId: string;
      readonly quantity: QuantityV1;
      readonly disposition: "accepted" | "quarantine" | "damaged" | "rejected";
      readonly batchId?: string;
      readonly serialIds?: readonly string[];
      readonly expiryDate?: string;
      readonly discrepancyReason?: string;
    }[];
    readonly audit: AuditMetadataV1;
  }): GoodsReceipt {
    const receiptKey = key(input.context.tenantId, input.receiptId);
    const replay = this.receipts.get(receiptKey);
    if (replay) return cloneReceipt(replay);
    const order = this.requirePurchaseOrder(input.context.tenantId, input.purchaseOrderId);
    if (!['approved', 'partially_received'].includes(order.state)) throw new PlatformError("CONFLICT", "Purchase order must be approved before receiving", 409);
    if (input.lines.length === 0) throw new PlatformError("VALIDATION_FAILED", "Goods receipt requires at least one line", 400);
    const poLineById = new Map(order.lines.map((line) => [line.id, line]));
    const postedEntriesByReceiptLine = new Map<string, string[]>();
    const postingLines: StockPostingLine[] = [];
    const receiptLines: GoodsReceiptLine[] = [];
    const receivedByPoLine = new Map<string, bigint>();

    for (const incoming of input.lines) {
      const poLine = poLineById.get(incoming.purchaseOrderLineId);
      if (!poLine) throw new PlatformError("VALIDATION_FAILED", "Goods receipt references an unknown purchase order line", 400);
      if (incoming.quantity.unit !== poLine.quantity.unit || incoming.quantity.scale !== poLine.quantity.scale) throw new PlatformError("VALIDATION_FAILED", "Receipt quantity dimensions do not match the purchase order", 400);
      const received = parseQuantity(incoming.quantity);
      if (received <= 0n) throw new PlatformError("VALIDATION_FAILED", "Receipt quantity must be positive", 400);
      const ordered = parseQuantity(poLine.quantity);
      const previouslyReceived = this.lineQuantity(poLine, poLine.receivedQuantity);
      const pendingInReceipt = receivedByPoLine.get(poLine.id) ?? 0n;
      const maximum = ordered * BigInt(10_000 + poLine.overReceiptToleranceBasisPoints) / 10_000n;
      if (incoming.disposition !== "rejected" && previouslyReceived + pendingInReceipt + received > maximum) throw new PlatformError("CONFLICT", "Receipt exceeds purchase order tolerance", 409, { purchaseOrderLineId: poLine.id });
      if (incoming.disposition === "rejected" && incoming.discrepancyReason === undefined) throw new PlatformError("VALIDATION_FAILED", "Rejected receipt lines require a discrepancy reason", 400);
      const receiptLineId = incoming.id ?? this.idFactory();
      const serialIds = [...(incoming.serialIds ?? [])];
      if (serialIds.length > 0 && BigInt(serialIds.length) * scaleFactor(incoming.quantity.scale) !== received) throw new PlatformError("VALIDATION_FAILED", "Serial count must equal received quantity", 400);
      const stockStatus = this.dispositionStatus(incoming.disposition);
      if (stockStatus !== undefined) {
        receivedByPoLine.set(poLine.id, pendingInReceipt + received);
        if (serialIds.length > 0) {
          for (const serialId of serialIds) postingLines.push(this.receiptPostingLine(poLine, receiptLineId, { amount: "1", unit: incoming.quantity.unit, scale: incoming.quantity.scale }, stockStatus, incoming, serialId));
        } else {
          postingLines.push(this.receiptPostingLine(poLine, receiptLineId, incoming.quantity, stockStatus, incoming));
        }
      }
      receiptLines.push({
        id: receiptLineId,
        purchaseOrderLineId: poLine.id,
        item: { ...poLine.item },
        warehouseId: poLine.warehouseId,
        receivedQuantity: { ...incoming.quantity },
        disposition: incoming.disposition,
        unitCost: { ...poLine.unitCost },
        ...optional(incoming.batchId, "batchId"),
        serialIds,
        ...optional(incoming.expiryDate, "expiryDate"),
        ...optional(incoming.discrepancyReason, "discrepancyReason"),
        stockLedgerEntryIds: [],
      });
      postedEntriesByReceiptLine.set(receiptLineId, []);
    }

    const postingResult = postingLines.length === 0 ? undefined : this.inventory.postStock({
      schemaVersion: "1.0",
      context: input.context,
      operationId: input.operationId,
      postingGroupId: input.postingGroupId,
      movementType: "purchase_receipt",
      sourceDocumentType: "goods_receipt",
      lines: postingLines,
      audit: input.audit,
    });
    for (const entry of postingResult?.entries ?? []) {
      if (entry.sourceDocumentLineId !== undefined) postedEntriesByReceiptLine.get(entry.sourceDocumentLineId)?.push(entry.id);
    }
    const finalReceiptLines = receiptLines.map((line) => ({ ...line, stockLedgerEntryIds: [...(postedEntriesByReceiptLine.get(line.id) ?? [])] }));
    const updatedOrderLines = order.lines.map((line) => {
      const increment = receivedByPoLine.get(line.id) ?? 0n;
      return increment === 0n ? line : { ...line, receivedQuantity: formatQuantity(this.lineQuantity(line, line.receivedQuantity) + increment, line.quantity.scale) };
    });
    const fullyReceived = updatedOrderLines.every((line) => this.lineQuantity(line, line.receivedQuantity) + this.lineQuantity(line, line.cancelledQuantity) >= parseQuantity(line.quantity));
    const updatedOrder: PurchaseOrder = { ...order, state: fullyReceived ? "received" : "partially_received", lines: updatedOrderLines, updatedAt: this.now().toISOString(), version: order.version + 1 };
    this.purchaseOrders.set(key(order.tenantId, order.id), updatedOrder);
    const receipt: GoodsReceipt = {
      id: input.receiptId,
      tenantId: order.tenantId,
      legalEntityId: order.legalEntityId,
      supplierId: order.supplierId,
      purchaseOrderId: order.id,
      receiptNumber: nonEmpty(input.receiptNumber, "goods receipt number"),
      warehouseId: order.warehouseId,
      state: "posted",
      lines: finalReceiptLines,
      receivedBy: input.audit.actorId,
      receivedAt: postingResult?.postedAt ?? this.now().toISOString(),
      businessDate: input.context.businessDate,
      postingGroupId: input.postingGroupId,
      version: 1,
    };
    this.receipts.set(receiptKey, receipt);
    this.emit(order.tenantId, "procurement.goods_receipt.posted.v1", "goods_receipt", receipt.id, input.audit.actorId, { purchaseOrderId: order.id, postingGroupId: input.postingGroupId }, input.context.businessDate, input.postingGroupId);
    return cloneReceipt(receipt);
  }

  postSupplierReturn(input: {
    readonly context: ScopeContextV1;
    readonly returnId: string;
    readonly goodsReceiptId: string;
    readonly operationId: string;
    readonly postingGroupId: string;
    readonly lines: readonly { readonly id?: string; readonly goodsReceiptLineId: string; readonly quantity: QuantityV1; readonly reason: string }[];
    readonly audit: AuditMetadataV1;
  }): SupplierReturn {
    const returnKey = key(input.context.tenantId, input.returnId);
    const replay = this.supplierReturns.get(returnKey);
    if (replay) return cloneReturn(replay);
    const receipt = this.requireReceipt(input.context.tenantId, input.goodsReceiptId);
    if (receipt.state !== "posted") throw new PlatformError("CONFLICT", "Only posted goods receipts can be returned", 409);
    const receiptLineById = new Map(receipt.lines.map((line) => [line.id, line]));
    const postingLines: StockPostingLine[] = [];
    const returnLines: SupplierReturnLine[] = [];
    const entryIdsByLine = new Map<string, string[]>();
    for (const inputLine of input.lines) {
      const receiptLine = receiptLineById.get(inputLine.goodsReceiptLineId);
      if (!receiptLine) throw new PlatformError("VALIDATION_FAILED", "Supplier return references an unknown goods receipt line", 400);
      if (receiptLine.disposition === "rejected") throw new PlatformError("CONFLICT", "Rejected receipt quantities never entered stock and cannot be returned from stock", 409);
      if (inputLine.quantity.unit !== receiptLine.receivedQuantity.unit || inputLine.quantity.scale !== receiptLine.receivedQuantity.scale) throw new PlatformError("VALIDATION_FAILED", "Return quantity dimensions do not match receipt", 400);
      const requested = parseQuantity(inputLine.quantity);
      if (requested <= 0n) throw new PlatformError("VALIDATION_FAILED", "Supplier return quantity must be positive", 400);
      const alreadyReturned = this.returnedQuantityForReceiptLine(input.context.tenantId, receiptLine.id, inputLine.quantity);
      if (alreadyReturned + requested > parseQuantity(receiptLine.receivedQuantity)) throw new PlatformError("CONFLICT", "Supplier return exceeds received quantity", 409);
      const returnLineId = inputLine.id ?? this.idFactory();
      const status = this.dispositionStatus(receiptLine.disposition)!;
      const serialIds = receiptLine.serialIds;
      if (serialIds.length > 0) {
        const returnedSerials = this.returnedSerialsForReceiptLine(input.context.tenantId, receiptLine.id);
        const availableSerials = serialIds.filter((serialId) => !returnedSerials.has(serialId));
        const units = Number(requested / scaleFactor(inputLine.quantity.scale));
        if (units > availableSerials.length) throw new PlatformError("CONFLICT", "Supplier return exceeds available serials", 409);
        for (const serialId of availableSerials.slice(0, units)) postingLines.push(this.returnPostingLine(receiptLine, returnLineId, { amount: "-1", unit: inputLine.quantity.unit, scale: inputLine.quantity.scale }, status, serialId));
      } else {
        postingLines.push(this.returnPostingLine(receiptLine, returnLineId, { ...inputLine.quantity, amount: `-${inputLine.quantity.amount}` }, status));
      }
      returnLines.push({
        id: returnLineId,
        goodsReceiptLineId: receiptLine.id,
        item: { ...receiptLine.item },
        warehouseId: receiptLine.warehouseId,
        quantity: { ...inputLine.quantity },
        unitCost: { ...receiptLine.unitCost },
        reason: nonEmpty(inputLine.reason, "supplier return reason"),
        stockLedgerEntryIds: [],
      });
      entryIdsByLine.set(returnLineId, []);
    }
    const postingResult = this.inventory.postStock({
      schemaVersion: "1.0",
      context: input.context,
      operationId: input.operationId,
      postingGroupId: input.postingGroupId,
      movementType: "supplier_return",
      sourceDocumentType: "supplier_return",
      lines: postingLines,
      audit: input.audit,
    });
    for (const entry of postingResult.entries) if (entry.sourceDocumentLineId !== undefined) entryIdsByLine.get(entry.sourceDocumentLineId)?.push(entry.id);
    const supplierReturn: SupplierReturn = {
      id: input.returnId,
      tenantId: receipt.tenantId,
      legalEntityId: receipt.legalEntityId,
      supplierId: receipt.supplierId,
      goodsReceiptId: receipt.id,
      state: "posted",
      lines: returnLines.map((line) => ({ ...line, stockLedgerEntryIds: [...(entryIdsByLine.get(line.id) ?? [])] })),
      returnedBy: input.audit.actorId,
      returnedAt: postingResult.postedAt,
      businessDate: input.context.businessDate,
      postingGroupId: input.postingGroupId,
    };
    this.supplierReturns.set(returnKey, supplierReturn);
    this.updateOrderReturnedQuantities(receipt, supplierReturn);
    this.emit(receipt.tenantId, "procurement.supplier_return.posted.v1", "supplier_return", supplierReturn.id, input.audit.actorId, { goodsReceiptId: receipt.id }, input.context.businessDate, input.postingGroupId);
    return cloneReturn(supplierReturn);
  }

  createSupplierBill(input: Omit<SupplierBillReference, "createdAt">): SupplierBillReference {
    const recordKey = key(input.tenantId, input.id);
    if (this.supplierBills.has(recordKey)) return { ...this.supplierBills.get(recordKey)!, purchaseOrderIds: [...this.supplierBills.get(recordKey)!.purchaseOrderIds], goodsReceiptIds: [...this.supplierBills.get(recordKey)!.goodsReceiptIds] };
    this.requireSupplier(input.tenantId, input.supplierId);
    assertCurrency(input.subtotal, input.currency, "supplier bill subtotal");
    assertCurrency(input.tax, input.currency, "supplier bill tax");
    assertCurrency(input.total, input.currency, "supplier bill total");
    if (parseMoney(input.subtotal) + parseMoney(input.tax) !== parseMoney(input.total)) throw new PlatformError("VALIDATION_FAILED", "Supplier bill subtotal and tax must equal total", 400);
    const bill: SupplierBillReference = { ...input, purchaseOrderIds: [...input.purchaseOrderIds], goodsReceiptIds: [...input.goodsReceiptIds], subtotal: { ...input.subtotal }, tax: { ...input.tax }, total: { ...input.total }, createdAt: this.now().toISOString() };
    this.supplierBills.set(recordKey, bill);
    return { ...bill, purchaseOrderIds: [...bill.purchaseOrderIds], goodsReceiptIds: [...bill.goodsReceiptIds] };
  }

  matchSupplierBill(input: { readonly tenantId: string; readonly supplierBillId: string; readonly context: ScopeContextV1; readonly audit: AuditMetadataV1; readonly priceToleranceMinor?: string }): ThreeWayMatchResult {
    const bill = this.requireSupplierBill(input.tenantId, input.supplierBillId);
    const orders = bill.purchaseOrderIds.map((orderId) => this.requirePurchaseOrder(input.tenantId, orderId));
    const receipts = bill.goodsReceiptIds.map((receiptId) => this.requireReceipt(input.tenantId, receiptId));
    const currency = bill.currency;
    let orderedMinor = 0n;
    let receivedMinor = 0n;
    for (const order of orders) {
      if (order.currency !== currency) throw new PlatformError("VALIDATION_FAILED", "Matched purchase orders use another currency", 400);
      orderedMinor += order.lines.reduce((sum, line) => sum + multiplyMoney(line.unitCost, line.quantity), 0n);
    }
    for (const receipt of receipts) {
      receivedMinor += receipt.lines.filter((line) => line.disposition !== "rejected").reduce((sum, line) => sum + multiplyMoney(line.unitCost, line.receivedQuantity), 0n);
    }
    const billedMinor = parseMoney(bill.subtotal);
    const tolerance = BigInt(input.priceToleranceMinor ?? "0");
    const priceVariance = billedMinor - receivedMinor;
    const quantityVariance = orderedMinor - receivedMinor;
    let status: ThreeWayMatchResult["status"] = "matched";
    if (receipts.length === 0) status = "missing_receipt";
    else if (priceVariance < -tolerance || priceVariance > tolerance) status = "price_variance";
    else if (quantityVariance !== 0n) status = "quantity_variance";
    const accountingInstruction = status === "matched" ? this.buildBillAccountingInstruction(bill, input.context, input.audit) : undefined;
    const result: ThreeWayMatchResult = {
      id: this.idFactory(),
      tenantId: input.tenantId,
      supplierBillId: bill.id,
      status,
      orderedAmount: money(orderedMinor, currency, bill.subtotal.scale),
      receivedAmount: money(receivedMinor, currency, bill.subtotal.scale),
      billedAmount: { ...bill.subtotal },
      quantityVarianceMinor: quantityVariance.toString(),
      priceVarianceMinor: priceVariance.toString(),
      evidenceRefs: [...bill.purchaseOrderIds.map((id) => `purchase_order:${id}`), ...bill.goodsReceiptIds.map((id) => `goods_receipt:${id}`)],
      checkedAt: this.now().toISOString(),
      ...optional(accountingInstruction, "accountingInstruction"),
    };
    this.matchResults.set(key(input.tenantId, result.id), result);
    this.emit(input.tenantId, "procurement.three_way_match.completed.v1", "supplier_bill", bill.id, input.audit.actorId, { status }, input.context.businessDate);
    return { ...result, evidenceRefs: [...result.evidenceRefs], ...optional(result.accountingInstruction === undefined ? undefined : { ...result.accountingInstruction, lines: result.accountingInstruction.lines.map((line) => ({ ...line })) }, "accountingInstruction") };
  }

  createLandedCost(input: { readonly id: string; readonly tenantId: string; readonly legalEntityId: string; readonly goodsReceiptId: string; readonly total: MoneyV1; readonly allocationBasis: "quantity" | "inventory_value" | "manual"; readonly manualAllocations?: Readonly<Record<string, string>> }): LandedCostDocument {
    const recordKey = key(input.tenantId, input.id);
    const replay = this.landedCosts.get(recordKey);
    if (replay) return cloneLandedCost(replay);
    const receipt = this.requireReceipt(input.tenantId, input.goodsReceiptId);
    if (receipt.legalEntityId !== input.legalEntityId) throw new PlatformError("VALIDATION_FAILED", "Landed cost legal entity does not match goods receipt", 400);
    if (parseMoney(input.total) < 0n) throw new PlatformError("VALIDATION_FAILED", "Landed cost cannot be negative", 400);
    const layers = this.inventory.getCostLayers(input.tenantId).filter((layer) => receipt.lines.some((line) => line.stockLedgerEntryIds.includes(layer.receiptLedgerEntryId)));
    if (layers.length === 0) throw new PlatformError("CONFLICT", "Goods receipt has no eligible cost layers", 409);
    const allocationAmounts = this.allocateLandedCost(input.total, input.allocationBasis, layers.map((layer) => ({
      id: layer.id,
      quantityWeight: layer.originalQuantity,
      valueWeight: layer.originalQuantity * layer.unitCostMinor / scaleFactor(layer.quantityScale),
      ...optional(input.manualAllocations?.[layer.id] === undefined ? undefined : BigInt(input.manualAllocations[layer.id]!), "manualMinor"),
    })));
    const allocations: LandedCostAllocation[] = layers.map((layer) => {
      const receiptLine = receipt.lines.find((line) => line.stockLedgerEntryIds.includes(layer.receiptLedgerEntryId));
      if (!receiptLine) throw new PlatformError("INTERNAL_ERROR", "Cost layer receipt lineage is missing", 500);
      return { id: this.idFactory(), goodsReceiptLineId: receiptLine.id, costLayerId: layer.id, amount: money(allocationAmounts.get(layer.id) ?? 0n, input.total.currency, input.total.scale) };
    });
    const document: LandedCostDocument = {
      id: input.id,
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      goodsReceiptId: input.goodsReceiptId,
      currency: input.total.currency,
      total: { ...input.total },
      allocationBasis: input.allocationBasis,
      allocations,
      state: "draft",
      version: 1,
    };
    this.landedCosts.set(recordKey, document);
    return cloneLandedCost(document);
  }

  postLandedCost(input: { readonly tenantId: string; readonly landedCostId: string; readonly actorId: string; readonly postingGroupId: string; readonly businessDate: string }): LandedCostDocument {
    const recordKey = key(input.tenantId, input.landedCostId);
    const document = this.requireLandedCost(input.tenantId, input.landedCostId);
    if (document.state === "posted") return cloneLandedCost(document);
    if (document.state !== "draft") throw new PlatformError("CONFLICT", "Landed cost cannot be posted from its current state", 409);
    for (const allocation of document.allocations) {
      this.inventory.applyLandedCost({
        tenantId: input.tenantId,
        layerId: allocation.costLayerId,
        amountMinor: allocation.amount.amountMinor,
        sourceDocumentId: document.id,
        actorId: input.actorId,
        postingGroupId: input.postingGroupId,
        businessDate: input.businessDate,
      });
    }
    const timestamp = this.now().toISOString();
    const updated: LandedCostDocument = { ...document, state: "posted", postedBy: input.actorId, postedAt: timestamp, postingGroupId: input.postingGroupId, version: document.version + 1 };
    this.landedCosts.set(recordKey, updated);
    this.emit(input.tenantId, "procurement.landed_cost.posted.v1", "landed_cost", document.id, input.actorId, { goodsReceiptId: document.goodsReceiptId }, input.businessDate, input.postingGroupId);
    return cloneLandedCost(updated);
  }

  setReorderPolicy(policy: ReorderPolicy): ReorderPolicy {
    if (parseQuantity(policy.reorderPoint) < 0n || parseQuantity(policy.safetyStock) < 0n || parseQuantity(policy.minimumQuantity) < 0n || parseQuantity(policy.maximumQuantity) < parseQuantity(policy.minimumQuantity)) throw new PlatformError("VALIDATION_FAILED", "Reorder policy quantities are invalid", 400);
    if (policy.supplierId !== undefined) this.requireSupplier(policy.tenantId, policy.supplierId);
    this.reorderPolicies.set(key(policy.tenantId, policy.id), { ...policy });
    return { ...policy };
  }

  generateReplenishmentProposals(tenantId: string): readonly ReplenishmentProposal[] {
    const proposals: ReplenishmentProposal[] = [];
    for (const policy of this.reorderPolicies.values()) {
      if (policy.tenantId !== tenantId || !policy.active) continue;
      const availability = this.inventory.getAvailability(tenantId, policy.warehouseId, policy.variantId, policy.reorderPoint.unit, policy.reorderPoint.scale);
      const available = parseQuantity(availability.available);
      const incoming = this.openIncomingQuantity(tenantId, policy.warehouseId, policy.variantId, policy.reorderPoint);
      const reorderTrigger = parseQuantity(policy.reorderPoint) + parseQuantity(policy.safetyStock);
      if (available + incoming > reorderTrigger) continue;
      const maximum = parseQuantity(policy.maximumQuantity);
      const minimum = parseQuantity(policy.minimumQuantity);
      let suggestion = maximum - available - incoming;
      if (suggestion < minimum) suggestion = minimum;
      if (suggestion <= 0n) continue;
      const requiredBy = new Date(this.now().getTime() + policy.leadTimeDays * 86_400_000).toISOString().slice(0, 10);
      proposals.push({
        id: this.idFactory(),
        tenantId,
        variantId: policy.variantId,
        warehouseId: policy.warehouseId,
        ...optional(policy.supplierId, "supplierId"),
        available: { ...availability.available },
        incoming: { amount: formatQuantity(incoming, policy.reorderPoint.scale), unit: policy.reorderPoint.unit, scale: policy.reorderPoint.scale },
        suggestedOrderQuantity: { amount: formatQuantity(suggestion, policy.reorderPoint.scale), unit: policy.reorderPoint.unit, scale: policy.reorderPoint.scale },
        requiredBy,
        reason: "Available plus incoming stock is at or below reorder point and safety stock",
        generatedAt: this.now().toISOString(),
      });
    }
    return proposals;
  }

  getPurchaseOrder(tenantId: string, purchaseOrderId: string): PurchaseOrder { return clonePurchaseOrder(this.requirePurchaseOrder(tenantId, purchaseOrderId)); }
  listPurchaseOrders(tenantId: string): readonly PurchaseOrder[] { return [...this.purchaseOrders.values()].filter((order) => order.tenantId === tenantId).map(clonePurchaseOrder); }
  getGoodsReceipt(tenantId: string, receiptId: string): GoodsReceipt { return cloneReceipt(this.requireReceipt(tenantId, receiptId)); }
  listGoodsReceipts(tenantId: string): readonly GoodsReceipt[] { return [...this.receipts.values()].filter((receipt) => receipt.tenantId === tenantId).map(cloneReceipt); }
  listEvents(tenantId: string): readonly ProcurementEvent[] { return this.events.filter((event) => event.tenantId === tenantId).map((event) => ({ ...event, payload: { ...event.payload } })); }

  private transitionRequisition(tenantId: string, requisitionId: string, expectedState: PurchaseRequisition["state"], patch: Partial<PurchaseRequisition>, actorId: string, eventType: string): PurchaseRequisition {
    const recordKey = key(tenantId, requisitionId);
    const requisition = this.requireRequisition(tenantId, requisitionId);
    if (requisition.state !== expectedState) throw new PlatformError("CONFLICT", `Requisition must be ${expectedState}`, 409);
    const updated: PurchaseRequisition = { ...requisition, ...patch, updatedAt: this.now().toISOString(), version: requisition.version + 1 };
    this.requisitions.set(recordKey, updated);
    this.emit(tenantId, eventType, "purchase_requisition", requisitionId, actorId, {}, this.today());
    return cloneRequisition(updated);
  }

  private receiptPostingLine(poLine: PurchaseOrderLine, receiptLineId: string, quantity: QuantityV1, stockStatus: StockStatus, incoming: { readonly batchId?: string; readonly expiryDate?: string }, serialId?: string): StockPostingLine {
    return {
      item: { ...poLine.item },
      warehouseId: poLine.warehouseId,
      stockStatus,
      quantityDelta: { ...quantity },
      unitCostMinor: poLine.unitCost.amountMinor,
      currency: poLine.unitCost.currency,
      sourceDocumentId: receiptLineId,
      sourceDocumentLineId: receiptLineId,
      ...optional(incoming.batchId, "batchId"),
      ...optional(serialId, "serialId"),
      ...optional(incoming.expiryDate, "expiryDate"),
    };
  }

  private returnPostingLine(receiptLine: GoodsReceiptLine, returnLineId: string, quantity: QuantityV1, stockStatus: StockStatus, serialId?: string): StockPostingLine {
    return {
      item: { ...receiptLine.item },
      warehouseId: receiptLine.warehouseId,
      stockStatus,
      quantityDelta: { ...quantity },
      unitCostMinor: receiptLine.unitCost.amountMinor,
      currency: receiptLine.unitCost.currency,
      sourceDocumentId: returnLineId,
      sourceDocumentLineId: returnLineId,
      ...optional(receiptLine.batchId, "batchId"),
      ...optional(serialId, "serialId"),
      ...optional(receiptLine.expiryDate, "expiryDate"),
    };
  }

  private dispositionStatus(disposition: GoodsReceiptLine["disposition"]): StockStatus | undefined {
    if (disposition === "accepted") return "sellable";
    if (disposition === "quarantine") return "quarantine";
    if (disposition === "damaged") return "damaged";
    return undefined;
  }

  private buildBillAccountingInstruction(bill: SupplierBillReference, context: ScopeContextV1, audit: AuditMetadataV1): AccountingPostingInstructionV1 {
    const zero = money(0n, bill.currency, bill.total.scale);
    return {
      schemaVersion: "1.0",
      context,
      instructionId: this.idFactory(),
      postingGroupId: this.idFactory(),
      source: { documentType: "supplier_bill", documentId: bill.id, version: "1" },
      lines: [
        { accountCode: "INVENTORY_RECEIPT_CLEARING", debit: { ...bill.subtotal }, credit: zero, dimensions: { supplierId: bill.supplierId } },
        ...(parseMoney(bill.tax) === 0n ? [] : [{ accountCode: "INPUT_TAX", debit: { ...bill.tax }, credit: zero, dimensions: { supplierId: bill.supplierId } }]),
        { accountCode: "ACCOUNTS_PAYABLE", debit: zero, credit: { ...bill.total }, dimensions: { supplierId: bill.supplierId } },
      ],
      audit,
    };
  }

  private allocateLandedCost(total: MoneyV1, basis: "quantity" | "inventory_value" | "manual", layers: readonly { readonly id: string; readonly quantityWeight: bigint; readonly valueWeight: bigint; readonly manualMinor?: bigint }[]): Map<string, bigint> {
    const totalMinor = parseMoney(total);
    if (basis === "manual") {
      const allocations = new Map(layers.map((layer) => [layer.id, layer.manualMinor ?? 0n]));
      const sum = [...allocations.values()].reduce((value, current) => value + current, 0n);
      if (sum !== totalMinor) throw new PlatformError("VALIDATION_FAILED", "Manual landed-cost allocations must equal the document total", 400);
      return allocations;
    }
    const weights = layers.map((layer) => ({ id: layer.id, weight: basis === "quantity" ? layer.quantityWeight : layer.valueWeight }));
    const totalWeight = weights.reduce((sum, item) => sum + item.weight, 0n);
    if (totalWeight <= 0n) throw new PlatformError("VALIDATION_FAILED", "Landed-cost allocation basis has no positive weight", 400);
    const allocations = new Map<string, bigint>();
    let allocated = 0n;
    for (const item of weights) {
      const share = totalMinor * item.weight / totalWeight;
      allocations.set(item.id, share);
      allocated += share;
    }
    let remainder = totalMinor - allocated;
    for (const item of [...weights].sort((left, right) => left.id.localeCompare(right.id))) {
      if (remainder === 0n) break;
      allocations.set(item.id, (allocations.get(item.id) ?? 0n) + 1n);
      remainder -= 1n;
    }
    return allocations;
  }

  private returnedQuantityForReceiptLine(tenantId: string, receiptLineId: string, dimension: QuantityV1): bigint {
    let quantity = 0n;
    for (const supplierReturn of this.supplierReturns.values()) {
      if (supplierReturn.tenantId !== tenantId || supplierReturn.state !== "posted") continue;
      for (const line of supplierReturn.lines) if (line.goodsReceiptLineId === receiptLineId) {
        if (line.quantity.unit !== dimension.unit || line.quantity.scale !== dimension.scale) throw new PlatformError("CONFLICT", "Historical supplier return quantity dimensions conflict", 409);
        quantity += parseQuantity(line.quantity);
      }
    }
    return quantity;
  }

  private returnedSerialsForReceiptLine(tenantId: string, receiptLineId: string): Set<string> {
    const serials = new Set<string>();
    const receipt = [...this.receipts.values()].find((candidate) => candidate.tenantId === tenantId && candidate.lines.some((line) => line.id === receiptLineId));
    const receiptLine = receipt?.lines.find((line) => line.id === receiptLineId);
    if (!receiptLine) return serials;
    let returnedUnits = Number(this.returnedQuantityForReceiptLine(tenantId, receiptLineId, receiptLine.receivedQuantity) / scaleFactor(receiptLine.receivedQuantity.scale));
    for (const serialId of receiptLine.serialIds) {
      if (returnedUnits <= 0) break;
      serials.add(serialId);
      returnedUnits -= 1;
    }
    return serials;
  }

  private updateOrderReturnedQuantities(receipt: GoodsReceipt, supplierReturn: SupplierReturn): void {
    const order = this.requirePurchaseOrder(receipt.tenantId, receipt.purchaseOrderId);
    const receiptLineById = new Map(receipt.lines.map((line) => [line.id, line]));
    const returnedByPoLine = new Map<string, bigint>();
    for (const returnLine of supplierReturn.lines) {
      const receiptLine = receiptLineById.get(returnLine.goodsReceiptLineId)!;
      returnedByPoLine.set(receiptLine.purchaseOrderLineId, (returnedByPoLine.get(receiptLine.purchaseOrderLineId) ?? 0n) + parseQuantity(returnLine.quantity));
    }
    const lines = order.lines.map((line) => {
      const increment = returnedByPoLine.get(line.id) ?? 0n;
      return increment === 0n ? line : { ...line, returnedQuantity: formatQuantity(this.lineQuantity(line, line.returnedQuantity) + increment, line.quantity.scale) };
    });
    this.purchaseOrders.set(key(order.tenantId, order.id), { ...order, lines, updatedAt: this.now().toISOString(), version: order.version + 1 });
  }

  private openIncomingQuantity(tenantId: string, warehouseId: string, variantId: string, dimension: QuantityV1): bigint {
    let incoming = 0n;
    for (const order of this.purchaseOrders.values()) {
      if (order.tenantId !== tenantId || order.warehouseId !== warehouseId || !['approved', 'partially_received'].includes(order.state)) continue;
      for (const line of order.lines) {
        if (line.item.variantId !== variantId) continue;
        if (line.quantity.unit !== dimension.unit || line.quantity.scale !== dimension.scale) continue;
        incoming += parseQuantity(line.quantity) - this.lineQuantity(line, line.receivedQuantity) - this.lineQuantity(line, line.cancelledQuantity);
      }
    }
    return incoming;
  }

  private lineQuantity(line: PurchaseOrderLine, amount: string): bigint {
    return parseQuantity({ amount, unit: line.quantity.unit, scale: line.quantity.scale });
  }

  private requireSupplier(tenantId: string, supplierId: string): Supplier {
    const supplier = this.suppliers.get(key(tenantId, supplierId));
    if (!supplier) throw new PlatformError("NOT_FOUND", "Supplier not found", 404);
    return supplier;
  }

  private requireRequisition(tenantId: string, requisitionId: string): PurchaseRequisition {
    const requisition = this.requisitions.get(key(tenantId, requisitionId));
    if (!requisition) throw new PlatformError("NOT_FOUND", "Purchase requisition not found", 404);
    return requisition;
  }

  private requirePurchaseOrder(tenantId: string, purchaseOrderId: string): PurchaseOrder {
    const order = this.purchaseOrders.get(key(tenantId, purchaseOrderId));
    if (!order) throw new PlatformError("NOT_FOUND", "Purchase order not found", 404);
    return order;
  }

  private requireReceipt(tenantId: string, receiptId: string): GoodsReceipt {
    const receipt = this.receipts.get(key(tenantId, receiptId));
    if (!receipt) throw new PlatformError("NOT_FOUND", "Goods receipt not found", 404);
    return receipt;
  }

  private requireSupplierBill(tenantId: string, billId: string): SupplierBillReference {
    const bill = this.supplierBills.get(key(tenantId, billId));
    if (!bill) throw new PlatformError("NOT_FOUND", "Supplier bill not found", 404);
    return bill;
  }

  private requireLandedCost(tenantId: string, documentId: string): LandedCostDocument {
    const document = this.landedCosts.get(key(tenantId, documentId));
    if (!document) throw new PlatformError("NOT_FOUND", "Landed cost document not found", 404);
    return document;
  }

  private emit(tenantId: string, eventType: string, aggregateType: string, aggregateId: string, actorId: string, payload: Readonly<Record<string, unknown>>, businessDate: string, postingGroupId?: string): void {
    const event: ProcurementEvent = {
      id: this.idFactory(),
      tenantId,
      eventType,
      aggregateType,
      aggregateId,
      ...optional(postingGroupId, "postingGroupId"),
      actorId,
      businessDate,
      occurredAt: this.now().toISOString(),
      payload,
    };
    this.events.push(event);
    this.onEvent?.(event);
  }

  private today(): string { return this.now().toISOString().slice(0, 10); }
}
