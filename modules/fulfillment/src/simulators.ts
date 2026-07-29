import type { RefundRequestV1, StockPostingRequestV1 } from "../../../packages/contracts/src/v1/contracts.js";
import type { QuantityV1, ScopeContextV1 } from "../../../packages/contracts/src/v1/common.js";

export interface FulfillmentInventoryPort {
  post(request: StockPostingRequestV1): Promise<{ readonly operationId: string; readonly status: "posted"; readonly version: string }>;
}

export interface FulfillmentRefundPort {
  requestRefund(request: RefundRequestV1): Promise<{ readonly refundId: string; readonly status: "requested" | "completed"; readonly version: string }>;
}

export interface ExchangePort {
  createReplacement(request: {
    readonly schemaVersion: "1.0";
    readonly context: ScopeContextV1;
    readonly exchangeRequestId: string;
    readonly sourceReturnId: string;
    readonly sourceReturnLineId: string;
    readonly replacementVariantId: string;
    readonly quantity: QuantityV1;
    readonly idempotencyKey: string;
  }): Promise<{ readonly exchangeRequestId: string; readonly replacementOrderRequestId: string; readonly status: "requested"; readonly version: string }>;
}

export interface FulfillmentDependencyPorts {
  readonly inventory: FulfillmentInventoryPort;
  readonly refunds: FulfillmentRefundPort;
  readonly exchange: ExchangePort;
}

export interface DeterministicFulfillmentSimulators extends FulfillmentDependencyPorts {
  readonly inventory: FulfillmentInventoryPort & { readonly postings: StockPostingRequestV1[] };
  readonly refunds: FulfillmentRefundPort & { readonly requests: RefundRequestV1[] };
  readonly exchange: ExchangePort & { readonly requests: Parameters<ExchangePort["createReplacement"]>[0][] };
}

export function createDeterministicFulfillmentSimulators(): DeterministicFulfillmentSimulators {
  const postings: StockPostingRequestV1[] = [];
  const refunds: RefundRequestV1[] = [];
  const exchanges: Parameters<ExchangePort["createReplacement"]>[0][] = [];
  return {
    inventory: {
      postings,
      async post(request) {
        postings.push(structuredClone(request));
        return { operationId: request.operationId, status: "posted", version: "1" };
      },
    },
    refunds: {
      requests: refunds,
      async requestRefund(request) {
        refunds.push(structuredClone(request));
        return { refundId: request.refundId, status: "completed", version: "1" };
      },
    },
    exchange: {
      requests: exchanges,
      async createReplacement(request) {
        exchanges.push(structuredClone(request));
        return {
          exchangeRequestId: request.exchangeRequestId,
          replacementOrderRequestId: `replacement-${request.exchangeRequestId}`,
          status: "requested",
          version: "1",
        };
      },
    },
  };
}
