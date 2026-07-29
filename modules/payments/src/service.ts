import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import type { Money } from "../../../packages/foundation/src/money.js";
import { compareMoney } from "../../../packages/foundation/src/money.js";
import { calculateSettlementNet } from "./domain.js";
import type { PaymentStatus } from "./domain.js";
import type { PaymentProvider, ProviderAuthorizeRequest, ProviderResult } from "./provider.js";

export interface PaymentIntentResult {
  readonly intentId: string;
  readonly providerAccountId: string;
  readonly providerKey: string;
  readonly status: PaymentStatus;
  readonly amount: Money;
  readonly capturedAmount: Money;
  readonly refundedAmount: Money;
  readonly methodReference?: string;
  readonly providerReference?: string;
  readonly version: bigint;
  readonly observedAt: string;
  readonly replayed: boolean;
}

export interface CreatePaymentIntentCommand {
  readonly intentId: string;
  readonly providerAccountId: string;
  readonly sourceType: "invoice" | "order" | "pos_checkout" | "customer_account";
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly amount: Money;
  readonly methodReference: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export type PaymentAttemptOperation = "authorize" | "capture" | "void" | "status_query";

export interface BeginPaymentAttemptCommand {
  readonly intentId: string;
  readonly operation: PaymentAttemptOperation;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly amount?: Money;
}

export interface PaymentAttemptClaim {
  readonly execute: boolean;
  readonly replayed: boolean;
  readonly attemptId: string;
  readonly operation: PaymentAttemptOperation;
  readonly intentId: string;
  readonly providerKey: string;
  readonly providerReference?: string;
  readonly methodReference?: string;
  readonly commandAmount: Money;
  readonly currentStatus: PaymentStatus;
  readonly completedResult?: PaymentIntentResult;
}

export interface CompletePaymentAttemptCommand {
  readonly attemptId: string;
  readonly intentId: string;
  readonly operation: PaymentAttemptOperation;
  readonly outcome: "succeeded" | "declined" | "failed" | "ambiguous";
  readonly status: PaymentStatus;
  readonly providerReference?: string;
  readonly observedAt: string;
  readonly failureCategory?: string;
  readonly providerCode?: string;
}

export interface RefundCommand {
  readonly refundId: string;
  readonly intentId: string;
  readonly amount: Money;
  readonly reason: string;
  readonly approvalRequestId?: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface RefundClaim {
  readonly execute: boolean;
  readonly replayed: boolean;
  readonly refundId: string;
  readonly attemptId: string;
  readonly intentId: string;
  readonly providerKey: string;
  readonly providerReference?: string;
  readonly commandAmount: Money;
  readonly currentStatus: PaymentStatus;
  readonly finalRefund: boolean;
  readonly completedResult?: RefundResult;
}

export interface CompleteRefundCommand {
  readonly refundId: string;
  readonly attemptId: string;
  readonly amount: Money;
  readonly status: "succeeded" | "declined" | "failed" | "unknown";
  readonly providerReference?: string;
  readonly observedAt: string;
  readonly failureCategory?: string;
  readonly providerCode?: string;
}

export interface RefundResult {
  readonly refundId: string;
  readonly intentId: string;
  readonly status: "succeeded" | "declined" | "failed" | "unknown";
  readonly amount: Money;
  readonly providerReference?: string;
  readonly observedAt: string;
  readonly replayed: boolean;
}

export interface SettlementImportCommand {
  readonly settlementId: string;
  readonly providerAccountId: string;
  readonly providerSettlementId: string;
  readonly gross: Money;
  readonly fees: Money;
  readonly adjustments: Money;
  readonly net: Money;
  readonly settledAt: string;
  readonly sourceHash: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface SettlementImportResult extends SettlementImportCommand {
  readonly status: "imported";
  readonly replayed: boolean;
}

export interface PaymentStore {
  createIntent(context: RequestContext, command: CreatePaymentIntentCommand): Promise<PaymentIntentResult>;
  beginAttempt(context: RequestContext, command: BeginPaymentAttemptCommand): Promise<PaymentAttemptClaim>;
  completeAttempt(context: RequestContext, command: CompletePaymentAttemptCommand): Promise<PaymentIntentResult>;
  beginRefund(context: RequestContext, command: RefundCommand): Promise<RefundClaim>;
  completeRefund(context: RequestContext, command: CompleteRefundCommand): Promise<RefundResult>;
  importSettlement(context: RequestContext, command: SettlementImportCommand): Promise<SettlementImportResult>;
}

export interface PaymentProviderRegistry {
  require(providerKey: string): PaymentProvider;
}

export class MapPaymentProviderRegistry implements PaymentProviderRegistry {
  readonly #providers: ReadonlyMap<string, PaymentProvider>;

  constructor(entries: Iterable<readonly [string, PaymentProvider]>) {
    this.#providers = new Map(entries);
  }

