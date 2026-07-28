import type { AuditMetadataV1, MoneyV1, QuantityV1, ScopeContextV1 } from "./common.js";

export interface CatalogItemReferenceV1 { readonly itemId: string; readonly variantId: string; readonly sku?: string; readonly barcode?: string; readonly displayNameSnapshot?: string }

export interface PriceTaxCalculationRequestV1 {
  readonly schemaVersion: "1.0";
  readonly context: ScopeContextV1;
  readonly item: CatalogItemReferenceV1;
  readonly quantity: QuantityV1;
  readonly currency: string;
  readonly customerId?: string;
  readonly priceListId?: string;
  readonly couponCodes?: readonly string[];
}
export interface TaxComponentV1 { readonly taxCode: string; readonly jurisdictionId?: string; readonly rateBasisPoints: string; readonly amount: MoneyV1; readonly inclusive: boolean; readonly ruleVersion: string }
export interface PriceTaxSnapshotV1 {
  readonly schemaVersion: "1.0";
  readonly calculationId: string;
  readonly item: CatalogItemReferenceV1;
  readonly quantity: QuantityV1;
  readonly originalUnitPrice: MoneyV1;
  readonly effectiveUnitPrice: MoneyV1;
  readonly discountTotal: MoneyV1;
  readonly taxableBase: MoneyV1;
  readonly taxes: readonly TaxComponentV1[];
  readonly grossTotal: MoneyV1;
  readonly roundingAdjustment: MoneyV1;
  readonly appliedRuleVersions: readonly string[];
  readonly calculatedAt: string;
}

export interface StockAvailabilityRequestV1 { readonly schemaVersion: "1.0"; readonly context: ScopeContextV1; readonly item: CatalogItemReferenceV1; readonly warehouseIds: readonly string[]; readonly quantity: QuantityV1 }
export interface StockAvailabilityV1 { readonly variantId: string; readonly warehouseId: string; readonly onHand: QuantityV1; readonly reserved: QuantityV1; readonly available: QuantityV1; readonly asOf: string; readonly version: string }
export interface StockReservationRequestV1 { readonly schemaVersion: "1.0"; readonly context: ScopeContextV1; readonly reservationId: string; readonly sourceType: string; readonly sourceId: string; readonly lines: readonly { readonly item: CatalogItemReferenceV1; readonly warehouseId: string; readonly quantity: QuantityV1 }[]; readonly expiresAt?: string }
export interface StockPostingRequestV1 { readonly schemaVersion: "1.0"; readonly context: ScopeContextV1; readonly operationId: string; readonly postingGroupId: string; readonly movementType: string; readonly lines: readonly { readonly item: CatalogItemReferenceV1; readonly warehouseId: string; readonly quantityDelta: QuantityV1; readonly sourceDocumentId: string; readonly sourceDocumentLineId?: string }[]; readonly audit: AuditMetadataV1 }

export interface CustomerReferenceV1 { readonly customerId: string; readonly displayNameSnapshot?: string; readonly taxRegistrationSnapshot?: string }
export interface SalesDocumentReferenceV1 { readonly documentType: "quote" | "order" | "invoice" | "credit_note" | "return"; readonly documentId: string; readonly documentNumber?: string; readonly version: string }

export interface PaymentIntentRequestV1 { readonly schemaVersion: "1.0"; readonly context: ScopeContextV1; readonly intentId: string; readonly source: SalesDocumentReferenceV1; readonly amount: MoneyV1; readonly providerCapability: string; readonly idempotencyKey: string }
export type PaymentStatusV1 = "created" | "requires_action" | "authorized" | "captured" | "declined" | "cancelled" | "unknown" | "refunded" | "partially_refunded";
export interface PaymentStatusSnapshotV1 { readonly intentId: string; readonly status: PaymentStatusV1; readonly amount: MoneyV1; readonly providerReference?: string; readonly version: string; readonly observedAt: string }
export interface RefundRequestV1 { readonly schemaVersion: "1.0"; readonly context: ScopeContextV1; readonly refundId: string; readonly paymentIntentId: string; readonly amount: MoneyV1; readonly reason: string; readonly idempotencyKey: string; readonly audit: AuditMetadataV1 }

export interface AccountingPostingLineV1 { readonly accountCode: string; readonly debit: MoneyV1; readonly credit: MoneyV1; readonly dimensions?: Readonly<Record<string, string>>; readonly sourceLineId?: string }
export interface AccountingPostingInstructionV1 { readonly schemaVersion: "1.0"; readonly context: ScopeContextV1; readonly instructionId: string; readonly postingGroupId: string; readonly source: SalesDocumentReferenceV1 | { readonly documentType: string; readonly documentId: string; readonly version: string }; readonly lines: readonly AccountingPostingLineV1[]; readonly audit: AuditMetadataV1 }
export interface AccountingPostingResultV1 { readonly instructionId: string; readonly journalEntryId: string; readonly postingGroupId: string; readonly balanced: boolean; readonly postedAt: string; readonly version: string }

export interface ReceiptFiscalDocumentV1 { readonly schemaVersion: "1.0"; readonly documentId: string; readonly documentType: "receipt" | "invoice" | "credit_note" | "fiscal_receipt"; readonly source: SalesDocumentReferenceV1; readonly legalEntityId: string; readonly storeId: string; readonly registerId?: string; readonly issuedAt: string; readonly businessDate: string; readonly locale: string; readonly currency: string; readonly totals: { readonly net: MoneyV1; readonly tax: MoneyV1; readonly gross: MoneyV1; readonly paid: MoneyV1 }; readonly immutableContentHash: string; readonly fiscalStatus?: string; readonly fiscalProviderReference?: string }

export interface DomainEventEnvelopeV1<T = unknown> { readonly schemaVersion: "1.0"; readonly eventId: string; readonly eventType: string; readonly aggregateType: string; readonly aggregateId: string; readonly tenantId: string; readonly occurredAt: string; readonly businessDate: string; readonly correlationId: string; readonly causationId?: string; readonly actorId?: string; readonly payload: T; readonly metadata: Readonly<Record<string, string>> }
export interface ConsumerInboxReceiptV1 { readonly consumer: string; readonly eventId: string; readonly payloadHash: string; readonly status: "processing" | "completed" | "failed"; readonly attempts: number }

export interface FileJobReferenceV1 { readonly jobId: string; readonly jobType: "import" | "export" | "document"; readonly objectKey?: string; readonly status: "pending" | "running" | "completed" | "failed" | "cancelled"; readonly correlationId: string; readonly createdAt: string }
export interface ModuleHealthV1 { readonly module: string; readonly status: "healthy" | "degraded" | "unavailable"; readonly version: string; readonly checkedAt: string; readonly dependencies: readonly { readonly name: string; readonly status: string; readonly latencyMs?: number }[] }
export interface ReconciliationResultV1 { readonly reconciliationId: string; readonly module: string; readonly status: "matched" | "mismatch" | "failed"; readonly sourceCount: string; readonly projectionCount: string; readonly difference: string; readonly checkedAt: string; readonly evidenceRefs: readonly string[] }
