import type { Money } from "../../../packages/foundation/src/money.js";
import type { PaymentStatus } from "./domain.js";

export interface ProviderCapabilities {
  readonly authorize: boolean;
  readonly capture: boolean;
  readonly void: boolean;
  readonly refund: boolean;
  readonly partialRefund: boolean;
  readonly statusQuery: boolean;
  readonly settlementImport: boolean;
}

export interface ProviderAuthorizeRequest {
  readonly intentId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly paymentMethodToken: string;
}

export interface ProviderCaptureRequest {
  readonly intentId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly providerReference: string;
}

export interface ProviderVoidRequest {
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly providerReference: string;
}

export interface ProviderRefundRequest {
  readonly intentId: string;
  readonly refundId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
  readonly providerReference: string;
}

export interface ProviderResult {
  readonly status: Extract<PaymentStatus, "authorized" | "captured" | "declined" | "cancelled" | "partially_refunded" | "refunded" | "unknown">;
  readonly providerReference: string;
  readonly observedAt: string;
  readonly failureCategory?: "issuer_decline" | "provider_unavailable" | "invalid_request" | "risk_decline";
  readonly providerCode?: string;
}

export interface ProviderSettlementRecord {
  readonly providerSettlementId: string;
  readonly currency: string;
  readonly grossMinor: string;
  readonly feeMinor: string;
  readonly adjustmentMinor: string;
  readonly netMinor: string;
  readonly settledAt: string;
}

export interface PaymentProvider {
  capabilities(): ProviderCapabilities;
  authorize(request: ProviderAuthorizeRequest): Promise<ProviderResult>;
  capture(request: ProviderCaptureRequest): Promise<ProviderResult>;
  void(request: ProviderVoidRequest): Promise<ProviderResult>;
  refund(request: ProviderRefundRequest): Promise<ProviderResult>;
  queryStatus(providerReference: string): Promise<ProviderResult>;
  verifyWebhook(headers: Readonly<Record<string, string>>, rawBody: string): Promise<boolean>;
  normalizeWebhook(headers: Readonly<Record<string, string>>, rawBody: string): Promise<ProviderResult>;
  importSettlement(source: string): Promise<readonly ProviderSettlementRecord[]>;
}

export type ProviderCommandOutcome =
  | { readonly outcome: "authorized" }
  | { readonly outcome: "captured" }
  | { readonly outcome: "declined" }
  | { readonly outcome: "cancelled" }
  | { readonly outcome: "partially_refunded" }
  | { readonly outcome: "refunded" }
  | { readonly outcome: "ambiguous" };

export function paymentStatusFromProviderResult(result: ProviderCommandOutcome): PaymentStatus {
  return result.outcome === "ambiguous" ? "unknown" : result.outcome;
}