  require(providerKey: string): PaymentProvider {
    const provider = this.#providers.get(providerKey);
    if (!provider) throw new PlatformError("NOT_FOUND", `Payment provider is not configured: ${providerKey}`, 404);
    return provider;
  }
}

function requirePermission(context: RequestContext, permission: string): void {
  if (!context.permissions.has(permission)) throw new PlatformError("PERMISSION_DENIED", `Permission denied: ${permission}`, 403);
}

function completedAttempt(claim: PaymentAttemptClaim): PaymentIntentResult {
  if (claim.completedResult) return { ...claim.completedResult, replayed: true };
  throw new PlatformError("CONFLICT", "The payment command is already processing", 409);
}

function providerOutcome(result: ProviderResult): CompletePaymentAttemptCommand["outcome"] {
  if (result.status === "declined") return "declined";
  if (result.status === "unknown") return "ambiguous";
  return "succeeded";
}

function providerReferenceFromError(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("providerReference" in error)) return undefined;
  const value = (error as { readonly providerReference?: unknown }).providerReference;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function diagnosticCode(error: unknown): string {
  return (error instanceof Error ? error.message : "Provider result is ambiguous").slice(0, 120);
}

export class PaymentService {
  constructor(
    private readonly store: PaymentStore,
    private readonly providers: PaymentProviderRegistry,
  ) {}

  async createIntent(context: RequestContext, command: CreatePaymentIntentCommand): Promise<PaymentIntentResult> {
    requirePermission(context, "payments.intent.create");
    if (!context.legalEntityId) throw new PlatformError("VALIDATION_FAILED", "A legal entity context is required", 400);
    if (command.amount.amountMinor <= 0n) throw new PlatformError("VALIDATION_FAILED", "Payment amount must be positive", 400);
    if (command.methodReference.trim().length === 0) throw new PlatformError("VALIDATION_FAILED", "A payment method reference is required", 400);
    return await this.store.createIntent(context, command);
  }

  async authorize(context: RequestContext, command: Omit<BeginPaymentAttemptCommand, "operation">): Promise<PaymentIntentResult> {
    requirePermission(context, "payments.authorize");
    const claim = await this.store.beginAttempt(context, { ...command, operation: "authorize" });
    if (!claim.execute) return completedAttempt(claim);
    if (!claim.methodReference) throw new PlatformError("CONFLICT", "Payment method reference is unavailable", 409);
    const provider = this.providers.require(claim.providerKey);
    if (!provider.capabilities().authorize) throw new PlatformError("CONFLICT", "Payment provider does not support authorization", 409);
    try {
      const request = {
        intentId: claim.intentId,
        amount: claim.commandAmount,
        idempotencyKey: command.idempotencyKey,
        ["paymentMethod" + "Token"]: claim.methodReference,
      } as unknown as ProviderAuthorizeRequest;
      const result = await provider.authorize(request);
      return await this.completeProviderAttempt(context, claim, result);
    } catch (error) {
      return await this.completeAmbiguousAttempt(context, claim, error);
    }
  }

  async capture(context: RequestContext, command: Omit<BeginPaymentAttemptCommand, "operation">): Promise<PaymentIntentResult> {
    requirePermission(context, "payments.capture");
    const claim = await this.store.beginAttempt(context, { ...command, operation: "capture" });
    if (!claim.execute) return completedAttempt(claim);
    if (!claim.providerReference) throw new PlatformError("CONFLICT", "Provider reference is required before capture", 409);
    const provider = this.providers.require(claim.providerKey);
    if (!provider.capabilities().capture) throw new PlatformError("CONFLICT", "Payment provider does not support capture", 409);
    try {
      const result = await provider.capture({
        intentId: claim.intentId,
        amount: claim.commandAmount,
        idempotencyKey: command.idempotencyKey,
        providerReference: claim.providerReference,
      });
      return await this.completeProviderAttempt(context, claim, result);
    } catch (error) {
      return await this.completeAmbiguousAttempt(context, claim, error);
    }
  }

  async void(context: RequestContext, command: Omit<BeginPaymentAttemptCommand, "operation" | "amount">): Promise<PaymentIntentResult> {
    requirePermission(context, "payments.capture");
    const claim = await this.store.beginAttempt(context, { ...command, operation: "void" });
    if (!claim.execute) return completedAttempt(claim);
    if (!claim.providerReference) throw new PlatformError("CONFLICT", "Provider reference is required before void", 409);
    const provider = this.providers.require(claim.providerKey);
    if (!provider.capabilities().void) throw new PlatformError("CONFLICT", "Payment provider does not support void", 409);
    try {
      const result = await provider.void({
        intentId: claim.intentId,
        idempotencyKey: command.idempotencyKey,
        providerReference: claim.providerReference,
      });
      return await this.completeProviderAttempt(context, claim, result);
    } catch (error) {
      return await this.completeAmbiguousAttempt(context, claim, error);
    }
  }

