import type { RequestContext } from "../../../packages/foundation/src/context.js";
import { PlatformError } from "../../../packages/foundation/src/errors.js";
import type { BankingService, RecordReconciliationRunCommand } from "../../../modules/banking/src/service.js";
import type { PaymentService } from "../../../modules/payments/src/service.js";

export interface PaymentRecoveryJob {
  readonly type: "payment_status_recovery";
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
}

export interface BankReconciliationControlJob extends RecordReconciliationRunCommand {
  readonly type: "bank_reconciliation_control";
}

export type FinanceJob = PaymentRecoveryJob | BankReconciliationControlJob;

export interface FinanceJobServices {
  readonly payments: Pick<PaymentService, "recoverStatus">;
  readonly banking: Pick<BankingService, "recordReconciliationRun">;
}

export interface FinanceJobOutcome {
  readonly type: FinanceJob["type"];
  readonly resourceId: string;
  readonly status: "completed" | "retry" | "failed";
  readonly replayed?: boolean;
  readonly reason?: string;
}

function safeReason(error: unknown): string {
  if (error instanceof PlatformError) return `${error.code}:${error.message}`.slice(0, 180);
  return "UNEXPECTED:finance job execution failed";
}

function shouldRetry(error: unknown): boolean {
  if (!(error instanceof PlatformError)) return true;
  return error.status >= 500 || error.code === "CONFLICT";
}

export async function executeFinanceJob(
  context: RequestContext,
  services: FinanceJobServices,
  job: FinanceJob,
): Promise<FinanceJobOutcome> {
  try {
    if (job.type === "payment_status_recovery") {
      const result = await services.payments.recoverStatus(context, {
        intentId: job.intentId,
        idempotencyKey: job.idempotencyKey,
        requestHash: job.requestHash,
      });
      return Object.freeze({
        type: job.type,
        resourceId: result.intentId,
        status: result.status === "unknown" ? "retry" : "completed",
        replayed: result.replayed,
        ...(result.status === "unknown" ? { reason: "provider status remains unknown" } : {}),
      });
    }
    const result = await services.banking.recordReconciliationRun(context, {
      runId: job.runId,
      bankAccountId: job.bankAccountId,
      periodStart: job.periodStart,
      periodEnd: job.periodEnd,
      idempotencyKey: job.idempotencyKey,
      requestHash: job.requestHash,
    });
    return Object.freeze({
      type: job.type,
      resourceId: result.runId,
      status: result.status === "completed" ? "completed" : "failed",
      replayed: result.replayed,
      ...(result.status === "completed_with_exceptions" ? { reason: "reconciliation controls completed with exceptions" } : {}),
    });
  } catch (error) {
    return Object.freeze({
      type: job.type,
      resourceId: job.type === "payment_status_recovery" ? job.intentId : job.runId,
      status: shouldRetry(error) ? "retry" : "failed",
      reason: safeReason(error),
    });
  }
}
