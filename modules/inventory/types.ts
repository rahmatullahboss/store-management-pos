import type { AuditMetadataV1, CatalogItemReferenceV1, QuantityV1, ScopeContextV1 } from "../../packages/contracts/src/v1/index.js";

export type StockStatus = "sellable" | "reserved" | "in_transit" | "damaged" | "quarantine";
export type NegativeStockPolicy = "deny" | "approve" | "allow";
export type CostingMethod = "fifo" | "weighted_average" | "specific_identification";
export type MovementType =
  | "opening_balance"
  | "purchase_receipt"
  | "sale_issue"
  | "customer_return"
  | "supplier_return"
  | "transfer_dispatch"
  | "transfer_receipt"
  | "adjustment_gain"
  | "adjustment_loss"
  | "physical_count_variance"
  | "status_change"
  | "landed_cost_revaluation"
  | "reversal";

export interface Warehouse {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly storeId?: string;
  readonly code: string;
  readonly displayName: string;
  readonly status: "active" | "inactive" | "closed";
  readonly negativeStockPolicy: NegativeStockPolicy;
  readonly costingMethod: CostingMethod;
  readonly timeZone: string;
  readonly createdAt: string;
  readonly version: number;
}

export interface WarehouseZone {
  readonly id: string;
  readonly tenantId: string;
  readonly warehouseId: string;
  readonly code: string;
  readonly displayName: string;
  readonly status: "active" | "inactive";
}

export interface WarehouseBin {
  readonly id: string;
  readonly tenantId: string;
  readonly warehouseId: string;
  readonly zoneId?: string;
  readonly code: string;
  readonly displayName: string;
  readonly pickable: boolean;
  readonly receivable: boolean;
  readonly status: "active" | "inactive";
}

export interface StockLedgerEntry {
  readonly id: string;
  readonly operationId: string;
  readonly postingGroupId: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly variantId: string;
  readonly warehouseId: string;
  readonly binId?: string;
  readonly stockStatus: StockStatus;
  readonly batchId?: string;
  readonly serialId?: string;
  readonly expiryDate?: string;
  readonly quantityDelta: bigint;
  readonly quantityScale: number;
  readonly unit: string;
  readonly unitCostMinor?: bigint;
  readonly currency?: string;
  readonly valueDeltaMinor?: bigint;
  readonly movementType: MovementType;
  readonly sourceDocumentType: string;
  readonly sourceDocumentId: string;
  readonly sourceDocumentLineId?: string;
  readonly businessDate: string;
  readonly postedAt: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly reversalOfEntryId?: string;
}

export interface StockPostingLine {
  readonly item: CatalogItemReferenceV1;
  readonly warehouseId: string;
  readonly binId?: string;
  readonly stockStatus?: StockStatus;
  readonly batchId?: string;
  readonly serialId?: string;
  readonly expiryDate?: string;
  readonly quantityDelta: QuantityV1;
  readonly unitCostMinor?: string;
  readonly currency?: string;
  readonly sourceDocumentId: string;
  readonly sourceDocumentLineId?: string;
  readonly reversalOfEntryId?: string;
}

export interface StockPostingCommand {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly operationId: string;
  readonly postingGroupId: string;
  readonly movementType: MovementType;
  readonly sourceDocumentType: string;
  readonly lines: readonly StockPostingLine[];
  readonly audit: AuditMetadataV1;
  readonly approvalId?: string;
}

export interface CostConsumption {
  readonly id: string;
  readonly tenantId: string;
  readonly issueLedgerEntryId: string;
  readonly costLayerId: string;
  readonly quantity: bigint;
  readonly quantityScale: number;
  readonly unitCostMinor: bigint;
  readonly valueMinor: bigint;
  readonly createdAt: string;
}

