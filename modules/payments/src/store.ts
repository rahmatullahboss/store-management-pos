import type { RequestContext } from "../../../packages/foundation/src/context.js";
import type { NeonDatabase, TransactionClient } from "../../../packages/foundation/src/db.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import { uuidV7 } from "../../../packages/foundation/src/ids.js";
import { money } from "../../../packages/foundation/src/money.js";
import type { PaymentStatus } from "./domain.js";
import type {
  BeginPaymentAttemptCommand,
  CompletePaymentAttemptCommand,
  CompleteRefundCommand,
  CreatePaymentIntentCommand,
  PaymentAttemptClaim,
  PaymentIntentResult,
  PaymentStore,
  RefundClaim,
  RefundCommand,
  RefundResult,
  SettlementImportCommand,
  SettlementImportResult,
} from "./service.js";

interface IntentRow extends Record<string, unknown> {
  readonly intent_id: string;
  readonly provider_account_id: string;
  readonly provider_key: string;
  readonly status: PaymentStatus;
  readonly currency: string;
  readonly scale: number | string;
  readonly amount_minor: string;
  readonly captured_minor: string;
  readonly refunded_minor: string;
  readonly method_reference: string | null;
  readonly provider_reference: string | null;
  readonly version: string;
  readonly observed_at: string;
  readonly replayed: boolean;
}

interface AttemptRow extends Record<string, unknown> {
  readonly execute: boolean;
  readonly replayed: boolean;
  readonly attempt_id: string;
  readonly operation: PaymentAttemptClaim["operation"];
  readonly intent_id: string;
  readonly provider_key: string;
  readonly provider_reference: string | null;
  readonly method_reference: string | null;
  readonly currency: string;
  readonly scale: number | string;
  readonly command_amount_minor: string;
  readonly current_status: PaymentStatus;
  readonly attempt_outcome: string;
}

interface RefundRow extends Record<string, unknown> {
  readonly execute?: boolean;
  readonly replayed: boolean;
  readonly refund_id: string;
  readonly attempt_id?: string;
  readonly intent_id: string;
  readonly provider_key?: string;
  readonly provider_reference: string | null;
  readonly currency: string;
  readonly scale: number | string;
  readonly command_amount_minor?: string;
  readonly amount_minor?: string;
  readonly current_status?: PaymentStatus;
  readonly final_refund?: boolean;
  readonly refund_status?: RefundResult["status"] | "processing" | "requested" | "pending_approval";
  readonly status?: RefundResult["status"];
  readonly observed_at: string;
}

interface SettlementRow extends Record<string, unknown> {
  readonly settlement_id: string;
  readonly provider_account_id: string;
  readonly provider_settlement_id: string;
  readonly currency: string;
  readonly scale: number | string;
  readonly gross_minor: string;
  readonly fee_minor: string;
  readonly adjustment_minor: string;
  readonly net_minor: string;
  readonly settled_at: string;
  readonly source_hash: string;
  readonly status: "imported";
  readonly replayed: boolean;
}

function databaseCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const value = (error as { readonly code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

function databaseMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Payment database command failed";
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof PlatformError) throw error;
  const code = databaseCode(error);
  const message = databaseMessage(error);
  if (code === "P0002") throw new PlatformError("NOT_FOUND", message, 404);
  if (code === "55P03") throw new PlatformError("CONFLICT", message, 409);
  if (code === "P0001") {
    if (/idempotency|payload mismatch|replay payload/i.test(message)) throw new PlatformError("IDEMPOTENCY_CONFLICT", message, 409);
    throw new PlatformError("CONFLICT", message, 409);
  }
  if (code === "42501") throw new PlatformError("PERMISSION_DENIED", message, 403);
  if (code === "22023" || code === "23514") throw new PlatformError("VALIDATION_FAILED", message, 400);
  if (code === "23505") throw new PlatformError("CONFLICT", message, 409);
  throw error;
}

async function withPaymentError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    translateDatabaseError(error);
  }
}

function requiredRow<Row extends Record<string, unknown>>(rows: readonly Row[], command: string): Row {
  const row = rows[0];
  if (!row) throw new PlatformError("INTERNAL_ERROR", `${command} returned no result`, 500);
  return row;
}

function intentResult(row: IntentRow): PaymentIntentResult {
  return {
    intentId: row.intent_id,
    providerAccountId: row.provider_account_id,
    providerKey: row.provider_key,
    status: row.status,
    amount: money(BigInt(row.amount_minor), row.currency.trim(), Number(row.scale)),
    capturedAmount: money(BigInt(row.captured_minor), row.currency.trim(), Number(row.scale)),
    refundedAmount: money(BigInt(row.refunded_minor), row.currency.trim(), Number(row.scale)),
    ...(row.method_reference ? { methodReference: row.method_reference } : {}),
    ...(row.provider_reference ? { providerReference: row.provider_reference } : {}),
    version: BigInt(row.version),
    observedAt: row.observed_at,
    replayed: row.replayed,
  };
}