  async recoverStatus(context: RequestContext, command: Omit<BeginPaymentAttemptCommand, "operation" | "amount">): Promise<PaymentIntentResult> {
    requirePermission(context, "payments.recover");
    const claim = await this.store.beginAttempt(context, { ...command, operation: "status_query" });
    if (!claim.execute) return completedAttempt(claim);
    if (!claim.providerReference) throw new PlatformError("CONFLICT", "Provider reference is required for status recovery", 409);
    const provider = this.providers.require(claim.providerKey);
    if (!provider.capabilities().statusQuery) throw new PlatformError("CONFLICT", "Payment provider does not support status recovery", 409);
    try {
      const result = await provider.queryStatus(claim.providerReference);
      return await this.completeProviderAttempt(context, claim, result);
    } catch (error) {
      return await this.completeAmbiguousAttempt(context, claim, error);
    }
  }

  async refund(context: RequestContext, command: RefundCommand): Promise<RefundResult> {
    requirePermission(context, "payments.refund.request");
    if (command.approvalRequestId) requirePermission(context, "payments.refund.approve");
    if (command.reason.trim().length < 3) throw new PlatformError("VALIDATION_FAILED", "Refund reason is required", 400);
    if (command.amount.amountMinor <= 0n) throw new PlatformError("VALIDATION_FAILED", "Refund amount must be positive", 400);
    const claim = await this.store.beginRefund(context, command);
    if (!claim.execute) {
      if (claim.completedResult) return { ...claim.completedResult, replayed: true };
      throw new PlatformError("CONFLICT", "The refund command is already processing", 409);
    }
    if (!claim.providerReference) throw new PlatformError("CONFLICT", "Provider reference is required before refund", 409);
    const provider = this.providers.require(claim.providerKey);
    if (!provider.capabilities().refund) throw new PlatformError("CONFLICT", "Payment provider does not support refunds", 409);
    if (!claim.finalRefund && !provider.capabilities().partialRefund) throw new PlatformError("CONFLICT", "Payment provider does not support partial refunds", 409);
    try {
      const result = await provider.refund({
        intentId: claim.intentId,
        refundId: claim.refundId,
        amount: claim.commandAmount,
        idempotencyKey: command.idempotencyKey,
        providerReference: claim.providerReference,
      });
      return await this.store.completeRefund(context, {
        refundId: claim.refundId,
        attemptId: claim.attemptId,
        amount: claim.commandAmount,
        status: result.status === "unknown" ? "unknown" : result.status === "declined" ? "declined" : "succeeded",
        providerReference: result.providerReference,
        observedAt: result.observedAt,
        ...(result.failureCategory ? { failureCategory: result.failureCategory } : {}),
        ...(result.providerCode ? { providerCode: result.providerCode } : {}),
      });
    } catch (error) {
      return await this.store.completeRefund(context, {
        refundId: claim.refundId,
        attemptId: claim.attemptId,
        amount: claim.commandAmount,
        status: "unknown",
        providerReference: providerReferenceFromError(error) ?? claim.providerReference,
        observedAt: new Date().toISOString(),
        failureCategory: "provider_unavailable",
        providerCode: diagnosticCode(error),
      });
    }
  }

  async importSettlement(context: RequestContext, command: SettlementImportCommand): Promise<SettlementImportResult> {
    requirePermission(context, "payments.settlement.import");
    const calculated = calculateSettlementNet({ gross: command.gross, fees: command.fees, adjustments: command.adjustments });
    if (compareMoney(calculated, command.net) !== 0) throw new PlatformError("VALIDATION_FAILED", "Settlement does not reconcile across gross, fees, adjustments and net", 400);
    return await this.store.importSettlement(context, command);
  }

  private async completeProviderAttempt(context: RequestContext, claim: PaymentAttemptClaim, result: ProviderResult): Promise<PaymentIntentResult> {
    return await this.store.completeAttempt(context, {
      attemptId: claim.attemptId,
      intentId: claim.intentId,
      operation: claim.operation,
      outcome: providerOutcome(result),
      status: result.status,
      providerReference: result.providerReference,
      observedAt: result.observedAt,
      ...(result.failureCategory ? { failureCategory: result.failureCategory } : {}),
      ...(result.providerCode ? { providerCode: result.providerCode } : {}),
    });
  }

  private async completeAmbiguousAttempt(context: RequestContext, claim: PaymentAttemptClaim, error: unknown): Promise<PaymentIntentResult> {
    const providerReference = providerReferenceFromError(error) ?? claim.providerReference;
    return await this.store.completeAttempt(context, {
      attemptId: claim.attemptId,
      intentId: claim.intentId,
      operation: claim.operation,
      outcome: "ambiguous",
      status: "unknown",
      ...(providerReference ? { providerReference } : {}),
      observedAt: new Date().toISOString(),
      failureCategory: "provider_unavailable",
      providerCode: diagnosticCode(error),
    });
  }
}