export interface CostLayer {
  readonly id: string;
  readonly tenantId: string;
  readonly warehouseId: string;
  readonly variantId: string;
  readonly batchId?: string;
  readonly serialId?: string;
  readonly receiptLedgerEntryId: string;
  readonly receivedAt: string;
  readonly originalQuantity: bigint;
  readonly remainingQuantity: bigint;
  readonly quantityScale: number;
  readonly unit: string;
  readonly unitCostMinor: bigint;
  readonly currency: string;
  readonly landedCostMinor: bigint;
}

export interface InventoryBalance {
  readonly tenantId: string;
  readonly warehouseId: string;
  readonly variantId: string;
  readonly stockStatus: StockStatus;
  readonly unit: string;
  readonly scale: number;
  readonly quantity: bigint;
  readonly valueMinor: bigint;
  readonly currency?: string;
  readonly asOf: string;
}

export type ReservationState = "fully_reserved" | "partially_reserved" | "unfulfilled" | "partially_consumed" | "consumed" | "released" | "expired" | "cancelled";

export interface ReservationLine {
  readonly id: string;
  readonly variantId: string;
  readonly warehouseId: string;
  readonly unit: string;
  readonly scale: number;
  readonly requestedQuantity: bigint;
  readonly reservedQuantity: bigint;
  readonly consumedQuantity: bigint;
  readonly releasedQuantity: bigint;
}

export interface StockReservation {
  readonly id: string;
  readonly tenantId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly state: ReservationState;
  readonly lines: readonly ReservationLine[];
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ReservationRequest {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly reservationId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly fulfillmentPolicy: "all_or_nothing" | "allow_partial";
  readonly lines: readonly {
    readonly item: CatalogItemReferenceV1;
    readonly warehouseId: string;
    readonly quantity: QuantityV1;
  }[];
  readonly expiresAt?: string;
}

export type TransferState = "draft" | "approved" | "picking" | "dispatched" | "partially_received" | "received" | "closed" | "cancelled";

export interface StockTransferLine {
  readonly id: string;
  readonly variantId: string;
  readonly unit: string;
  readonly scale: number;
  readonly requestedQuantity: bigint;
  readonly dispatchedQuantity: bigint;
  readonly receivedQuantity: bigint;
  readonly damagedQuantity: bigint;
  readonly missingQuantity: bigint;
  readonly batchId?: string;
  readonly serialIds: readonly string[];
}

export interface StockTransfer {
  readonly id: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly sourceWarehouseId: string;
  readonly destinationWarehouseId: string;
  readonly state: TransferState;
  readonly lines: readonly StockTransferLine[];
  readonly requestedBy: string;
  readonly approvedBy?: string;
  readonly dispatchedAt?: string;
  readonly receivedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export type CountState = "draft" | "frozen" | "counting" | "submitted" | "recount_required" | "approved" | "posted" | "cancelled";

export interface StockCountLine {
  readonly id: string;
  readonly variantId: string;
  readonly unit: string;
  readonly scale: number;
  readonly expectedQuantity: bigint;
  readonly firstCountQuantity?: bigint;
  readonly recountQuantity?: bigint;
  readonly approvedQuantity?: bigint;
  readonly varianceQuantity?: bigint;
}

export interface StockCount {
  readonly id: string;
  readonly tenantId: string;
  readonly warehouseId: string;
  readonly state: CountState;
  readonly blind: boolean;
  readonly snapshotAt: string;
  readonly lines: readonly StockCountLine[];
  readonly createdBy: string;
  readonly approvedBy?: string;
  readonly postedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface InventoryReconciliation {
  readonly id: string;
  readonly tenantId: string;
  readonly status: "matched" | "mismatch";
  readonly ledgerEntryCount: number;
  readonly projectionKeyCount: number;
  readonly mismatches: readonly {
    readonly key: string;
    readonly ledgerQuantity: bigint;
    readonly projectionQuantity: bigint;
  }[];
  readonly checkedAt: string;
}

export interface InventoryEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly postingGroupId?: string;
  readonly occurredAt: string;
  readonly businessDate: string;
  readonly actorId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}
