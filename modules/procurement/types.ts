import type { AccountingPostingInstructionV1, AuditMetadataV1, CatalogItemReferenceV1, MoneyV1, QuantityV1, ScopeContextV1 } from "../../packages/contracts/src/v1/index.js";

export interface Supplier {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly code: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly status: "active" | "on_hold" | "inactive" | "archived";
  readonly currency: string;
  readonly paymentTermsDays: number;
  readonly leadTimeDays: number;
  readonly taxRegistration?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface SupplierContact {
  readonly id: string;
  readonly tenantId: string;
  readonly supplierId: string;
  readonly name: string;
  readonly role?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly primary: boolean;
  readonly status: "active" | "inactive";
}

export interface SupplierItem {
  readonly id: string;
  readonly tenantId: string;
  readonly supplierId: string;
  readonly variantId: string;
  readonly supplierSku: string;
  readonly purchaseUnit: string;
  readonly minimumOrderQuantity: QuantityV1;
  readonly packQuantity: QuantityV1;
  readonly lastQuotedUnitCost?: MoneyV1;
  readonly leadTimeDays?: number;
  readonly preferred: boolean;
  readonly status: "active" | "inactive";
}

export type RequisitionState = "draft" | "submitted" | "approved" | "rejected" | "converted" | "cancelled";
export interface PurchaseRequisitionLine {
  readonly id: string;
  readonly item: CatalogItemReferenceV1;
  readonly warehouseId: string;
  readonly quantity: QuantityV1;
  readonly requiredBy: string;
  readonly preferredSupplierId?: string;
  readonly estimatedUnitCost?: MoneyV1;
  readonly reason: string;
}
export interface PurchaseRequisition {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly state: RequisitionState;
  readonly lines: readonly PurchaseRequisitionLine[];
  readonly requestedBy: string;
  readonly approvedBy?: string;
  readonly rejectionReason?: string;
  readonly purchaseOrderId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export type PurchaseOrderState = "draft" | "submitted" | "approved" | "partially_received" | "received" | "closed" | "cancelled";
export interface PurchaseOrderLine {
  readonly id: string;
  readonly item: CatalogItemReferenceV1;
  readonly supplierItemId?: string;
  readonly warehouseId: string;
  readonly quantity: QuantityV1;
  readonly unitCost: MoneyV1;
  readonly taxCode?: string;
  readonly promisedDate?: string;
  readonly receivedQuantity: string;
  readonly returnedQuantity: string;
  readonly cancelledQuantity: string;
  readonly overReceiptToleranceBasisPoints: number;
  readonly notes?: string;
}
export interface PurchaseOrder {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly supplierId: string;
  readonly orderNumber: string;
  readonly state: PurchaseOrderState;
  readonly currency: string;
  readonly warehouseId: string;
  readonly lines: readonly PurchaseOrderLine[];
  readonly requestedBy: string;
  readonly submittedBy?: string;
  readonly approvedBy?: string;
  readonly approvalId?: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export type ReceiptLineDisposition = "accepted" | "quarantine" | "damaged" | "rejected";
export interface GoodsReceiptLine {
  readonly id: string;
  readonly purchaseOrderLineId: string;
  readonly item: CatalogItemReferenceV1;
  readonly warehouseId: string;
  readonly receivedQuantity: QuantityV1;
  readonly disposition: ReceiptLineDisposition;
  readonly unitCost: MoneyV1;
  readonly batchId?: string;
  readonly serialIds: readonly string[];
  readonly expiryDate?: string;
  readonly discrepancyReason?: string;
  readonly stockLedgerEntryIds: readonly string[];
}
export interface GoodsReceipt {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly supplierId: string;
  readonly purchaseOrderId: string;
  readonly receiptNumber: string;
  readonly warehouseId: string;
  readonly state: "posted" | "reversed";
  readonly lines: readonly GoodsReceiptLine[];
  readonly receivedBy: string;
  readonly receivedAt: string;
  readonly businessDate: string;
  readonly postingGroupId: string;
  readonly version: number;
}

export interface SupplierReturnLine {
  readonly id: string;
  readonly goodsReceiptLineId: string;
  readonly item: CatalogItemReferenceV1;
  readonly warehouseId: string;
  readonly quantity: QuantityV1;
  readonly unitCost: MoneyV1;
  readonly reason: string;
  readonly stockLedgerEntryIds: readonly string[];
}
export interface SupplierReturn {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly supplierId: string;
  readonly goodsReceiptId: string;
  readonly state: "posted" | "cancelled";
  readonly lines: readonly SupplierReturnLine[];
  readonly returnedBy: string;
  readonly returnedAt: string;
  readonly businessDate: string;
  readonly postingGroupId: string;
}

export interface SupplierBillReference {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly supplierId: string;
  readonly billNumber: string;
  readonly billDate: string;
  readonly currency: string;
  readonly subtotal: MoneyV1;
  readonly tax: MoneyV1;
  readonly total: MoneyV1;
  readonly purchaseOrderIds: readonly string[];
  readonly goodsReceiptIds: readonly string[];
  readonly createdAt: string;
}
export interface ThreeWayMatchResult {
  readonly id: string;
  readonly tenantId: string;
  readonly supplierBillId: string;
  readonly status: "matched" | "quantity_variance" | "price_variance" | "missing_receipt" | "failed";
  readonly orderedAmount: MoneyV1;
  readonly receivedAmount: MoneyV1;
  readonly billedAmount: MoneyV1;
  readonly quantityVarianceMinor: string;
  readonly priceVarianceMinor: string;
  readonly evidenceRefs: readonly string[];
  readonly checkedAt: string;
  readonly accountingInstruction?: AccountingPostingInstructionV1;
}

export interface LandedCostAllocation {
  readonly id: string;
  readonly goodsReceiptLineId: string;
  readonly costLayerId: string;
  readonly amount: MoneyV1;
}
export interface LandedCostDocument {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly goodsReceiptId: string;
  readonly currency: string;
  readonly total: MoneyV1;
  readonly allocationBasis: "quantity" | "inventory_value" | "manual";
  readonly allocations: readonly LandedCostAllocation[];
  readonly state: "draft" | "posted" | "reversed";
  readonly postedBy?: string;
  readonly postedAt?: string;
  readonly postingGroupId?: string;
  readonly version: number;
}

export interface ReorderPolicy {
  readonly id: string;
  readonly tenantId: string;
  readonly variantId: string;
  readonly warehouseId: string;
  readonly supplierId?: string;
  readonly reorderPoint: QuantityV1;
  readonly safetyStock: QuantityV1;
  readonly minimumQuantity: QuantityV1;
  readonly maximumQuantity: QuantityV1;
  readonly leadTimeDays: number;
  readonly active: boolean;
}
export interface ReplenishmentProposal {
  readonly id: string;
  readonly tenantId: string;
  readonly variantId: string;
  readonly warehouseId: string;
  readonly supplierId?: string;
  readonly available: QuantityV1;
  readonly incoming: QuantityV1;
  readonly suggestedOrderQuantity: QuantityV1;
  readonly requiredBy: string;
  readonly reason: string;
  readonly generatedAt: string;
}

export interface ProcurementEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly postingGroupId?: string;
  readonly actorId: string;
  readonly businessDate: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PurchaseOrderCreateCommand {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly id: string;
  readonly orderNumber: string;
  readonly supplierId: string;
  readonly warehouseId: string;
  readonly lines: readonly Omit<PurchaseOrderLine, "receivedQuantity" | "returnedQuantity" | "cancelledQuantity">[];
  readonly audit: AuditMetadataV1;
}
