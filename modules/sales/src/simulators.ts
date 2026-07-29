import type {
  AccountingPostingInstructionV1,
  AccountingPostingResultV1,
  PriceTaxCalculationRequestV1,
  PriceTaxSnapshotV1,
  ReceiptFiscalDocumentV1,
  RefundRequestV1,
  StockReservationRequestV1,
} from "../../../packages/contracts/src/v1/contracts.js";
import type { MoneyV1 } from "../../../packages/contracts/src/v1/common.js";

export interface PriceTaxPort {
  calculate(request: PriceTaxCalculationRequestV1 & { readonly unitPriceMinor: string; readonly taxRateBasisPoints: string }): Promise<PriceTaxSnapshotV1>;
}

export interface InventoryReservationPort {
  reserve(request: StockReservationRequestV1): Promise<{ readonly reservationId: string; readonly status: "reserved" | "conflict"; readonly version: string }>;
}

export interface CustomerCreditPort {
  check(request: {
    readonly schemaVersion: "1.0";
    readonly context: PriceTaxCalculationRequestV1["context"];
    readonly customerId: string;
    readonly amount: MoneyV1;
    readonly sourceType: "quote" | "order";
    readonly sourceId: string;
  }): Promise<{ readonly decision: "approved" | "approval_required" | "declined"; readonly approvalId?: string; readonly availableMinor: string; readonly version: string }>;
}

export interface PaymentRefundPort {
  requestRefund(request: RefundRequestV1): Promise<{ readonly refundId: string; readonly status: "requested" | "completed"; readonly version: string }>;
}

export interface AccountingPort {
  post(request: AccountingPostingInstructionV1): Promise<AccountingPostingResultV1>;
}

export interface ReceiptPort {
  issue(request: ReceiptFiscalDocumentV1): Promise<{ readonly documentId: string; readonly status: "issued"; readonly version: string }>;
}

export interface SalesDependencyPorts {
  readonly priceTax: PriceTaxPort;
  readonly inventory: InventoryReservationPort;
  readonly credit: CustomerCreditPort;
  readonly payment: PaymentRefundPort;
  readonly accounting: AccountingPort;
  readonly receipt: ReceiptPort;
}

function money(amountMinor: bigint, currency: string): MoneyV1 {
  return { amountMinor: amountMinor.toString(), currency, scale: 2 };
}

function quantityBaseUnits(amount: string, scale: number): bigint {
  const parsed = BigInt(amount);
  if (scale === 0) return parsed;
  return parsed;
}

function roundBasisPoints(amount: bigint, rateBasisPoints: bigint): bigint {
  const numerator = amount * rateBasisPoints;
  return (numerator + 5_000n) / 10_000n;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

export interface DeterministicSalesSimulators extends SalesDependencyPorts {
  readonly priceTax: PriceTaxPort & { readonly requests: (PriceTaxCalculationRequestV1 & { readonly unitPriceMinor: string; readonly taxRateBasisPoints: string })[] };
  readonly inventory: InventoryReservationPort & { readonly requests: StockReservationRequestV1[] };
  readonly credit: CustomerCreditPort & { readonly requests: Parameters<CustomerCreditPort["check"]>[0][] };
  readonly payment: PaymentRefundPort & { readonly requests: RefundRequestV1[] };
  readonly accounting: AccountingPort & { readonly requests: AccountingPostingInstructionV1[] };
  readonly receipt: ReceiptPort & { readonly requests: ReceiptFiscalDocumentV1[] };
}

export function createDeterministicSalesSimulators(options: {
  readonly inventoryStatus?: "reserved" | "conflict";
  readonly creditDecision?: "approved" | "approval_required" | "declined";
} = {}): DeterministicSalesSimulators {
  const priceRequests: (PriceTaxCalculationRequestV1 & { readonly unitPriceMinor: string; readonly taxRateBasisPoints: string })[] = [];
  const inventoryRequests: StockReservationRequestV1[] = [];
  const creditRequests: Parameters<CustomerCreditPort["check"]>[0][] = [];
  const paymentRequests: RefundRequestV1[] = [];
  const accountingRequests: AccountingPostingInstructionV1[] = [];
  const receiptRequests: ReceiptFiscalDocumentV1[] = [];
  let calculationSequence = 0;

  return {
    priceTax: {
      requests: priceRequests,
      async calculate(request) {
        priceRequests.push(structuredClone(request));
        const quantity = quantityBaseUnits(request.quantity.amount, request.quantity.scale);
        const unitPrice = BigInt(request.unitPriceMinor);
        const taxableBase = unitPrice * quantity;
        const taxAmount = roundBasisPoints(taxableBase, BigInt(request.taxRateBasisPoints));
        const snapshot: PriceTaxSnapshotV1 = {
          schemaVersion: "1.0",
          calculationId: `sim-price-tax-${String(++calculationSequence).padStart(6, "0")}`,
          item: structuredClone(request.item),
          quantity: structuredClone(request.quantity),
          originalUnitPrice: money(unitPrice, request.currency),
          effectiveUnitPrice: money(unitPrice, request.currency),
          discountTotal: money(0n, request.currency),
          taxableBase: money(taxableBase, request.currency),
          taxes: taxAmount === 0n ? [] : [{
            taxCode: "SIM-TAX",
            rateBasisPoints: request.taxRateBasisPoints,
            amount: money(taxAmount, request.currency),
            inclusive: false,
            ruleVersion: "sim-tax-v1",
          }],
          grossTotal: money(taxableBase + taxAmount, request.currency),
          roundingAdjustment: money(0n, request.currency),
          appliedRuleVersions: ["sim-price-v1", "sim-tax-v1"],
          calculatedAt: "2026-07-28T00:00:00.000Z",
        };
        return deepFreeze(snapshot);
      },
    },
    inventory: {
      requests: inventoryRequests,
      async reserve(request) {
        inventoryRequests.push(structuredClone(request));
        return { reservationId: request.reservationId, status: options.inventoryStatus ?? "reserved", version: "1" };
      },
    },
    credit: {
      requests: creditRequests,
      async check(request) {
        creditRequests.push(structuredClone(request));
        const decision = options.creditDecision ?? "approved";
        return {
          decision,
          ...(decision === "approval_required" ? { approvalId: "sim-credit-approval-required" } : {}),
          availableMinor: decision === "declined" ? "0" : request.amount.amountMinor,
          version: "1",
        };
      },
    },
    payment: {
      requests: paymentRequests,
      async requestRefund(request) {
        paymentRequests.push(structuredClone(request));
        return { refundId: request.refundId, status: "completed", version: "1" };
      },
    },
    accounting: {
      requests: accountingRequests,
      async post(request) {
        accountingRequests.push(structuredClone(request));
        return {
          instructionId: request.instructionId,
          journalEntryId: `sim-journal-${request.instructionId}`,
          postingGroupId: request.postingGroupId,
          balanced: true,
          postedAt: "2026-07-28T00:00:00.000Z",
          version: "1",
        };
      },
    },
    receipt: {
      requests: receiptRequests,
      async issue(request) {
        receiptRequests.push(structuredClone(request));
        return { documentId: request.documentId, status: "issued", version: "1" };
      },
    },
  };
}