async function loadIntent(client: TransactionClient, intentId: string, replayed: boolean): Promise<PaymentIntentResult> {
  const result = await client.query<IntentRow>(
    `SELECT pi.id::text AS intent_id, pi.provider_account_id::text, pa.provider_key, pi.status,
            pi.currency, pi.scale, pi.amount_minor::text, pi.captured_minor::text,
            pi.refunded_minor::text, pi.method_reference, pi.provider_reference,
            pi.version::text, pi.last_observed_at::text AS observed_at, $2::boolean AS replayed
       FROM payment.payment_intents pi
       JOIN payment.provider_accounts pa ON pa.tenant_id = pi.tenant_id AND pa.id = pi.provider_account_id
      WHERE pi.id = $1::uuid`,
    [intentId, replayed],
  );
  return intentResult(requiredRow(result.rows, "load payment intent"));
}

export class NeonPaymentStore implements PaymentStore {
  constructor(private readonly database: NeonDatabase) {}

  async createIntent(context: RequestContext, command: CreatePaymentIntentCommand): Promise<PaymentIntentResult> {
    return await withPaymentError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<IntentRow>(
        `SELECT intent_id::text, provider_account_id::text, provider_key, status,
                currency, scale, amount_minor::text, captured_minor::text,
                refunded_minor::text, method_reference, provider_reference,
                version::text, observed_at::text, replayed
           FROM payment.create_intent_v1(
             $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::char(3),$7::smallint,
             $8::bigint,$9::text,$10::text,$11::text
           )`,
        [
          command.intentId,
          command.providerAccountId,
          command.sourceType,
          command.sourceId,
          command.sourceVersion,
          command.amount.currency,
          command.amount.scale,
          command.amount.amountMinor.toString(),
          command.methodReference,
          command.idempotencyKey,
          command.requestHash,
        ],
      );
      return intentResult(requiredRow(result.rows, "create payment intent"));
    }));
  }

  async beginAttempt(context: RequestContext, command: BeginPaymentAttemptCommand): Promise<PaymentAttemptClaim> {
    return await withPaymentError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<AttemptRow>(
        `SELECT execute, replayed, attempt_id::text, operation, intent_id::text,
                provider_key, provider_reference, method_reference, currency, scale,
                command_amount_minor::text, current_status, attempt_outcome
           FROM payment.begin_attempt_v1($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::bigint)`,
        [uuidV7(), command.intentId, command.operation, command.idempotencyKey, command.requestHash, command.amount?.amountMinor.toString() ?? null],
      );
      const row = requiredRow(result.rows, "begin payment attempt");
      const claim: PaymentAttemptClaim = {
        execute: row.execute,
        replayed: row.replayed,
        attemptId: row.attempt_id,
        operation: row.operation,
        intentId: row.intent_id,
        providerKey: row.provider_key,
        ...(row.provider_reference ? { providerReference: row.provider_reference } : {}),
        ...(row.method_reference ? { methodReference: row.method_reference } : {}),
        commandAmount: money(BigInt(row.command_amount_minor), row.currency.trim(), Number(row.scale)),
        currentStatus: row.current_status,
      };
      if (!row.execute && row.attempt_outcome !== "processing") {
        return { ...claim, completedResult: await loadIntent(client, row.intent_id, true) };
      }
      return claim;
    }));
  }

  async completeAttempt(context: RequestContext, command: CompletePaymentAttemptCommand): Promise<PaymentIntentResult> {
    return await withPaymentError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<IntentRow>(
        `SELECT intent_id::text, provider_account_id::text, provider_key, status,
                currency, scale, amount_minor::text, captured_minor::text,
                refunded_minor::text, method_reference, provider_reference,
                version::text, observed_at::text, replayed
           FROM payment.complete_attempt_v1(
             $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::timestamptz,$7::text,$8::text
           )`,
        [
          uuidV7(),
          command.attemptId,
          command.status,
          command.outcome,
          command.providerReference ?? null,
          command.observedAt,
          command.failureCategory ?? null,
          command.providerCode ?? null,
        ],
      );
      return intentResult(requiredRow(result.rows, "complete payment attempt"));
    }));
  }

  async beginRefund(context: RequestContext, command: RefundCommand): Promise<RefundClaim> {
    return await withPaymentError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<RefundRow>(
        `SELECT execute, replayed, refund_id::text, attempt_id::text, intent_id::text,
                provider_key, provider_reference, currency, scale,
                command_amount_minor::text, current_status, final_refund,
                refund_status, observed_at::text
           FROM payment.begin_refund_v1(
             $1::uuid,$2::uuid,$3::uuid,$4::char(3),$5::smallint,$6::bigint,
             $7::text,$8::uuid,$9::text,$10::text
           )`,
        [
          command.refundId,
          uuidV7(),
          command.intentId,
          command.amount.currency,
          command.amount.scale,
          command.amount.amountMinor.toString(),
          command.reason,
          command.approvalRequestId ?? null,
          command.idempotencyKey,
          command.requestHash,
        ],
      );
      const row = requiredRow(result.rows, "begin refund");
      if (!row.attempt_id || !row.provider_key || row.command_amount_minor === undefined || row.current_status === undefined || row.final_refund === undefined) {
        throw new PlatformError("INTERNAL_ERROR", "Refund claim is incomplete", 500);
      }
      const claim: RefundClaim = {
        execute: row.execute ?? false,
        replayed: row.replayed,
        refundId: row.refund_id,
        attemptId: row.attempt_id,
        intentId: row.intent_id,
        providerKey: row.provider_key,
        ...(row.provider_reference ? { providerReference: row.provider_reference } : {}),
        commandAmount: money(BigInt(row.command_amount_minor), row.currency.trim(), Number(row.scale)),
        currentStatus: row.current_status,
        finalRefund: row.final_refund,
      };
      if (!claim.execute && row.refund_status && !["processing", "requested", "pending_approval"].includes(row.refund_status)) {
        return {
          ...claim,
          completedResult: {
            refundId: row.refund_id,
            intentId: row.intent_id,
            status: row.refund_status as RefundResult["status"],
            amount: claim.commandAmount,
            ...(row.provider_reference ? { providerReference: row.provider_reference } : {}),
            observedAt: row.observed_at,
            replayed: true,
          },
        };
      }
      return claim;
    }));
  }

  async completeRefund(context: RequestContext, command: CompleteRefundCommand): Promise<RefundResult> {
    return await withPaymentError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<RefundRow>(
        `SELECT refund_id::text, intent_id::text, status, currency, scale,
                amount_minor::text, provider_reference, observed_at::text, replayed
           FROM payment.complete_refund_v1(
             $1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::timestamptz,$7::text,$8::text
           )`,
        [
          uuidV7(),
          command.refundId,
          command.attemptId,
          command.status,
          command.providerReference ?? null,
          command.observedAt,
          command.failureCategory ?? null,
          command.providerCode ?? null,
        ],
      );
      const row = requiredRow(result.rows, "complete refund");
      if (!row.status || row.amount_minor === undefined) throw new PlatformError("INTERNAL_ERROR", "Refund result is incomplete", 500);
      return {
        refundId: row.refund_id,
        intentId: row.intent_id,
        status: row.status,
        amount: money(BigInt(row.amount_minor), row.currency.trim(), Number(row.scale)),
        ...(row.provider_reference ? { providerReference: row.provider_reference } : {}),
        observedAt: row.observed_at,
        replayed: row.replayed,
      };
    }));
  }

  async importSettlement(context: RequestContext, command: SettlementImportCommand): Promise<SettlementImportResult> {
    return await withPaymentError(async () => await this.database.withClientTransaction(context, async (client) => {
      const result = await client.query<SettlementRow>(
        `SELECT settlement_id::text, provider_account_id::text, provider_settlement_id,
                currency, scale, gross_minor::text, fee_minor::text,
                adjustment_minor::text, net_minor::text, settled_at::text,
                source_hash, status, replayed
           FROM payment.import_settlement_v1(
             $1::uuid,$2::uuid,$3::text,$4::char(3),$5::smallint,$6::bigint,
             $7::bigint,$8::bigint,$9::bigint,$10::timestamptz,$11::text,$12::text,$13::text
           )`,
        [
          command.settlementId,
          command.providerAccountId,
          command.providerSettlementId,
          command.gross.currency,
          command.gross.scale,
          command.gross.amountMinor.toString(),
          command.fees.amountMinor.toString(),
          command.adjustments.amountMinor.toString(),
          command.net.amountMinor.toString(),
          command.settledAt,
          command.sourceHash,
          command.idempotencyKey,
          command.requestHash,
        ],
      );
      const row = requiredRow(result.rows, "import settlement");
      return {
        settlementId: row.settlement_id,
        providerAccountId: row.provider_account_id,
        providerSettlementId: row.provider_settlement_id,
        gross: money(BigInt(row.gross_minor), row.currency.trim(), Number(row.scale)),
        fees: money(BigInt(row.fee_minor), row.currency.trim(), Number(row.scale)),
        adjustments: money(BigInt(row.adjustment_minor), row.currency.trim(), Number(row.scale)),
        net: money(BigInt(row.net_minor), row.currency.trim(), Number(row.scale)),
        settledAt: row.settled_at,
        sourceHash: row.source_hash,
        idempotencyKey: command.idempotencyKey,
        requestHash: command.requestHash,
        status: row.status,
        replayed: row.replayed,
      };
    }));
  }
}
